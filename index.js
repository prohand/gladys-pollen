// -----------------------------------------------------------------------------
// Entry point of the Pollens integration.
//
// Wires the SDK to the location list. No pollen logic lives here: it only
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. publishes one discovered device per configured location, and refreshes
//      that list every time the user adds or removes one.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { buildDiscoveredDevices, findLocationByDevice, pollLocation } from './src/devices/index.js';
import { taxonName, taxonNameFr } from './src/devices/pollenStation.js';
import { readPollenRisk } from './src/pollen/index.js';
import { RISK_LEVEL_LABELS } from './src/pollen/risk.js';
import {
  addLocation,
  LocationError,
  locationLabel,
  matchLocations,
  removeLocation,
  resolvePostalCode,
} from './src/locations.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated, and updated in place
// by the location actions since a self-initiated setConfig does not come back
// through the event).
let config = normalizeConfig();

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info(`onScanRequest -> publishing ${config.locations.length} location(s)`);
  await publishLocations();
});

// --- Polling: Gladys asks to refresh one device ------------------------------
gladys.onPoll(async (device) => {
  const location = findLocationByDevice(gladys, config, device);
  if (!location) {
    // The device exists in Gladys but its location is gone from the config:
    // the user removed the location without deleting the device.
    logger.warn(`onPoll ignored: no configured location for ${device.external_id}`);
    return;
  }
  await pollLocation(gladys, location);
});

// --- Manifest actions: buttons in the Configuration screen -------------------

// Add a location: geocode the postal code, store it, re-publish the Discovery
// tab. Nothing is created in Gladys yet — the user picks the device there.
gladys.onAction('add_location', (fields) =>
  runAction(async () => {
    const country = String(fields.country || config.default_country);
    const candidates = await resolvePostalCode(country, fields.postal_code, fields.city);

    if (candidates.length === 0) {
      return {
        en: `No town found for ${fields.postal_code}${fields.city ? ` / ${fields.city}` : ''}.`,
        fr: `Aucune commune trouvée pour ${fields.postal_code}${fields.city ? ` / ${fields.city}` : ''}.`,
      };
    }

    // A postal code can cover several towns (05100 covers four). Rather than
    // silently picking one, list them and let the user re-run with the town.
    if (candidates.length > 1) {
      const names = candidates.map((candidate) => candidate.city).join(', ');
      return {
        en: `${candidates.length} towns share ${fields.postal_code}: ${names}. Run the action again with the "Town" field filled in.`,
        fr: `${candidates.length} communes partagent le code ${fields.postal_code} : ${names}. Relancez l'action en renseignant le champ « Commune ».`,
      };
    }

    const [location] = candidates;
    const { locations, added } = addLocation(config.locations, location);
    if (!added) {
      return {
        en: `${locationLabel(location)} is already configured.`,
        fr: `${locationLabel(location)} est déjà configuré.`,
      };
    }

    await saveLocations(locations);
    return {
      en: `${locationLabel(location)} added. Open the Discovery tab to add its device.`,
      fr: `${locationLabel(location)} ajouté. Ouvrez l'onglet Découverte pour ajouter son appareil.`,
    };
  }),
);

// List the configured locations, so the user knows what to type to remove one.
gladys.onAction('list_locations', () =>
  runAction(async () => {
    if (config.locations.length === 0) {
      return {
        en: 'No location configured yet. Use "Add a location".',
        fr: 'Aucun lieu configuré pour le moment. Utilisez « Ajouter un lieu ».',
      };
    }
    const list = config.locations.map((location) => locationLabel(location)).join(', ');
    return {
      en: `${config.locations.length} location(s): ${list}.`,
      fr: `${config.locations.length} lieu(x) : ${list}.`,
    };
  }),
);

// Remove a location: it leaves the config and therefore the Discovery tab.
gladys.onAction('remove_location', (fields) =>
  runAction(async () => {
    const matches = matchLocations(config.locations, fields.location);

    if (matches.length === 0) {
      return {
        en: `No configured location matches "${fields.location}". Use "List my locations" to see them.`,
        fr: `Aucun lieu configuré ne correspond à « ${fields.location} ». Utilisez « Lister mes lieux » pour les voir.`,
      };
    }
    if (matches.length > 1) {
      const names = matches.map((location) => locationLabel(location)).join(', ');
      return {
        en: `"${fields.location}" matches several locations: ${names}. Type the town name instead.`,
        fr: `« ${fields.location} » correspond à plusieurs lieux : ${names}. Saisissez plutôt le nom de la commune.`,
      };
    }

    const { locations, removed } = removeLocation(config.locations, matches[0].id);
    await saveLocations(locations);
    return {
      en: `${locationLabel(removed)} removed. If its device was already added to Gladys, delete it from the device page too.`,
      fr: `${locationLabel(removed)} supprimé. Si son appareil avait déjà été ajouté dans Gladys, supprimez-le également depuis la page des appareils.`,
    };
  }),
);

// Live check of the data source, on the first configured location.
gladys.onAction('test_provider', () =>
  runAction(async () => {
    const [location] = config.locations;
    if (!location) {
      return {
        en: 'Add a location first, then run this test.',
        fr: "Ajoutez d'abord un lieu, puis relancez ce test.",
      };
    }

    const reading = await readPollenRisk(location);
    const level = reading.overall.level ?? 0;
    const dominant = reading.overall.taxon;

    return {
      en:
        `Provider OK (${reading.provider}). ${locationLabel(location)}: overall risk ` +
        `${level}/5 (${RISK_LEVEL_LABELS[level].en})` +
        `${dominant ? `, dominant pollen ${taxonName(dominant)}` : ''}.`,
      fr:
        `Fournisseur OK (${reading.provider}). ${locationLabel(location)} : risque global ` +
        `${level}/5 (${RISK_LEVEL_LABELS[level].fr})` +
        `${dominant ? `, pollen dominant ${taxonNameFr(dominant)}` : ''}.`,
    };
  }),
);

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // poll_frequency is carried by the devices themselves: re-publish so a
  // changed interval reaches Gladys. publishDiscoveredDevices is idempotent
  // (upsert by external_id).
  await publishLocations();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name).
gladys.on('connected', async () => {
  try {
    config = normalizeConfig(await gladys.getConfig());
    await publishLocations();
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await gladys
      .setConnectionStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
      })
      .catch(() => {});
  }
});

/**
 * Persist the new location list and reflect it everywhere.
 *
 * `setConfig` writes a key outside the `config_schema` — the documented way to
 * store integration-owned state. It does NOT come back through
 * `onConfigUpdated`, so the in-memory config is updated here.
 * @param {import('./src/locations.js').Location[]} locations
 */
async function saveLocations(locations) {
  await gladys.setConfig({ locations });
  config = { ...config, locations };
  await publishLocations();
}

/** Publish the Discovery tab: one device per configured location. */
async function publishLocations() {
  // publishDiscoveredDevices REPLACES the previous list: this is what makes a
  // removed location disappear from the Discovery tab.
  await gladys.publishDiscoveredDevices(buildDiscoveredDevices(gladys, config));
}

/**
 * Run an action handler, turning a LocationError into the multi-language
 * message it carries.
 *
 * The SDK acks a thrown error as a plain `error` string, which loses the
 * translation — so expected, user-facing failures are RETURNED as messages and
 * only unexpected ones are left to throw.
 * @param {() => Promise<string | object>} handler
 */
async function runAction(handler) {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof LocationError) {
      return err.multiLanguageMessage;
    }
    throw err;
  }
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Pollens integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

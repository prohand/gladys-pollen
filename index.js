// -----------------------------------------------------------------------------
// Entry point of the Pollens integration.
//
// Role of this file: wire the SDK to the device registry (src/devices/) and to
// the location manager (src/locationEditor.js). It holds NO pollen logic — the
// Open-Meteo calls live in src/pollen/, the device definition in
// src/devices/pollenStation.js, the configured locations in src/locations.js.
// This file only:
//   1. instantiates the SDK (connection, auth, reconnection: handled for you);
//   2. registers the event handlers BEFORE connect();
//   3. publishes one discovered device per configured location, and refreshes
//      that list every time the user adds or removes one;
//   4. gives the location manager the two things it cannot do itself: write the
//      configuration, and re-publish the devices when the list changes.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { isConfigured, normalizeConfig } from './src/config.js';
import {
  buildDiscoveredDevices,
  DEVICE_BLUEPRINTS,
  findBlueprintByDevice,
  locationDeviceIds,
} from './src/devices/index.js';
import { createLocationEditor } from './src/locationEditor.js';
import { LOCATIONS_KEY, serializeLocations } from './src/locations.js';
import { findProvider } from './src/pollen/index.js';

const gladys = new GladysIntegration();

// Current configuration (hot-reloaded via onConfigUpdated, and updated in place
// by the location actions since a self-initiated setConfig does not come back
// through the event).
let config = normalizeConfig();

// Cleanup functions of the refresh timers. The devices declare no
// `poll_frequency` — the core caps its own polling at one minute, far too fast
// for a daily forecast — so the integration drives its own refresh.
let pollingCleanups = [];

// Shown in the Supervision screen while no location has been added yet.
const NOT_CONFIGURED_MESSAGE = {
  en: 'Add a location to start following the pollen risk.',
  fr: 'Ajoutez un lieu pour suivre le risque pollinique.',
};

/**
 * Publish the discovered devices — unless we do not know WHERE to look yet.
 * @returns {Promise<boolean>} whether there was anything to publish
 */
async function publishDevices() {
  const configured = isConfigured(config);
  if (!configured) {
    logger.warn('No location configured yet: nothing to discover');
    await gladys.setConnectionStatus(false, NOT_CONFIGURED_MESSAGE).catch(() => {});
  }
  // An EMPTY list is still published, and that matters: publishDiscoveredDevices
  // REPLACES the previous one, so this is the only way the device of a deleted
  // location leaves the Discovery screen.
  const devices = configured ? buildDiscoveredDevices(gladys, config) : [];
  // Logged in full at debug level: when Gladys refuses the batch, the rejected
  // payload is the only thing that tells you WHICH feature it choked on.
  logger.debug('publishDiscoveredDevices ->', JSON.stringify(devices));

  try {
    const response = await gladys.publishDiscoveredDevices(devices);
    logger.info(`Published ${response?.count ?? devices.length} device(s) to the Discovery screen`);
    return configured;
  } catch (err) {
    // Gladys refused the batch — an unsupported feature category, an invalid
    // poll frequency, a feature without min/max... Without this, the Discovery
    // tab just stays empty with nothing anywhere to say why: the error would
    // only reach the SDK acknowledgement, which the user never sees.
    logger.error('Gladys refused the discovered devices', err);
    const reason = String(err?.message ?? err).slice(0, 150);
    await gladys
      .setConnectionStatus(false, {
        en: `Gladys refused the device: ${reason}`,
        fr: `Gladys a refusé l'appareil : ${reason}`,
      })
      .catch(() => {});
    throw err;
  }
}

/** (Re)start the refresh timers of every blueprint that has one. */
function startPolling() {
  stopPolling();
  pollingCleanups = DEVICE_BLUEPRINTS.filter(
    (blueprint) => typeof blueprint.startPolling === 'function',
  ).map((blueprint) => blueprint.startPolling(gladys, config));
}

function stopPolling() {
  for (const cleanup of pollingCleanups) {
    try {
      cleanup?.();
    } catch (err) {
      logger.error('Refresh timer cleanup failed', err);
    }
  }
  pollingCleanups = [];
}

/** Run one refresh cycle right now. Never throws (see blueprint.refresh). */
async function refreshNow() {
  await Promise.all(
    DEVICE_BLUEPRINTS.filter((blueprint) => typeof blueprint.refresh === 'function').map(
      (blueprint) => blueprint.refresh(gladys, config),
    ),
  );
}

/**
 * Re-publish the devices and restart the refresh on the current list. Called by
 * the location manager after every change it makes.
 */
async function republish() {
  if (await publishDevices()) {
    startPolling();
  } else {
    stopPolling();
  }
}

// The location manager owns everything the user does with the configured
// locations: the three actions that add, list and delete them. It is given the
// capabilities it cannot have on its own — writing the configuration,
// re-publishing the devices, asking whether a point is covered — and nothing
// else, which is what makes it testable offline.
const locationEditor = createLocationEditor({
  getConfig: () => config,
  async setConfig(patch) {
    await gladys.setConfig(patch);
    // Keep the in-memory copy in step: the core does NOT echo an integration's
    // own write back as a config-updated (it would loop), so nothing else will.
    config = normalizeConfig({ ...config, ...patch });
  },
  onLocationsChanged: republish,
  // Outside the CAMS European domain the forecast answers nulls for every
  // taxon: better to refuse the location than to publish a device that never
  // holds a value.
  isCovered: (point) => Boolean(findProvider(point)),
  // "Has the user already created this location's device?" — the one case the
  // delete action cannot clean up on its own, and must therefore name.
  async findCreatedDevice(location) {
    const ours = new Set(locationDeviceIds(gladys, location));
    const devices = await gladys.getDevices();
    return (devices ?? []).find((device) => ours.has(device?.external_id)) ?? null;
  },
});

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info(`onScanRequest -> publishing ${config.locations.length} location(s)`);
  await publishDevices();
});

// --- The user just added a device from the Discovery screen ------------------
// Until that moment the core SILENTLY DROPS every state we publish: the feature
// does not exist yet. Without this handler the brand new device would sit on
// "no recent value" until the next hourly tick — which is exactly what it looks
// like when it is broken.
gladys.onDeviceCreated(async (device) => {
  logger.info(`onDeviceCreated -> ${device.external_id}, refreshing right away`);
  await refreshNow();
});

// --- Polling: Gladys asks to refresh one device ------------------------------
gladys.onPoll(async (device) => {
  const blueprint = findBlueprintByDevice(gladys, config, device);
  if (!blueprint || typeof blueprint.onPoll !== 'function') {
    // The device exists in Gladys but no location watches it: the user removed
    // the location without deleting the device. It can safely be deleted there.
    logger.warn(
      `onPoll ignored: ${device.external_id} is not a device this integration publishes. ` +
        'Its location no longer exists, you can delete it in Gladys.',
    );
    return;
  }
  await blueprint.onPoll(gladys, config, device.external_id);
});

// --- Manifest actions: buttons in the Configuration screen -------------------
// Each action declared in the `actions` field of the manifest is registered per
// key; the message resolved by the handler is displayed under the button.
for (const blueprint of DEVICE_BLUEPRINTS) {
  for (const [actionKey, handler] of Object.entries(blueprint.actions ?? {})) {
    gladys.onAction(actionKey, (fields) => handler(gladys, { fields, config }));
  }
}
for (const [actionKey, handler] of Object.entries(locationEditor.actions)) {
  gladys.onAction(actionKey, (fields) => handler(fields));
}

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> new configuration received');
  config = normalizeConfig(newConfig);
  // Nothing in that screen touches a location — it only holds the refresh
  // interval, which `republish` applies by restarting the timers.
  await republish();
});

// --- Connection lifecycle ----------------------------------------------------
// The SDK logs the WebSocket lifecycle itself (under the `gladys-sdk` name).
gladys.on('connected', async () => {
  try {
    // 1) Fetch the configuration filled in by the user.
    const rawConfig = await gladys.getConfig();
    config = normalizeConfig(rawConfig);

    // 1 bis) An install made before 2.0.0 stored its locations as postal codes
    // (`country` / `postal_code` / `city`). normalizeConfig has already rebuilt
    // them as points — keeping the very ids their devices were published under,
    // so nothing is orphaned — and this writes that shape back, so the actions
    // work on the current one. Skipped when nothing changed, which is the case
    // on every normal start.
    await migrateStoredLocations(rawConfig);

    // 2) (Re)publish the devices as soon as we are connected.
    if (!(await publishDevices())) {
      stopPolling();
      return;
    }

    // 3) Start our own refresh loop (the devices declare no poll_frequency).
    startPolling();

    // 4) Report the application-level status, shown in the Supervision screen.
    // Distinct from the container state machine: an integration can be RUNNING
    // and still unable to reach its third-party service.
    await gladys.setConnectionStatus(true);
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    // Carry the real reason into the Supervision screen. A rejected device batch
    // is otherwise invisible: the user just sees an empty Discovery tab with no
    // clue that Gladys refused the payload.
    const reason = String(err?.message ?? err).slice(0, 150);
    await gladys
      .setConnectionStatus(false, {
        en: `Initialization failed: ${reason}`,
        fr: `L'initialisation a échoué : ${reason}`,
      })
      .catch(() => {});
  }
});

/**
 * Persist the stored location list in the current shape when it is not already
 * in it. Read once, on connection: the entries of 1.0.0 carry `postal_code` and
 * `city` where this version stores a name and an address label.
 * @param {Record<string, unknown>} rawConfig the configuration as stored
 */
async function migrateStoredLocations(rawConfig) {
  const stored = Array.isArray(rawConfig?.[LOCATIONS_KEY]) ? rawConfig[LOCATIONS_KEY] : [];
  const wanted = serializeLocations(config.locations);
  if (JSON.stringify(stored) === JSON.stringify(wanted)) {
    return;
  }
  logger.info(`Migrating ${wanted.length} stored location(s) to the current shape`);
  await gladys.setConfig({ [LOCATIONS_KEY]: wanted });
  config = normalizeConfig({ ...rawConfig, [LOCATIONS_KEY]: wanted });
}

// --- Graceful shutdown -------------------------------------------------------
gladys.on('disconnected', () => {
  // No point hammering Open-Meteo while we cannot publish anything.
  stopPolling();
});

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
  stopPolling();
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the Pollens integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});

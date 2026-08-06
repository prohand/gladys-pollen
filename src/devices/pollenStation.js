// -----------------------------------------------------------------------------
// Device type: POLLEN STATION.
//
// One device per configured location. Unlike the template's device blueprints,
// the device list is not known at build time: it is a projection of
// `config.locations`, so every function here works on the locations of the
// configuration it is handed.
//
// Features: one risk level (0-5) per pollen taxon, plus an overall risk, its
// wording and the name of the dominant taxon. Risk levels rather than raw
// concentrations, because that is what a user (and a Gladys scene) can act on —
// see `src/pollen/risk.js` for the thresholds.
//
// The identity of a device is `<type>:<location id>`, and the location id is
// generated once when the user adds the location: renaming a location, or
// moving its point, keeps the device, its history and its place in the rooms and
// scenes.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { DEFAULT_LANGUAGE, inLanguage } from '../language.js';
import { allTaxa, findProvider, readPollenRisk } from '../pollen/index.js';
import { RISK_LEVEL_LABELS, RISK_LEVEL_MAX } from '../pollen/risk.js';
import {
  describeLocation,
  LOCATION_LINE_SEPARATOR,
  locationLine,
  positionOf,
  usableLocations,
} from '../locations.js';

export const DEVICE_TYPE = 'pollen-station';

const logger = createLogger({ name: DEVICE_TYPE });

// Floor on the refresh interval, whatever the configuration says. Open-Meteo is
// a free public service and the CAMS forecast is interpolated hourly: hammering
// it buys nothing.
export const MIN_REFRESH_SECONDS = 300;

/** Non-taxon features. Prefixed to never collide with a taxon key. */
export const FEATURE = {
  OVERALL_RISK: 'overall-risk',
  OVERALL_RISK_TEXT: 'overall-risk-text',
  DOMINANT_POLLEN: 'dominant-pollen',
};

/** Display names of the taxa, used to build the feature names. */
const TAXON_NAMES = {
  alder: { en: 'Alder', fr: 'Aulne' },
  birch: { en: 'Birch', fr: 'Bouleau' },
  grass: { en: 'Grass', fr: 'Graminées' },
  mugwort: { en: 'Mugwort', fr: 'Armoise' },
  olive: { en: 'Olive', fr: 'Olivier' },
  ragweed: { en: 'Ragweed', fr: 'Ambroisie' },
};

/** Names of the features that are not about one taxon. */
const FEATURE_NAMES = {
  [FEATURE.OVERALL_RISK]: { en: 'Overall pollen risk', fr: 'Risque pollinique global' },
  [FEATURE.OVERALL_RISK_TEXT]: {
    en: 'Overall pollen risk (text)',
    fr: 'Risque pollinique global (texte)',
  },
  [FEATURE.DOMINANT_POLLEN]: { en: 'Dominant pollen', fr: 'Pollen dominant' },
};

/** How the name of a taxon becomes the name of its risk feature. */
const TAXON_FEATURE_NAME = {
  en: (name) => `${name} pollen risk`,
  fr: (name) => `Risque pollinique — ${name}`,
};

/** What the "dominant pollen" feature says when nothing is in the air. */
const NO_DOMINANT_POLLEN = { en: 'None', fr: 'Aucun' };

/**
 * Display name of a taxon. Also the value of the "dominant pollen" state, so a
 * dashboard reads the same word as the feature it comes from.
 * @param {string} taxon pollen taxon key, e.g. 'birch'
 * @param {string} [language] one of LANGUAGES; the taxon key is the last resort
 *   for a species a future provider adds without a translation
 */
export function taxonName(taxon, language = DEFAULT_LANGUAGE) {
  return TAXON_NAMES[taxon] ? inLanguage(TAXON_NAMES[taxon], language) : taxon;
}

/** External ids of the device of a location. */
export function deviceExternalIds(gladys, location) {
  return gladys.externalIds(DEVICE_TYPE, location.id);
}

/**
 * The locations a device can be published for: a usable point, covered by a
 * pollen provider.
 *
 * Coverage is checked when the location is added, but a stored one can outlive
 * a provider's bounding box — and publishing a device the forecast answers
 * nulls for would leave a sensor stuck on "no recent value" forever.
 * @param {{ locations: import('../locations.js').Location[] }} config
 */
export function watchedLocations(config) {
  return usableLocations(config.locations).filter((location) => Boolean(findProvider(location)));
}

/** Shape shared by every risk feature: a read-only 0-5 index. */
function riskFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.RISK,
    type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
    // `t_device_feature.min`/`max` are NOT NULL with no default in the core: a
    // feature without them is refused when the user adds the device.
    min: 0,
    max: RISK_LEVEL_MAX,
    read_only: true, // sensor: no action possible
    has_feedback: false,
    keep_history: true, // keep history to draw the season on a chart
  };
}

/** Shape shared by every text feature. */
function textFeature(externalId, name) {
  return {
    name,
    external_id: externalId,
    category: DEVICE_FEATURE_CATEGORIES.TEXT,
    type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
    // Meaningless for a label, but the core columns are NOT NULL (see above).
    min: 0,
    max: 0,
    read_only: true,
    has_feedback: false,
    keep_history: false, // a label, not a measure: nothing to chart
  };
}

/**
 * Build the discovery payload of one location.
 *
 * The names are written in the configured language and nowhere else: a device
 * name and a feature name are plain strings the core copies into its own tables
 * when the user creates the device, so this is the ONE place where the
 * integration has to pick a language instead of handing Gladys `{ en, fr }`.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 * @param {string} [language] one of LANGUAGES (see src/language.js)
 */
export function buildDevice(gladys, location, language = DEFAULT_LANGUAGE) {
  const ids = deviceExternalIds(gladys, location);
  const featureName = (key) => inLanguage(FEATURE_NAMES[key], language);

  return {
    name: `Pollens — ${location.name}`,
    external_id: ids.device,
    // NO poll_frequency on purpose: the core only accepts a fixed enum of
    // intervals in MILLISECONDS, capped at one minute, and anything else has
    // the WHOLE batch refused — which is what left the Discovery tab empty.
    // A pollen forecast changes once a day, so the integration drives its own
    // refresh instead; see startPolling below.
    //
    // Keep the resolved position on the device: useful when debugging a wrong
    // town, and it survives a restart independently of the configuration.
    params: [
      { name: 'LOCATION_ID', value: location.id },
      { name: 'LOCATION_NAME', value: location.name },
      { name: 'ADDRESS_LABEL', value: location.address_label ?? '' },
      { name: 'LATITUDE', value: String(location.latitude) },
      { name: 'LONGITUDE', value: String(location.longitude) },
    ],
    features: [
      // The one to use in a scene: the worst taxon of the moment.
      //
      // NOTE: a `risk`/`integer` value is rendered through the core's OWN label
      // set in the "device in a room" dashboard box, which only names 0 to 3;
      // levels 4 and 5 show as "Inconnu" there. The text feature below carries
      // the exact wording, and the numeric one stays on the 0-5 scale every
      // pollen bulletin uses.
      riskFeature(ids.feature(FEATURE.OVERALL_RISK), featureName(FEATURE.OVERALL_RISK)),
      textFeature(ids.feature(FEATURE.OVERALL_RISK_TEXT), featureName(FEATURE.OVERALL_RISK_TEXT)),
      ...allTaxa().map((taxon) =>
        riskFeature(
          ids.feature(taxon),
          inLanguage(TAXON_FEATURE_NAME, language)(taxonName(taxon, language)),
        ),
      ),
      textFeature(ids.feature(FEATURE.DOMINANT_POLLEN), featureName(FEATURE.DOMINANT_POLLEN)),
    ],
  };
}

/**
 * Build the `publishStates` batch of one location from a provider reading.
 * Split out of `poll()` so the mapping "reading -> states" is testable without
 * a Gladys connection.
 *
 * The two TEXT states are written in the same language as the features that
 * carry them: a stored state is a string like a feature name, translated by
 * nobody downstream.
 * @param {string} [language] one of LANGUAGES (see src/language.js)
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function buildStates(ids, reading, language = DEFAULT_LANGUAGE) {
  const states = [];

  for (const [taxon, level] of Object.entries(reading.risks)) {
    // A taxon the provider has no value for publishes nothing at all: an absent
    // measurement is not a zero risk, and writing 0 would pollute the history
    // and could fire a "risk is back to none" scene.
    if (level !== null && level !== undefined) {
      states.push({ device_feature_external_id: ids.feature(taxon), state: level });
    }
  }

  if (reading.overall.level !== null) {
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK),
        state: reading.overall.level,
      },
      {
        device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK_TEXT),
        text: inLanguage(RISK_LEVEL_LABELS[reading.overall.level], language),
      },
      {
        device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLEN),
        text: reading.overall.taxon
          ? taxonName(reading.overall.taxon, language)
          : inLanguage(NO_DOMINANT_POLLEN, language),
      },
    );
  }

  return states;
}

/**
 * Read one location and publish its states.
 * Throws on an unreadable answer — `refresh` is what never throws.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 * @param {string} [language] language of the published TEXT states
 */
export async function poll(gladys, location, language = DEFAULT_LANGUAGE) {
  const ids = deviceExternalIds(gladys, location);
  logger.info(`Polling pollen risk for ${location.name}...`);

  // ------------------------------------------------------------------ //
  // DO THE WORK: read the pollen concentrations and grade them.
  // ------------------------------------------------------------------ //
  const reading = await readPollenRisk(location);

  const states = buildStates(ids, reading, language);
  if (states.length === 0) {
    logger.warn(`No pollen data for ${location.name}, nothing published`);
    return reading;
  }

  // The logs stay English whatever the devices are named: they are read in the
  // container output, next to the SDK's own.
  const overall = RISK_LEVEL_LABELS[reading.overall.level]?.en ?? 'unknown';
  logger.info(
    `${location.name}: overall risk ${reading.overall.level} (${overall})` +
      `${reading.overall.taxon ? `, dominant ${taxonName(reading.overall.taxon, 'en')}` : ''}`,
  );

  // One request for every feature of the device (batch, up to 100).
  await gladys.publishStates(states);
  return reading;
}

/** Why a location could not be read, WITHOUT naming it (the line already does). */
function failureDetail(err) {
  const reason = String(err?.message ?? err).slice(0, 120);
  return {
    en: `pollen refresh failed: ${reason}`,
    fr: `le rafraîchissement des pollens a échoué : ${reason}`,
  };
}

/** The same reason, named, for the one-line connection status. */
function failureMessage(err, locationName) {
  const detail = failureDetail(err);
  return {
    en: `${locationName}: ${detail.en}`,
    fr: `${locationName} : ${detail.fr}`,
  };
}

const NO_LOCATION_MESSAGE = {
  en: 'No location with usable coordinates yet. Add one with "Add a location".',
  fr: 'Aucun lieu avec des coordonnées utilisables. Ajoutez-en un avec « Ajouter un lieu ».',
};

/**
 * A header plus one line per location, in both languages — EXACTLY the format of
 * the location listing (`• n. name — detail`, built by the same `locationLine`),
 * because both actions answer about the same list under the same numbers.
 */
function report(header, lines) {
  const join = (language) =>
    lines
      .map((line) => locationLine(line.position, line.name, line[language]))
      .join(LOCATION_LINE_SEPARATOR);
  return {
    en: `${header.en}${LOCATION_LINE_SEPARATOR}${join('en')}`,
    fr: `${header.fr}${LOCATION_LINE_SEPARATOR}${join('fr')}`,
  };
}

/**
 * Run `read` on every location, turning a failure into a LINE rather than into a
 * rejection: one location the provider refuses must not hide the answer of the
 * others, and a bare error naming no location helps nobody.
 */
async function readEachLocation(config, locations, read) {
  const lines = await Promise.all(
    locations.map(async (location) => {
      const entry = { position: positionOf(config.locations, location.id), name: location.name };
      try {
        return { ...entry, failed: false, ...(await read(location)) };
      } catch (err) {
        logger.error(`Pollen query failed for ${location.name}`, err);
        return { ...entry, failed: true, ...failureDetail(err) };
      }
    }),
  );
  return { lines, failed: lines.filter((line) => line.failed).length };
}

export const pollenStation = {
  key: DEVICE_TYPE,

  /** The external_id of ONE location's device, watched or not. */
  locationDeviceId(gladys, location) {
    return deviceExternalIds(gladys, location).device;
  },

  /** Every external_id this type publishes, one per watched location. */
  deviceExternalIds(gladys, config) {
    return watchedLocations(config).map((location) => deviceExternalIds(gladys, location).device);
  },

  buildDevices(gladys, config) {
    return watchedLocations(config).map((location) =>
      buildDevice(gladys, location, config.language),
    );
  },

  // Manifest actions owned by this device type (see the `actions` field of
  // `gladys-assistant-integration.json`).
  actions: {
    /**
     * Live check of the data source, on EVERY location: "is it working?" is a
     * question about the install, not about one entry of a list, and nothing in
     * this screen designates a single location anyway.
     */
    async test_provider(gladys, { config }) {
      const locations = watchedLocations(config);
      if (locations.length === 0) {
        return NO_LOCATION_MESSAGE;
      }
      logger.info(`Action test_provider -> live request for ${locations.length} location(s)`);

      const { lines, failed } = await readEachLocation(config, locations, async (location) => {
        const reading = await readPollenRisk(location);
        const level = reading.overall.level ?? 0;
        const dominant = reading.overall.taxon;
        return {
          en:
            `risk ${level}/${RISK_LEVEL_MAX} (${RISK_LEVEL_LABELS[level].en})` +
            `${dominant ? `, dominant ${taxonName(dominant, 'en')}` : ''} — ${reading.provider}`,
          fr:
            `risque ${level}/${RISK_LEVEL_MAX} (${RISK_LEVEL_LABELS[level].fr})` +
            `${dominant ? `, dominant ${taxonName(dominant, 'fr')}` : ''} — ${reading.provider}`,
        };
      });

      // "Provider OK" only when it actually is: the header counts the locations
      // that failed, and each of their lines says why.
      const header =
        failed === 0
          ? {
              en: `Pollen provider OK — ${locations.length} location(s):`,
              fr: `Fournisseur de pollens OK — ${locations.length} lieu(x) :`,
            }
          : {
              en: `Pollen provider — ${failed} of ${locations.length} location(s) failing:`,
              fr: `Fournisseur de pollens — ${failed} lieu(x) en échec sur ${locations.length} :`,
            };
      return report(header, lines);
    },
  },

  /**
   * Refresh ONE device, on a poll request Gladys sends for it. The devices
   * declare no poll_frequency, so this normally never fires; it stays because a
   * device created by an older version may still carry one.
   * @param {string} externalId external_id of the device to refresh
   */
  async onPoll(gladys, config, externalId) {
    const location = watchedLocations(config).find(
      (candidate) => deviceExternalIds(gladys, candidate).device === externalId,
    );
    if (!location) {
      throw new Error(`No location watches the device ${externalId}`);
    }
    await poll(gladys, location, config.language);
  },

  /**
   * Drive the refresh ourselves.
   *
   * Gladys' own polling is not usable here: `poll_frequency` is a fixed enum of
   * intervals in milliseconds whose slowest value is one minute, while the CAMS
   * forecast is interpolated hourly. So the devices declare no poll_frequency
   * and we run our own timer at the configured interval.
   * @returns {() => void} cleanup, to stop the timer on disconnection
   */
  startPolling(gladys, config) {
    const intervalMs = Math.max(MIN_REFRESH_SECONDS, config.poll_frequency) * 1000;
    const count = watchedLocations(config).length;
    logger.info(`Refreshing ${count} location(s) every ${Math.round(intervalMs / 1000)} s`);

    // Refresh straight away: waiting a full hour for the first value would leave
    // a freshly added device empty on the dashboard.
    pollenStation.refresh(gladys, config);
    const timer = setInterval(() => pollenStation.refresh(gladys, config), intervalMs);
    return () => clearInterval(timer);
  },

  /**
   * One refresh cycle over every location, which NEVER throws: a rejection
   * inside a timer callback would become an unhandled rejection and take the
   * container down. Outages are reported through `setConnectionStatus` instead,
   * and the next cycle simply tries again.
   */
  async refresh(gladys, config) {
    const locations = watchedLocations(config);
    const outcomes = await Promise.all(
      locations.map(async (location) => {
        try {
          await poll(gladys, location, config.language);
          return null;
        } catch (err) {
          logger.error(`Pollen refresh failed for ${describeLocation(location)}`, err);
          return failureMessage(err, location.name);
        }
      }),
    );

    const failures = outcomes.filter(Boolean);
    if (failures.length === 0) {
      await gladys.setConnectionStatus(true).catch(() => {});
      return;
    }
    // Only the first reason is spelled out: the status line is one line, and two
    // stack traces in it help nobody.
    const [first] = failures;
    const others =
      failures.length > 1
        ? {
            en: ` (+${failures.length - 1} other location(s) failing)`,
            fr: ` (+${failures.length - 1} autre(s) lieu(x) en échec)`,
          }
        : { en: '', fr: '' };
    await gladys
      .setConnectionStatus(false, { en: `${first.en}${others.en}`, fr: `${first.fr}${others.fr}` })
      .catch(() => {});
  },
};

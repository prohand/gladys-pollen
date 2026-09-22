// -----------------------------------------------------------------------------
// Device type: POLLEN STATION.
//
// One device per configured location. Unlike the template's device blueprints,
// the device list is not known at build time: it is a projection of
// `config.locations`, so every function here works on the locations of the
// configuration it is handed.
//
// Features: one risk level per pollen taxon AND its wording, plus an overall
// risk, its own wording, the name of the dominant taxon and the date of the
// data. Risk levels rather than raw concentrations, because that is what a user
// (and a Gladys scene) can act on — see `src/pollen/risk.js` for the thresholds
// AND for why the scale is the core's own 0-3 rather than the six EAN bands.
// Every level is published TWICE, as an index and as a sentence: the core names
// an index for itself in the "device in a room" box and nowhere else, so a
// scene, a text box or an assistant reading the number gets a bare `3`.
//
// The date of the data belongs HERE, on each station, and not on some device
// global to the integration: it is the hour the forecast is valid at for THAT
// point, read on the clock of that town, so two locations in two timezones do
// not carry the same one.
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
import { formatDateTime } from '../dateTime.js';
import { DEFAULT_LANGUAGE, inLanguage } from '../language.js';
import { allTaxa, findProvider, readPollenRisk } from '../pollen/index.js';
import { RISK_LEVEL_LABELS, RISK_LEVEL_MAX } from '../pollen/risk.js';
import { taxonName } from '../pollen/taxa.js';
import { levelText } from '../riskText.js';
import { publishRiskEvents } from '../scenes/riskEvents.js';
import { nudgeWidgets } from '../widgets/keys.js';
import {
  describeLocation,
  LOCATION_LINE_SEPARATOR,
  locationLine,
  positionOf,
  usableLocations,
} from '../locations.js';

export const DEVICE_TYPE = 'pollen-station';

// Re-exported: the taxon vocabulary moved to src/pollen/taxa.js when the
// widgets and the scene events started needing it too.
export { taxonName };

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
  LAST_UPDATE: 'last-update',
};

/**
 * External id of the TEXT feature doubling a taxon's risk index.
 *
 * `-text` suffixed like `overall-risk-text`, and never collides with the keys
 * above: no taxon is named `overall-risk` or `dominant-pollen`. It is an id, so
 * it is fixed forever — the history of a feature is matched by it.
 */
export function taxonTextFeatureId(taxon) {
  return `${taxon}-text`;
}

/** Names of the features that are not about one taxon. */
const FEATURE_NAMES = {
  [FEATURE.OVERALL_RISK]: { en: 'Overall pollen risk', fr: 'Risque pollinique global' },
  [FEATURE.OVERALL_RISK_TEXT]: {
    en: 'Overall pollen risk (text)',
    fr: 'Risque pollinique global (texte)',
  },
  [FEATURE.DOMINANT_POLLEN]: { en: 'Dominant pollen', fr: 'Pollen dominant' },
  [FEATURE.LAST_UPDATE]: { en: 'Last data update', fr: 'Dernière mise à jour des données' },
};

/** How the name of a taxon becomes the name of its risk feature. */
const TAXON_FEATURE_NAME = {
  en: (name) => `${name} pollen risk`,
  fr: (name) => `Risque pollinique — ${name}`,
};

/** Same, for the wording that doubles it. */
const TAXON_TEXT_FEATURE_NAME = {
  en: (name) => `${name} pollen risk (text)`,
  fr: (name) => `Risque pollinique — ${name} (texte)`,
};

/** What the "dominant pollen" feature says when nothing is in the air. */
const NO_DOMINANT_POLLEN = { en: 'None', fr: 'Aucun' };

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

/**
 * The watched location a device external_id belongs to.
 *
 * The one translation between "what the user picked in Gladys" and "what this
 * integration works on": a `source: "devices"` select — in a widget setting, a
 * scene trigger filter, a scene action field — stores a device external_id, and
 * everything here takes a location.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('../locations.js').Location[] }} config
 * @param {string} externalId
 * @returns {import('../locations.js').Location|undefined}
 */
export function findLocationByDeviceId(gladys, config, externalId) {
  return watchedLocations(config).find(
    (candidate) => deviceExternalIds(gladys, candidate).device === externalId,
  );
}

/** Shape shared by every risk feature: a read-only index on the core scale. */
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

/**
 * Shape shared by every text feature.
 *
 * Every risk has one on top of its number, the overall one and each taxon:
 * a notification, a dashboard text box or a voice answer wants a sentence, not
 * an index. The core does name an index correctly in the "device in a room"
 * box — it is published on its own scale (see `src/pollen/risk.js`) — but that
 * box is the ONE place that does it: a scene reading `Risque pollinique —
 * Bouleau` gets a `3`, and `3` is what it puts in the notification it sends.
 * The text feature is what a scene, a dashboard text box or an assistant reads
 * to say "3/3 (élevé)" without carrying the label table itself.
 *
 * It is a LABEL, not a measure: `keep_history` stays false — the index next to
 * it is what draws the season on a chart.
 */
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
      // The one to use in a scene: the worst taxon of the moment. It is
      // published on the core's own risk scale, so the "device in a room" box
      // names it by itself — "Élevé" for a 3 — and the text feature beside it
      // is the same level in a sentence, not a correction of it.
      riskFeature(ids.feature(FEATURE.OVERALL_RISK), featureName(FEATURE.OVERALL_RISK)),
      textFeature(ids.feature(FEATURE.OVERALL_RISK_TEXT), featureName(FEATURE.OVERALL_RISK_TEXT)),
      // Each taxon: the index the core badges and scenes compare, then the
      // same level in words, next to it.
      ...allTaxa().flatMap((taxon) => {
        const name = taxonName(taxon, language);
        return [
          riskFeature(ids.feature(taxon), inLanguage(TAXON_FEATURE_NAME, language)(name)),
          textFeature(
            ids.feature(taxonTextFeatureId(taxon)),
            inLanguage(TAXON_TEXT_FEATURE_NAME, language)(name),
          ),
        ];
      }),
      textFeature(ids.feature(FEATURE.DOMINANT_POLLEN), featureName(FEATURE.DOMINANT_POLLEN)),
      // "How old is what I am looking at?" — the hour the forecast is valid at,
      // not the moment of the last request: the model publishes once a day, so
      // a successful refresh usually re-reads the very same numbers.
      textFeature(ids.feature(FEATURE.LAST_UPDATE), featureName(FEATURE.LAST_UPDATE)),
    ],
  };
}

/**
 * Build the `publishStates` batch of one location from a provider reading.
 * Split out of `poll()` so the mapping "reading -> states" is testable without
 * a Gladys connection.
 *
 * The three TEXT states are written in the same language as the features that
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
    // and could fire a "risk is back to none" scene. Its wording stays absent
    // for the same reason — "0/3 (pas de risque)" would say something the
    // model did not.
    if (level !== null && level !== undefined) {
      states.push(
        { device_feature_external_id: ids.feature(taxon), state: level },
        {
          // The same helper as the overall wording, the widget rows and the
          // scene messages: one level, one sentence, everywhere.
          device_feature_external_id: ids.feature(taxonTextFeatureId(taxon)),
          text: levelText(level, language),
        },
      );
    }
  }

  if (reading.overall.level !== null) {
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK),
        state: reading.overall.level,
      },
      {
        // The scale AND the word — "3/3 (élevé)" — written by the same helper
        // as the widget rows and the scene messages, so every surface of this
        // integration says a level in the very same terms.
        device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK_TEXT),
        text: levelText(reading.overall.level, language),
      },
      {
        device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLEN),
        text: reading.overall.taxon
          ? taxonName(reading.overall.taxon, language)
          : inLanguage(NO_DOMINANT_POLLEN, language),
      },
    );
  }

  // Dated only when something was actually published: a lone timestamp on a
  // device holding no value would date a measurement that is not there.
  const measuredAt = formatDateTime(reading.measuredAt, language);
  if (measuredAt && states.length > 0) {
    states.push({ device_feature_external_id: ids.feature(FEATURE.LAST_UPDATE), text: measuredAt });
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

  // States first, events after: a scene started by the event reads the
  // features, and it must find the value the event talks about. Nothing is
  // fired unless a level actually MOVED — see src/scenes/riskEvents.js.
  await publishRiskEvents(gladys, {
    location,
    deviceExternalId: ids.device,
    reading,
    language,
  });
  return reading;
}

/**
 * Read a list of locations and publish what they answer, counting the failures
 * instead of propagating them.
 *
 * Shared by everything that refreshes ON DEMAND — the scene action, the widget
 * buttons — because they all owe their caller a count rather than a stack
 * trace, and one place failing must never cost the others their refresh. The
 * scheduled cycle has its own reporting (see `refresh`).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location[]} locations
 * @param {string} [language] language of the published TEXT states
 * @returns {Promise<{ refreshed: number, failed: number }>}
 */
export async function refreshLocations(gladys, locations, language = DEFAULT_LANGUAGE) {
  const outcomes = await Promise.all(
    locations.map(async (location) => {
      try {
        await poll(gladys, location, language);
        return true;
      } catch (err) {
        logger.error(`On-demand refresh failed for ${describeLocation(location)}`, err);
        return false;
      }
    }),
  );
  const refreshed = outcomes.filter(Boolean).length;
  return { refreshed, failed: outcomes.length - refreshed };
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
        // "It answers" and "it answers something recent" are two different
        // questions, and this action is where both are asked.
        const measuredAt = (language, prefix) => {
          const at = formatDateTime(reading.measuredAt, language);
          return at ? `, ${prefix} ${at}` : '';
        };
        return {
          en:
            `risk ${levelText(level, 'en')}` +
            `${dominant ? `, dominant ${taxonName(dominant, 'en')}` : ''} — ${reading.provider}` +
            measuredAt('en', 'updated'),
          fr:
            `risque ${levelText(level, 'fr')}` +
            `${dominant ? `, dominant ${taxonName(dominant, 'fr')}` : ''} — ${reading.provider}` +
            measuredAt('fr', 'à jour au'),
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
    const location = findLocationByDeviceId(gladys, config, externalId);
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

    // The device-bound tiles of the widgets follow the published states on
    // their own; their status rows and their forecast curve do not, so one
    // nudge per cycle tells the open dashboards to re-pull them.
    nudgeWidgets(gladys);

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

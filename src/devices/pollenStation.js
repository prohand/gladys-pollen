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
// scene, a text box or an assistant reading the number gets a bare `3`. The
// sentence also carries the MEASURED band — "4/5 (élevé)", 0 to 5 — which the
// index cannot: the core re-labels a number and reads "Inconnu" above 3, a
// string it displays as it is.
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
//
// This module is the device SCHEMA and nothing else: what a device is, which
// location it belongs to, and how a reading becomes its states. It does no I/O
// and imports nothing that publishes, so everything that does — the refresh
// cycle (src/refresh.js), the provider check (src/providerCheck.js), the
// widgets and the scene actions — can import it without closing a circle.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';
import { formatDateTime } from '../dateTime.js';
import { DEFAULT_LANGUAGE, inLanguage } from '../language.js';
import { allTaxa, findProvider } from '../pollen/index.js';
import { RISK_LEVEL_MAX } from '../pollen/risk.js';
import { taxonName } from '../pollen/taxa.js';
import { eanLevelText, levelText } from '../riskText.js';
import { usableLocations } from '../locations.js';

export const DEVICE_TYPE = 'pollen-station';

// Re-exported: the taxon vocabulary moved to src/pollen/taxa.js when the
// widgets and the scene events started needing it too.
export { taxonName };

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
 * to say "4/5 (élevé)" without carrying the label table itself.
 *
 * It is also the ONE place the MEASURED band survives: a stored string is
 * displayed as it is, so it says "5/5 (très élevé)" where the index beside it
 * has to fold that onto the 3 the core can name (see `src/pollen/risk.js`).
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
    // refresh instead; see startPolling in src/refresh.js.
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
 * How a risk is written on a TEXT feature: the measured EAN band, 0 to 5.
 *
 * The band is what the user's pollen bulletin says — "élevé" and "très élevé"
 * are two different days, and the published index has to call both of them 3.
 * A reading built without bands (an older caller) falls back on the index
 * rather than writing "undefined/5".
 */
function riskWording(eanLevel, level, language) {
  return eanLevel === null || eanLevel === undefined
    ? levelText(level, language)
    : eanLevelText(eanLevel, language);
}

/**
 * Build the `publishStates` batch of one location from a provider reading.
 * Kept apart from `poll()` (src/refresh.js) so the mapping "reading -> states"
 * is testable without a Gladys connection.
 *
 * The TEXT states are written in the same language as the features that carry
 * them: a stored state is a string like a feature name, translated by nobody
 * downstream. They are also the only states on the 0-5 measured scale — the
 * indexes beside them stay on the core's 0-3 one.
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
          // The band, not the index: this is where a "4/5 (élevé)" day is told
          // apart from a "5/5 (très élevé)" one.
          device_feature_external_id: ids.feature(taxonTextFeatureId(taxon)),
          text: riskWording(reading.eanRisks?.[taxon], level, language),
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
        // The scale AND the word — "4/5 (élevé)" — on the scale the data is
        // measured on, which the index above cannot carry.
        device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK_TEXT),
        text: riskWording(reading.overall.eanLevel, reading.overall.level, language),
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
 * The blueprint the device registry (src/devices/index.js) publishes: identity
 * and discovery payloads only. What REFRESHES these devices — the timer, a
 * poll, a device just created — lives in src/refresh.js, and the
 * `test_provider` button in src/providerCheck.js: both read this schema, and
 * keeping them out of it is what lets them do so without a circular import.
 */
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
};

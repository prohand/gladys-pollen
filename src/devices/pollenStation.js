// -----------------------------------------------------------------------------
// Device type: POLLEN STATION.
//
// One device per configured location. Unlike the template's device blueprints,
// this module is a FACTORY: the device list is not known at build time, it is
// derived from the locations the user configured, so every function takes the
// location it works on.
//
// Features: one risk level (0-5) per pollen taxon, plus an overall risk and the
// name of the dominant taxon. Risk levels rather than raw concentrations,
// because that is what a user (and a Gladys scene) can act on — see
// `src/pollen/risk.js` for the thresholds.
// -----------------------------------------------------------------------------

import {
  createLogger,
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
} from '@gladysassistant/integration-sdk';
import { allTaxa, readPollenRisk } from '../pollen/index.js';
import { RISK_LEVEL_LABELS, RISK_LEVEL_MAX } from '../pollen/risk.js';
import { locationLabel } from '../locations.js';

export const DEVICE_TYPE = 'pollen-station';

const logger = createLogger({ name: DEVICE_TYPE });

/** Non-taxon features. Prefixed to never collide with a taxon key. */
export const FEATURE = {
  OVERALL_RISK: 'overall-risk',
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

/** English display name of a taxon (feature names are not translated by Gladys). */
export function taxonName(taxon) {
  return TAXON_NAMES[taxon]?.en ?? taxon;
}

/** French display name of a taxon, for the action messages. */
export function taxonNameFr(taxon) {
  return TAXON_NAMES[taxon]?.fr ?? taxon;
}

/** External ids of the device of a location. */
export function deviceExternalIds(gladys, location) {
  return gladys.externalIds(DEVICE_TYPE, location.id);
}

/**
 * Build the discovery payload of one location.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 * @param {{ poll_frequency: number }} config
 */
export function buildDevice(gladys, location, config) {
  const ids = deviceExternalIds(gladys, location);

  const taxonFeatures = allTaxa().map((taxon) => ({
    name: `${taxonName(taxon)} pollen risk`,
    external_id: ids.feature(taxon),
    category: DEVICE_FEATURE_CATEGORIES.RISK,
    type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
    min: 0,
    max: RISK_LEVEL_MAX,
    read_only: true,
    has_feedback: false,
    keep_history: true,
  }));

  return {
    name: `Pollen ${locationLabel(location)}`,
    external_id: ids.device,
    // Gladys calls onPoll at this interval (in seconds).
    poll_frequency: config.poll_frequency,
    // Keep the resolved position on the device: useful when debugging a wrong
    // town, and it survives a restart independently of the configuration.
    params: [
      { name: 'LOCATION_ID', value: location.id },
      { name: 'COUNTRY', value: location.country },
      { name: 'POSTAL_CODE', value: location.postal_code },
      { name: 'CITY', value: location.city },
      { name: 'LATITUDE', value: String(location.latitude) },
      { name: 'LONGITUDE', value: String(location.longitude) },
    ],
    features: [
      {
        name: 'Overall pollen risk',
        external_id: ids.feature(FEATURE.OVERALL_RISK),
        category: DEVICE_FEATURE_CATEGORIES.RISK,
        type: DEVICE_FEATURE_TYPES.RISK.INTEGER,
        min: 0,
        max: RISK_LEVEL_MAX,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
      ...taxonFeatures,
      {
        name: 'Dominant pollen',
        external_id: ids.feature(FEATURE.DOMINANT_POLLEN),
        category: DEVICE_FEATURE_CATEGORIES.TEXT,
        type: DEVICE_FEATURE_TYPES.TEXT.TEXT,
        read_only: true,
        has_feedback: false,
        keep_history: true,
      },
    ],
  };
}

/**
 * Build the `publishStates` batch of one location from a provider reading.
 * Split out of `poll()` so the mapping "reading -> states" is testable without
 * a Gladys connection.
 * @returns {Array<{ device_feature_external_id: string, state?: number, text?: string }>}
 */
export function buildStates(ids, reading) {
  const states = [];

  for (const [taxon, level] of Object.entries(reading.risks)) {
    // A taxon the provider has no value for publishes nothing at all: an
    // absent measurement is not a zero risk, and writing 0 would pollute the
    // history and could fire a "risk is back to none" scene.
    if (level !== null && level !== undefined) {
      states.push({ device_feature_external_id: ids.feature(taxon), state: level });
    }
  }

  if (reading.overall.level !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK),
      state: reading.overall.level,
    });
    states.push({
      device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLEN),
      text: reading.overall.taxon ? taxonName(reading.overall.taxon) : 'None',
    });
  }

  return states;
}

/**
 * Read a location and publish its states.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('../locations.js').Location} location
 */
export async function poll(gladys, location) {
  const ids = deviceExternalIds(gladys, location);
  logger.info(`Polling pollen risk for ${locationLabel(location)}...`);

  // ------------------------------------------------------------------ //
  // DO THE WORK: read the pollen concentrations and grade them.
  // ------------------------------------------------------------------ //
  const reading = await readPollenRisk(location);

  const states = buildStates(ids, reading);
  if (states.length === 0) {
    logger.warn(`No pollen data for ${locationLabel(location)}, nothing published`);
    return reading;
  }

  const overall = RISK_LEVEL_LABELS[reading.overall.level]?.en ?? 'unknown';
  logger.info(
    `${locationLabel(location)}: overall risk ${reading.overall.level} (${overall})` +
      `${reading.overall.taxon ? `, dominant ${taxonName(reading.overall.taxon)}` : ''}`,
  );

  // One request for every feature of the device (batch, up to 100).
  await gladys.publishStates(states);
  return reading;
}

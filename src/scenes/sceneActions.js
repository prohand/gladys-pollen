// -----------------------------------------------------------------------------
// Scene ACTIONS: what a scene can ASK this integration to do.
//
// Two of them, and the first is the reason the second exists:
//
//   - `get_pollen_risk` reads a place NOW and hands the scene the level, the
//     dominant pollen and a ready-made sentence. That is what turns "every day
//     at 7 am" into "every day at 7 am, tell me the pollen risk": a scene can
//     read a device feature, but it cannot turn 4 into "risque 4/5 (élevé),
//     dominant Bouleau" on its own.
//   - `refresh_pollen` re-reads and republishes, for the scene that wants a
//     fresh value before looking at the features themselves.
//
// Two rules of the contract shape the code below:
//
//   - AN ACTION IS NEVER A CONDITION. Throwing fails this action only; the
//     scene logs it and runs the next one anyway. So "no data" is an OUTPUT
//     (`level: null`) the scene author can test, not an exception. Only a
//     genuinely broken call — an unknown device, an unreachable provider —
//     throws.
//   - OUTPUTS ARE SCALARS, under the declared keys: the core drops everything
//     else and coerces each value to its declared type.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatDateTime } from '../dateTime.js';
import { DEFAULT_LANGUAGE } from '../language.js';
import {
  findLocationByDeviceId,
  refreshLocations,
  watchedLocations,
} from '../devices/pollenStation.js';
import { readPollenRisk } from '../pollen/index.js';
import { taxonName } from '../pollen/taxa.js';
import { levelLabel, noDataSummary, overallSummary, taxonSummary } from '../riskText.js';
import { nudgeWidgets } from '../widgets/keys.js';

const logger = createLogger({ name: 'scene-actions' });

/** The `taxon` option that means "the worst species of the moment". */
export const OVERALL_TAXON = 'overall';

/** Same reason as everywhere else: a number is never a valid taxon key. */
function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * The location a scene field designates, or a thrown error naming the id.
 *
 * Throwing is right here: a scene pointing at a device this integration no
 * longer watches is a scene to fix, and the message is what the scene log
 * shows its author.
 */
function requireLocation(gladys, config, externalId) {
  const location = findLocationByDeviceId(gladys, config, String(externalId ?? ''));
  if (!location) {
    throw new Error(`No location watches the device ${externalId}`);
  }
  return location;
}

export const SCENE_ACTION_HANDLERS = {
  /**
   * Read one place and answer the declared outputs.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ fields: Record<string, unknown>, config: object }} context
   */
  async get_pollen_risk(gladys, { fields, config }) {
    const language = config.language ?? DEFAULT_LANGUAGE;
    const location = requireLocation(gladys, config, fields?.location);
    const wanted = String(fields?.taxon ?? OVERALL_TAXON);
    logger.info(`Scene action get_pollen_risk -> ${location.name} (${wanted})`);

    const reading = await readPollenRisk(location);
    const measuredAt = formatDateTime(reading.measuredAt, language) ?? '';

    // Which number the scene asked for: the worst species of the moment, or
    // one named species.
    const overall = wanted === OVERALL_TAXON;
    const level = overall ? reading.overall.level : (reading.risks?.[wanted] ?? null);
    // For the overall reading the species is the DOMINANT one, which is null
    // below level 1 — naming one there would be inventing it.
    const taxon = overall ? reading.overall.taxon : wanted;

    if (level === null || level === undefined) {
      // The model has no value for this place, or for this species. Not a
      // failure: an output the scene can branch on.
      return {
        level: null,
        level_label: '',
        taxon: overall ? '' : wanted,
        taxon_name: overall ? '' : taxonName(wanted, language),
        concentration: null,
        location_name: location.name,
        measured_at: measuredAt,
        summary: noDataSummary({ locationName: location.name }, language),
      };
    }

    return {
      level,
      level_label: levelLabel(level, language),
      taxon: taxon ?? '',
      taxon_name: taxon ? taxonName(taxon, language) : '',
      concentration: taxon ? numberOrNull(reading.concentrations?.[taxon]) : null,
      location_name: location.name,
      measured_at: measuredAt,
      summary: overall
        ? overallSummary({ locationName: location.name, level, taxon }, language)
        : taxonSummary({ locationName: location.name, taxon: wanted, level }, language),
    };
  },

  /**
   * Re-read one place, or every one of them, and republish the states.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ fields: Record<string, unknown>, config: object }} context
   */
  async refresh_pollen(gladys, { fields, config }) {
    const language = config.language ?? DEFAULT_LANGUAGE;
    // An empty `location` is the wildcard the field documents: every place.
    const chosen = String(fields?.location ?? '').trim();
    const locations = chosen ? [requireLocation(gladys, config, chosen)] : watchedLocations(config);
    logger.info(`Scene action refresh_pollen -> ${locations.length} location(s)`);

    // One place failing must not cost the others their refresh: the scene
    // gets the two counts rather than a stack trace.
    const counts = await refreshLocations(gladys, locations, language);
    nudgeWidgets(gladys);
    return counts;
  },
};

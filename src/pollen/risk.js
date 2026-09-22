// -----------------------------------------------------------------------------
// Concentration (grains/m³) -> risk level.
//
// The providers all return a raw pollen concentration in grains of pollen per
// cubic metre of air. A raw concentration means nothing to a user: 30 grains/m³
// is a quiet day for birch and a heavy one for ragweed. This module owns the
// per-taxon thresholds that turn a concentration into the 0-3 risk level the
// Gladys features expose.
//
// Thresholds follow the bands published by the European Aeroallergen Network
// (EAN) and reused by the CAMS pollen products: the allergenic power of a
// species drives the scale, not the absolute count.
//
// THE SCALE IS GLADYS'S, not this integration's. A `risk`/`integer` feature is
// rendered by the core through its OWN label set — `no-risk`, `low-risk`,
// `medium-risk`, `high-risk` — and a value it cannot name reads "Inconnu" in
// the "device in a room" box. Publishing on any other scale means the box, the
// widget and the scenes disagree about what a "3" is, so the six EAN bands are
// folded onto the four levels the core knows:
//
//   EAN band              | published level | what Gladys calls it
//   ----------------------|-----------------|---------------------
//   none                  | 0               | Pas de risque
//   very low / low        | 1               | Faible
//   moderate              | 2               | Moyen
//   high / very high      | 3               | Élevé
//
// Nothing is invented by the fold: the two quiet bands were already "barely
// there", and the two loud ones both mean "stay inside if you react to it".
// -----------------------------------------------------------------------------

/** The 0-3 risk scale of the Gladys core, exposed by every pollen feature. */
export const RISK_LEVELS = {
  NONE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
};

/** Maximum value of the scale, mirrored in the feature `max`. */
export const RISK_LEVEL_MAX = RISK_LEVELS.HIGH;

/**
 * Human labels of each level, for the logs, the action messages and the TEXT
 * features. They are the core's own words (`No Risk` / `Low` / `Medium` /
 * `High`), in lower case because they read inside a sentence here.
 */
export const RISK_LEVEL_LABELS = {
  0: { en: 'no risk', fr: 'pas de risque' },
  1: { en: 'low', fr: 'faible' },
  2: { en: 'medium', fr: 'moyen' },
  3: { en: 'high', fr: 'élevé' },
};

// Upper bounds (grains/m³, exclusive) of levels 1 and 2; anything at or above
// the last bound is level 3. A concentration of exactly 0 stays at level 0.
//
// These are the EAN bands with the two folds above already applied: the first
// bound is where "low" ends (the "very low" one disappeared into it), and the
// last is where "high" starts (nothing above it is distinguished any more).
//
// Trees release far more pollen than herbs, so the tree bands are an order of
// magnitude wider than the ragweed/mugwort ones for the same perceived risk.
const THRESHOLDS = {
  alder: [10, 70],
  birch: [10, 70],
  olive: [10, 50],
  grass: [5, 20],
  mugwort: [5, 25],
  ragweed: [5, 20],
};

/** Fallback bands for a taxon added by a future provider without thresholds. */
const DEFAULT_THRESHOLDS = [10, 50];

/**
 * Convert a concentration into the 0-3 risk level of a given taxon.
 * @param {string} taxon pollen taxon key, e.g. 'birch'
 * @param {number|null|undefined} concentration grains/m³, or null when the
 *   provider has no value for this taxon at this position
 * @returns {number|null} the risk level, or null when there is no data
 */
export function concentrationToRiskLevel(taxon, concentration) {
  if (
    concentration === null ||
    concentration === undefined ||
    Number.isNaN(Number(concentration))
  ) {
    return null;
  }
  const value = Number(concentration);
  if (value <= 0) {
    return RISK_LEVELS.NONE;
  }
  const bounds = THRESHOLDS[taxon] ?? DEFAULT_THRESHOLDS;
  for (let level = 0; level < bounds.length; level += 1) {
    if (value < bounds[level]) {
      return level + 1;
    }
  }
  return RISK_LEVELS.HIGH;
}

/**
 * Overall risk of a location: the worst taxon wins. A user allergic to a single
 * species still wants a single "should I close the windows?" number, and the
 * per-taxon features stay available for the fine-grained scenes.
 * @param {Record<string, number|null>} riskByTaxon
 * @returns {{ level: number|null, taxon: string|null }}
 */
export function overallRisk(riskByTaxon) {
  let level = null;
  let taxon = null;
  for (const [key, value] of Object.entries(riskByTaxon)) {
    if (value === null || value === undefined) {
      continue;
    }
    if (level === null || value > level) {
      level = value;
      taxon = key;
    }
  }
  // Nothing in the air: no taxon deserves to be called "dominant".
  return { level, taxon: level > RISK_LEVELS.NONE ? taxon : null };
}

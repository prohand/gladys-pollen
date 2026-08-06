// -----------------------------------------------------------------------------
// Concentration (grains/m³) -> risk level.
//
// The providers all return a raw pollen concentration in grains of pollen per
// cubic metre of air. A raw concentration means nothing to a user: 30 grains/m³
// is a quiet day for birch and a heavy one for ragweed. This module owns the
// per-taxon thresholds that turn a concentration into the 0-5 risk level the
// Gladys features expose.
//
// Thresholds follow the bands published by the European Aeroallergen Network
// (EAN) and reused by the CAMS pollen products: the allergenic power of a
// species drives the scale, not the absolute count.
// -----------------------------------------------------------------------------

/** The 0-5 risk scale exposed by every pollen feature. */
export const RISK_LEVELS = {
  NONE: 0,
  VERY_LOW: 1,
  LOW: 2,
  MODERATE: 3,
  HIGH: 4,
  VERY_HIGH: 5,
};

/** Maximum value of the scale, mirrored in the feature `max`. */
export const RISK_LEVEL_MAX = RISK_LEVELS.VERY_HIGH;

/** Human labels of each level, for the logs and the action messages. */
export const RISK_LEVEL_LABELS = {
  0: { en: 'none', fr: 'nul' },
  1: { en: 'very low', fr: 'très faible' },
  2: { en: 'low', fr: 'faible' },
  3: { en: 'moderate', fr: 'moyen' },
  4: { en: 'high', fr: 'élevé' },
  5: { en: 'very high', fr: 'très élevé' },
};

// Upper bounds (grains/m³, exclusive) of levels 1 to 4; anything at or above
// the last bound is level 5. A concentration of exactly 0 stays at level 0.
//
// Trees release far more pollen than herbs, so the tree bands are an order of
// magnitude wider than the ragweed/mugwort ones for the same perceived risk.
const THRESHOLDS = {
  alder: [1, 10, 70, 300],
  birch: [1, 10, 70, 300],
  olive: [1, 10, 50, 200],
  grass: [1, 5, 20, 200],
  mugwort: [1, 5, 25, 50],
  ragweed: [1, 5, 20, 50],
};

/** Fallback bands for a taxon added by a future provider without thresholds. */
const DEFAULT_THRESHOLDS = [1, 10, 50, 150];

/**
 * Convert a concentration into the 0-5 risk level of a given taxon.
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
  return RISK_LEVELS.VERY_HIGH;
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

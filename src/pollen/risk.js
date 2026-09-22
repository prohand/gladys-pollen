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
//
// The fold still loses something a user can feel — "élevé" and "très élevé"
// both read 3 — so the BAND itself survives next to the folded level, for the
// TEXT features of a station and for them only (see `concentrationToEanLevel`
// and `src/riskText.js`). A string is not graded by the core: it can say
// "5/5 (très élevé)" where the number next to it has to say 3.
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

/**
 * The six EAN bands, 0 to 5 — the measurement as the network actually
 * publishes it, before the fold onto the four levels Gladys can name.
 *
 * It is NOT a second published scale: no `risk`/`integer` feature ever carries
 * it, because the core would read a 4 or a 5 as "Inconnu". It exists for the
 * TEXT features of a station, which are plain strings nobody downstream
 * interprets: there, "4/5 (élevé)" and "5/5 (très élevé)" say what the fold has
 * to throw away, next to the 0-3 index the badge, the widgets and the scenes
 * keep working on.
 */
export const EAN_LEVELS = {
  NONE: 0,
  VERY_LOW: 1,
  LOW: 2,
  MODERATE: 3,
  HIGH: 4,
  VERY_HIGH: 5,
};

/** Maximum value of the EAN scale — the "/5" of the text features. */
export const EAN_LEVEL_MAX = EAN_LEVELS.VERY_HIGH;

/** Human labels of the six EAN bands, for the TEXT features. */
export const EAN_LEVEL_LABELS = {
  0: { en: 'none', fr: 'nul' },
  1: { en: 'very low', fr: 'très faible' },
  2: { en: 'low', fr: 'faible' },
  3: { en: 'moderate', fr: 'moyen' },
  4: { en: 'high', fr: 'élevé' },
  5: { en: 'very high', fr: 'très élevé' },
};

/**
 * THE fold, in one place: which core level each EAN band lands on.
 *
 * Indexed by EAN level, so `FOLD_TO_CORE[4] === RISK_LEVELS.HIGH`. Everything
 * published as a number goes through it; the text features are the only thing
 * that reads the EAN level itself.
 */
const FOLD_TO_CORE = [
  RISK_LEVELS.NONE, // none        -> pas de risque
  RISK_LEVELS.LOW, // very low    -> faible
  RISK_LEVELS.LOW, // low         -> faible
  RISK_LEVELS.MEDIUM, // moderate    -> moyen
  RISK_LEVELS.HIGH, // high        -> élevé
  RISK_LEVELS.HIGH, // very high   -> élevé
];

// Upper bounds (grains/m³, exclusive) of EAN bands 1 to 4; anything at or above
// the last bound is band 5. A concentration of exactly 0 stays at band 0.
//
// These are the bands as the EAN publishes them, which is why there are five of
// them and not two: the fold above is what turns them into the core scale, and
// the text features need the band itself.
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
 * Convert a concentration into the 0-5 EAN band of a given taxon.
 *
 * The raw measurement, for the TEXT features only. Everything numeric goes
 * through `concentrationToRiskLevel` below.
 * @param {string} taxon pollen taxon key, e.g. 'birch'
 * @param {number|null|undefined} concentration grains/m³, or null when the
 *   provider has no value for this taxon at this position
 * @returns {number|null} the EAN band, or null when there is no data
 */
export function concentrationToEanLevel(taxon, concentration) {
  if (
    concentration === null ||
    concentration === undefined ||
    Number.isNaN(Number(concentration))
  ) {
    return null;
  }
  const value = Number(concentration);
  if (value <= 0) {
    return EAN_LEVELS.NONE;
  }
  const bounds = THRESHOLDS[taxon] ?? DEFAULT_THRESHOLDS;
  for (let band = 0; band < bounds.length; band += 1) {
    if (value < bounds[band]) {
      return band + 1;
    }
  }
  return EAN_LEVELS.VERY_HIGH;
}

/**
 * Fold an EAN band onto the core scale. Missing data stays missing.
 * @param {number|null|undefined} eanLevel
 * @returns {number|null}
 */
export function foldEanLevel(eanLevel) {
  if (eanLevel === null || eanLevel === undefined) {
    return null;
  }
  return FOLD_TO_CORE[eanLevel] ?? RISK_LEVELS.HIGH;
}

/**
 * Convert a concentration into the 0-3 risk level of a given taxon.
 *
 * The EAN band, folded onto the scale the Gladys core can name. This is what
 * every `risk`/`integer` feature, widget and scene works on.
 * @param {string} taxon pollen taxon key, e.g. 'birch'
 * @param {number|null|undefined} concentration grains/m³, or null when the
 *   provider has no value for this taxon at this position
 * @returns {number|null} the risk level, or null when there is no data
 */
export function concentrationToRiskLevel(taxon, concentration) {
  return foldEanLevel(concentrationToEanLevel(taxon, concentration));
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

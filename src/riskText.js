// -----------------------------------------------------------------------------
// How a pollen risk is SAID, in one place.
//
// Four surfaces now put the same risk into words: the overall-risk TEXT feature
// of a station, the data of a scene event, the outputs of a scene action, and
// the rows of a dashboard widget. They all come here, so "risque 3/3 (élevé)"
// is written the same way everywhere and a wording fix lands in all of them at
// once. The words themselves are the core's own (see RISK_LEVEL_LABELS), so a
// card and the badge of the "device in a room" box never disagree.
//
// The one exception is `eanLevelText`: the TEXT features of a station say the
// MEASURED band, 0 to 5, because a string is the only thing here the core does
// not re-label. See `src/pollen/risk.js` for the fold and why the numbers stay
// on the core's 0-3 scale.
//
// Each helper takes a language rather than returning `{ en, fr }`, because
// everything it feeds is a PLAIN STRING the core stores or substitutes as it
// is: a scene event variable, an action output, a widget row. The language is
// `config.language` — the same one the device names use, and for the same
// reason (see src/language.js).
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE, inLanguage } from './language.js';
import {
  EAN_LEVEL_LABELS,
  EAN_LEVEL_MAX,
  RISK_LEVEL_LABELS,
  RISK_LEVEL_MAX,
} from './pollen/risk.js';
import { taxonName } from './pollen/taxa.js';

/** Wording of a level: `3` -> "élevé". An unknown level answers "?". */
export function levelLabel(level, language = DEFAULT_LANGUAGE) {
  const labels = RISK_LEVEL_LABELS[level];
  return labels ? inLanguage(labels, language) : '?';
}

/** `3` -> "3/3 (élevé)", the scale and the word the whole integration uses. */
export function levelText(level, language = DEFAULT_LANGUAGE) {
  return `${level}/${RISK_LEVEL_MAX} (${levelLabel(level, language)})`;
}

/** Wording of an EAN band: `5` -> "très élevé". An unknown band answers "?". */
export function eanLevelLabel(eanLevel, language = DEFAULT_LANGUAGE) {
  const labels = EAN_LEVEL_LABELS[eanLevel];
  return labels ? inLanguage(labels, language) : '?';
}

/**
 * The same sentence on the measured scale: `5` -> "5/5 (très élevé)".
 *
 * ONLY the TEXT features of a station use it. They are the one surface that
 * can carry the band the fold throws away: a stored string is displayed as it
 * is, where a `risk`/`integer` would be re-labelled by the core and read
 * "Inconnu" above 3. Everything that goes with a number — the widget rows next
 * to a gauge, the scene events and the action outputs whose level is the 0-3
 * one — keeps `levelText`, so a card never shows a "/5" beside a "/3".
 */
export function eanLevelText(eanLevel, language = DEFAULT_LANGUAGE) {
  return `${eanLevel}/${EAN_LEVEL_MAX} (${eanLevelLabel(eanLevel, language)})`;
}

const OVERALL_SENTENCE = {
  en: (place, level, dominant) =>
    `Pollen in ${place}: risk ${level}${dominant ? `, dominant ${dominant}` : ''}.`,
  fr: (place, level, dominant) =>
    `Pollens à ${place} : risque ${level}${dominant ? `, dominant ${dominant}` : ''}.`,
};

const NO_DATA_SENTENCE = {
  en: (place) => `Pollen in ${place}: no data available.`,
  fr: (place) => `Pollens à ${place} : données indisponibles.`,
};

const TAXON_SENTENCE = {
  en: (place, species, level) => `${species} in ${place}: risk ${level}.`,
  fr: (place, species, level) => `${species} à ${place} : risque ${level}.`,
};

/**
 * The one-line sentence a scene drops into a notification, or a widget shows.
 *
 * `taxon` is the DOMINANT species of an overall reading — null below level 1,
 * where naming a species would be inventing one.
 * @param {{ locationName: string, level: number, taxon?: string|null }} reading
 * @param {string} [language] one of LANGUAGES
 * @returns {string} e.g. `Pollens à Montauban : risque 3/3 (élevé), dominant Bouleau.`
 */
export function overallSummary({ locationName, level, taxon = null }, language = DEFAULT_LANGUAGE) {
  return inLanguage(OVERALL_SENTENCE, language)(
    locationName,
    levelText(level, language),
    taxon ? taxonName(taxon, language) : null,
  );
}

/**
 * The same sentence about ONE species, for the per-taxon trigger and for the
 * scene action reading a single pollen.
 * @param {{ locationName: string, taxon: string, level: number }} reading
 * @param {string} [language] one of LANGUAGES
 * @returns {string} e.g. `Bouleau à Montauban : risque 3/3 (élevé).`
 */
export function taxonSummary({ locationName, taxon, level }, language = DEFAULT_LANGUAGE) {
  return inLanguage(TAXON_SENTENCE, language)(
    locationName,
    taxonName(taxon, language),
    levelText(level, language),
  );
}

/**
 * What a reading says when the model has no value at all.
 *
 * Returned rather than thrown by the scene action: a scene action is never a
 * condition, so "I could not read it" has to travel as an output the scene
 * author can test, not as a failure that stops nothing.
 * @param {{ locationName: string }} reading
 * @param {string} [language] one of LANGUAGES
 */
export function noDataSummary({ locationName }, language = DEFAULT_LANGUAGE) {
  return inLanguage(NO_DATA_SENTENCE, language)(locationName);
}

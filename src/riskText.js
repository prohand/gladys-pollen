// -----------------------------------------------------------------------------
// How a pollen risk is SAID, in one place.
//
// Three surfaces now put the same risk into words: the data of a scene event,
// the outputs of a scene action, and the rows of a dashboard widget. They all
// come here, so "risque 4/5 (élevé)" is written the same way everywhere and a
// wording fix lands in all of them at once.
//
// Each helper takes a language rather than returning `{ en, fr }`, because
// everything it feeds is a PLAIN STRING the core stores or substitutes as it
// is: a scene event variable, an action output, a widget row. The language is
// `config.language` — the same one the device names use, and for the same
// reason (see src/language.js).
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE, inLanguage } from './language.js';
import { RISK_LEVEL_LABELS, RISK_LEVEL_MAX } from './pollen/risk.js';
import { taxonName } from './pollen/taxa.js';

/** Wording of a 0-5 level: `4` -> "élevé". An unknown level answers "?". */
export function levelLabel(level, language = DEFAULT_LANGUAGE) {
  const labels = RISK_LEVEL_LABELS[level];
  return labels ? inLanguage(labels, language) : '?';
}

/** `4` -> "4/5 (élevé)", the scale and the word the whole integration uses. */
export function levelText(level, language = DEFAULT_LANGUAGE) {
  return `${level}/${RISK_LEVEL_MAX} (${levelLabel(level, language)})`;
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
 * @returns {string} e.g. `Pollens à Montauban : risque 4/5 (élevé), dominant Bouleau.`
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
 * @returns {string} e.g. `Bouleau à Montauban : risque 4/5 (élevé).`
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

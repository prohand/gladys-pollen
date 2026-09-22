// -----------------------------------------------------------------------------
// The names of the pollen taxa, in the languages this integration writes.
//
// They live here rather than next to the device that displays them, because
// three surfaces now say "Bouleau": the feature names of the station, the data
// of a scene event, and the rows of a dashboard widget. A shared module is what
// keeps the word identical in all three — and what keeps the modules that only
// need the vocabulary from importing the whole device blueprint.
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE, inLanguage } from '../language.js';

/** Display names of the taxa, used to build the feature names. */
export const TAXON_NAMES = {
  alder: { en: 'Alder', fr: 'Aulne' },
  birch: { en: 'Birch', fr: 'Bouleau' },
  grass: { en: 'Grass', fr: 'Graminées' },
  mugwort: { en: 'Mugwort', fr: 'Armoise' },
  olive: { en: 'Olive', fr: 'Olivier' },
  ragweed: { en: 'Ragweed', fr: 'Ambroisie' },
};

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

// -----------------------------------------------------------------------------
// The `test_provider` button: "is the pollen data source working, here?"
//
// A live read of EVERY watched location, answered as one line per place in the
// exact format of the location listing (`• n. name — detail`), so the two
// buttons of the Configuration screen talk about the same list under the same
// numbers. It publishes NOTHING: a check is not a refresh, and the
// states stay the business of src/refresh.js — whose failure wording it shares,
// so a line here and the connection status blame the same party.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatDateTime } from './dateTime.js';
import { DEVICE_TYPE, watchedLocations } from './devices/pollenStation.js';
import { inEveryLanguage } from './language.js';
import { LOCATION_LINE_SEPARATOR, locationLine, positionOf } from './locations.js';
import { readPollenRisks } from './pollen/index.js';
import { taxonName } from './pollen/taxa.js';
import { failureDetail } from './refresh.js';
import { levelText } from './riskText.js';

// Same name as before the split, like src/refresh.js.
const logger = createLogger({ name: DEVICE_TYPE });

const NO_LOCATION_MESSAGE = {
  en: 'No location with usable coordinates yet. Add one with "Add a location".',
  fr: 'Aucun lieu avec des coordonnées utilisables. Ajoutez-en un avec « Ajouter un lieu ».',
  de: 'Noch kein Ort mit verwendbaren Koordinaten. Fügen Sie einen mit „Ort hinzufügen“ hinzu.',
  es: 'Aún no hay ningún lugar con coordenadas utilizables. Añada uno con «Añadir un lugar».',
};

/**
 * A header plus one line per location, in every language — EXACTLY the format of
 * the location listing (`• n. name — detail`, built by the same `locationLine`),
 * because both actions answer about the same list under the same numbers.
 */
function report(header, lines) {
  const join = (language) =>
    lines
      .map((line) => locationLine(line.position, line.name, line[language]))
      .join(LOCATION_LINE_SEPARATOR);
  return inEveryLanguage(
    (language) => `${header[language]}${LOCATION_LINE_SEPARATOR}${join(language)}`,
  );
}

/**
 * Read every location — in one request when the provider can — and describe
 * each one, turning a failure into a LINE rather than into a rejection: one
 * location the provider refuses must not hide the answer of the others, and a
 * bare error naming no location helps nobody.
 * @param {(reading: object) => { en: string, fr: string, de: string, es: string }} describe
 */
async function readEachLocation(config, locations, describe) {
  const outcomes = await readPollenRisks(locations);
  const lines = outcomes.map(({ location, reading, error }) => {
    const entry = { position: positionOf(config.locations, location.id), name: location.name };
    if (error) {
      logger.error(`Pollen query failed for ${location.name}`, error);
      return { ...entry, failed: true, ...failureDetail(error) };
    }
    return { ...entry, failed: false, ...describe(reading) };
  });
  return { lines, failed: lines.filter((line) => line.failed).length };
}

/**
 * Manifest actions answered here, keyed by the action `key` declared in
 * `gladys-assistant-integration.json`. Each handler takes the SDK and the
 * current configuration, and RETURNS its `{ en, fr, de, es }` message.
 */
export const PROVIDER_ACTIONS = {
  /**
   * Live check of the data source, on EVERY location: "is it working?" is a
   * question about the install, not about one entry of a list, and nothing in
   * this screen designates a single location anyway.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {{ config: object }} context
   * @returns {Promise<{ en: string, fr: string, de: string, es: string }>}
   */
  async test_provider(gladys, { config }) {
    const locations = watchedLocations(config);
    if (locations.length === 0) {
      return NO_LOCATION_MESSAGE;
    }
    logger.info(`Action test_provider -> live request for ${locations.length} location(s)`);

    const { lines, failed } = await readEachLocation(config, locations, (reading) => {
      const level = reading.overall.level ?? 0;
      const dominant = reading.overall.taxon;
      // "It answers" and "it answers something recent" are two different
      // questions, and this action is where both are asked.
      const measuredAt = (language, prefix) => {
        const at = formatDateTime(reading.measuredAt, language);
        return at ? `, ${prefix} ${at}` : '';
      };
      const words = {
        en: { risk: 'risk', dominant: 'dominant', updated: 'updated' },
        fr: { risk: 'risque', dominant: 'dominant', updated: 'à jour au' },
        de: { risk: 'Risiko', dominant: 'vorherrschend', updated: 'Stand' },
        es: { risk: 'riesgo', dominant: 'dominante', updated: 'actualizado el' },
      };
      return inEveryLanguage(
        (language) =>
          `${words[language].risk} ${levelText(level, language)}` +
          `${dominant ? `, ${words[language].dominant} ${taxonName(dominant, language)}` : ''}` +
          ` — ${reading.provider}` +
          measuredAt(language, words[language].updated),
      );
    });

    // "Provider OK" only when it actually is: the header counts the locations
    // that failed, and each of their lines says why.
    const header =
      failed === 0
        ? {
            en: `Pollen provider OK — ${locations.length} location(s):`,
            fr: `Fournisseur de pollens OK — ${locations.length} lieu(x) :`,
            de: `Pollenanbieter OK — ${locations.length} Ort(e):`,
            es: `Proveedor de polen OK — ${locations.length} lugar(es):`,
          }
        : {
            en: `Pollen provider — ${failed} of ${locations.length} location(s) failing:`,
            fr: `Fournisseur de pollens — ${failed} lieu(x) en échec sur ${locations.length} :`,
            de: `Pollenanbieter — ${failed} von ${locations.length} Ort(en) fehlgeschlagen:`,
            es: `Proveedor de polen — ${failed} de ${locations.length} lugar(es) con error:`,
          };
    return report(header, lines);
  },
};

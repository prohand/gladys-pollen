// -----------------------------------------------------------------------------
// Country: FRANCE.
//
// Turns a French postal code into the towns it covers and their coordinates,
// through the official "API Découpage administratif" (API Géo) operated by
// data.gouv.fr / Etalab: open data, no account, no API key.
//
//   https://geo.api.gouv.fr/decoupage-administratif/communes
//
// A postal code is NOT a town: 44120 covers a single commune, while 05100
// covers several. The lookup therefore returns a LIST, and the caller asks the
// user to disambiguate when needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'country-fr' });

const GEO_API_URL = 'https://geo.api.gouv.fr/communes';

export const franceCountry = {
  code: 'FR',

  label: { en: 'France', fr: 'France' },

  /** French postal codes are exactly five digits. */
  postalCodePattern: /^[0-9]{5}$/,

  postalCodeExample: '75001',

  /** Shown in the error message when the postal code does not match. */
  postalCodeHint: {
    en: 'A French postal code is 5 digits, e.g. 75001.',
    fr: 'Un code postal français comporte 5 chiffres, par exemple 75001.',
  },

  /**
   * Look up every town of a postal code.
   * @param {string} postalCode a validated postal code
   * @returns {Promise<Array<{ city: string, latitude: number, longitude: number, adminCode: string }>>}
   */
  async searchPostalCode(postalCode) {
    const url =
      `${GEO_API_URL}?codePostal=${encodeURIComponent(postalCode)}` +
      `&fields=nom,code,centre&format=json`;

    logger.debug('API Géo request ->', url);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`API Géo HTTP ${response.status}`);
    }

    const body = await response.json();
    if (!Array.isArray(body)) {
      throw new Error('API Géo returned an unexpected payload');
    }

    return body
      .filter((commune) => Array.isArray(commune.centre?.coordinates))
      .map((commune) => ({
        city: commune.nom,
        // GeoJSON stores coordinates as [longitude, latitude].
        longitude: Number(commune.centre.coordinates[0]),
        latitude: Number(commune.centre.coordinates[1]),
        // INSEE code: stable identifier of the commune, kept so a town that is
        // renamed or merged can still be traced back.
        adminCode: String(commune.code),
      }));
  },
};

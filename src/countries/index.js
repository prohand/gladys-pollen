// -----------------------------------------------------------------------------
// Country registry.
//
// A country knows ONE thing: how to turn a postal code into towns with
// coordinates. Everything downstream (pollen provider, devices, features) works
// on latitude/longitude and never asks which country a location is in — that is
// what makes adding a country cheap.
//
// To add a country:
//   1. create `src/countries/<code>.js` exposing { code, label,
//      postalCodePattern, postalCodeExample, postalCodeHint,
//      searchPostalCode(postalCode) }, backed by an open, key-free geocoder;
//   2. append it to COUNTRIES below;
//   3. add the matching option to the `country` field of the `add_location`
//      action in `gladys-assistant-integration.json`.
//
// Nothing else changes: the manifest option list and this array are kept in
// sync by a unit test, so a forgotten step fails CI instead of the user's
// install.
// -----------------------------------------------------------------------------

import { franceCountry } from './fr.js';

export const COUNTRIES = [franceCountry];

/** The country used when the user does not pick one. */
export const DEFAULT_COUNTRY_CODE = franceCountry.code;

/**
 * Find a country by its ISO code (case-insensitive).
 * @param {string} code
 */
export function findCountry(code) {
  const normalized = String(code ?? '')
    .trim()
    .toUpperCase();
  return COUNTRIES.find((country) => country.code === normalized);
}

/** ISO codes of every supported country. */
export function supportedCountryCodes() {
  return COUNTRIES.map((country) => country.code);
}

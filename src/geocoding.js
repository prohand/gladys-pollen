// -----------------------------------------------------------------------------
// Turning what the user types into a POINT.
//
// WHY THERE IS NO COUNTRY ANYWHERE. Everything downstream — the pollen provider,
// the devices, the features — works on a latitude and a longitude. The country
// only ever existed here, as the registry that knew how to read a national
// postal code (France's API Géo). The pollen source itself is continental, so a
// per-country postal code lookup made the integration French while its data
// covers Europe. One worldwide geocoder removes that step entirely: no country
// field in the form, no registry to extend, no manifest option list to keep in
// sync with the code.
//
// Source: the Open-Meteo geocoding API — the same open, key-free, account-free
// house as the pollen forecast this integration already reads, backed by the
// GeoNames database.
//
//   https://open-meteo.com/en/docs/geocoding-api
//
// A place name is not unique (there are several Montauban, and a dozen Paris),
// so the search returns a LIST and the caller either finds ONE obvious answer or
// shows the candidates and asks the user to be more precise. The user narrows it
// down with commas — "Montauban, Tarn-et-Garonne", "Paris, France" — which is
// what `hints` below filter on; nothing is ever picked by coin flip, since the
// wrong pick silently reports another town's pollen.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'geocoding' });

// Overridable for local development; the default is the public API.
const API_BASE_URL = process.env.GEOCODING_API_URL ?? 'https://geocoding-api.open-meteo.com/v1';

const REQUEST_TIMEOUT_MS = 15_000;

// Enough alternatives to disambiguate a vague query without flooding the
// message displayed under the button.
const SEARCH_LIMIT = 10;

/** How many candidates a "be more precise" message lists. */
export const MAX_LISTED_CANDIDATES = 6;

/**
 * Case- and accent-insensitive form of a text, for comparing what the user typed
 * with what the geocoder answered. "Montauban" must match "MONTAUBAN" and
 * "Saint-Étienne" must match "saint-etienne".
 * @param {unknown} value
 */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Split what the user typed into the place NAME and the HINTS narrowing it down.
 *
 * The geocoder searches on a single name, so "Montauban, Tarn-et-Garonne" cannot
 * be sent as it is. Everything after the first comma is kept as a filter applied
 * to the answers instead — region, department, country, postal code, in any
 * order and in any combination.
 * @param {string} query
 * @returns {{ name: string, hints: string[] }}
 */
export function splitQuery(query) {
  const [name = '', ...rest] = String(query ?? '').split(',');
  return {
    name: name.trim(),
    hints: rest.map((hint) => hint.trim()).filter(Boolean),
  };
}

/**
 * Search a place name.
 * @param {string} name
 * @returns {Promise<Array<object>>} the matches, best first (the API ranks them
 *   by relevance then by population)
 */
export async function searchPlaces(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') {
    return [];
  }

  const params = new URLSearchParams({
    name: trimmed,
    count: String(SEARCH_LIMIT),
    language: 'fr',
    format: 'json',
  });
  const url = `${API_BASE_URL}/search?${params.toString()}`;
  logger.debug('Geocoding request ->', url);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Geocoding API HTTP ${response.status}`);
  }

  const body = await response.json();
  // No match at all: the API answers with no `results` key rather than an empty
  // array, which is not an error.
  return toPlaces(body?.results);
}

/**
 * A coordinate of the answer. `Number(null)` is 0 — a valid latitude in the
 * Gulf of Guinea — so a missing one must become NaN, which the filter below
 * drops.
 */
function toNumber(value) {
  return value === null || value === undefined || value === '' ? Number.NaN : Number(value);
}

/** The usable places of an answer: a place with no point is not one. */
function toPlaces(results) {
  return (Array.isArray(results) ? results : [])
    .map((result) => ({
      name: String(result?.name ?? ''),
      latitude: toNumber(result?.latitude),
      longitude: toNumber(result?.longitude),
      country: String(result?.country ?? ''),
      country_code: String(result?.country_code ?? ''),
      // admin1 is the region, admin2 the department, admin3 the district: what
      // tells two towns of the same name apart.
      admin1: String(result?.admin1 ?? ''),
      admin2: String(result?.admin2 ?? ''),
      admin3: String(result?.admin3 ?? ''),
      postcodes: Array.isArray(result?.postcodes) ? result.postcodes.map(String) : [],
    }))
    .filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
}

/** Everything a hint may match on, in one normalized string. */
function haystack(place) {
  return normalizeText(
    [
      place.name,
      place.admin1,
      place.admin2,
      place.admin3,
      place.country,
      place.country_code,
      ...place.postcodes,
    ].join(' '),
  );
}

/**
 * Keep the places matching EVERY hint. A hint the answers do not carry (a
 * misspelt department) empties the list rather than being ignored: "no place
 * found for what you typed" is honest, silently dropping the filter is not.
 * @param {Array<object>} places
 * @param {string[]} hints
 */
export function filterByHints(places = [], hints = []) {
  if (hints.length === 0) {
    return places;
  }
  return places.filter((place) => {
    const text = haystack(place);
    return hints.every((hint) => text.includes(normalizeText(hint)));
  });
}

/**
 * The one place to use, or null when the answer is too ambiguous to pick alone.
 *
 * A single candidate is the answer. Several candidates are only resolved when
 * exactly ONE of them is named exactly what the user typed — "Paris" among
 * "Paris", "Parisot" and "Parisel" is the town they meant; "Paris" among three
 * Paris is not, and asking beats guessing.
 * @param {Array<object>} places
 * @param {string} name what the user typed, without the hints
 */
export function pickPlace(places = [], name = '') {
  if (places.length === 0) {
    return null;
  }
  if (places.length === 1) {
    return places[0];
  }
  const wanted = normalizeText(name);
  const exact = places.filter((place) => normalizeText(place.name) === wanted);
  return exact.length === 1 ? exact[0] : null;
}

/**
 * Where a place is, without its name: what tells two homonyms apart.
 * @param {object} place
 */
export function placeContext(place) {
  return [place.admin2 || place.admin1, place.country].filter(Boolean).join(', ');
}

/**
 * One-line description of a place, for the message shown under the button.
 * @param {object} place
 */
export function describePlace(place) {
  const context = placeContext(place);
  return context ? `${place.name} (${context})` : place.name;
}

/**
 * Geocode, then either resolve to one place or hand the candidates back.
 * @param {string} query anything from "Montauban" to "Montauban, Tarn-et-Garonne"
 * @returns {Promise<{ match: object | null, candidates: Array<object> }>}
 */
export async function resolvePlace(query) {
  const { name, hints } = splitQuery(query);
  const candidates = filterByHints(await searchPlaces(name), hints);
  return { match: pickPlace(candidates, name), candidates };
}

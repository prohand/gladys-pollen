// -----------------------------------------------------------------------------
// The user's locations.
//
// A "location" is one town the user wants a pollen device for. The list is the
// single source of truth of the integration:
//   - it drives the devices published in the Discovery tab (one device per
//     location, `publishDiscoveredDevices` REPLACES the previous list, so a
//     removed location disappears from Discovery);
//   - it is stored in the integration configuration under the `locations` key.
//
// `locations` is deliberately NOT a `config_schema` field: nobody should hand
// write a JSON array in a form. It is written by the integration itself with
// `gladys.setConfig()` — the documented way to store values outside the schema
// — from the "Add a location" / "Remove a location" buttons of the
// Configuration screen.
//
// Everything here is pure except the two lookups that call a country geocoder,
// so the add/remove rules are unit-testable without any network.
// -----------------------------------------------------------------------------

import { findCountry } from './countries/index.js';

/**
 * @typedef {object} Location
 * @property {string} id stable, unique id (also the device platform id)
 * @property {string} country ISO country code, e.g. 'FR'
 * @property {string} postal_code
 * @property {string} city
 * @property {number} latitude
 * @property {number} longitude
 * @property {string} [admin_code] national identifier of the town, if any
 */

/** Hard cap: each location is one device polling a free public API. */
export const MAX_LOCATIONS = 20;

/**
 * Build the stable id of a location. It ends up in the device `external_id`, so
 * it must be unique, stable across restarts, and free of separator characters.
 */
export function makeLocationId(country, postalCode, city) {
  return [String(country).toLowerCase(), String(postalCode).toLowerCase(), slugify(city)]
    .filter(Boolean)
    .join('-');
}

/** Lowercase ASCII slug: accents stripped, everything else collapsed to '-'. */
function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Human label of a location, used in logs, device names and action messages. */
export function locationLabel(location) {
  return `${location.city} (${location.postal_code})`;
}

/**
 * Read the `locations` config value back into an array.
 *
 * Defensive on purpose: depending on how the value made the round trip through
 * the host API it can arrive as an array or as a JSON string, and a
 * hand-edited configuration can contain anything. Invalid entries are dropped
 * rather than crashing the integration at boot.
 * @param {unknown} raw
 * @returns {Location[]}
 */
export function parseLocations(raw) {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const locations = [];
  const seen = new Set();
  for (const entry of value) {
    const location = sanitizeLocation(entry);
    // Drop duplicates: two devices sharing an external_id would collide.
    if (location && !seen.has(location.id)) {
      seen.add(location.id);
      locations.push(location);
    }
  }
  return locations;
}

/** Coerce one stored entry into a valid location, or null when unusable. */
function sanitizeLocation(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const latitude = Number(entry.latitude);
  const longitude = Number(entry.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return null;
  }

  const country = String(entry.country ?? '')
    .trim()
    .toUpperCase();
  const postalCode = String(entry.postal_code ?? '').trim();
  const city = String(entry.city ?? '').trim();
  if (!country || !postalCode || !city) {
    return null;
  }

  const location = {
    id: String(entry.id ?? '').trim() || makeLocationId(country, postalCode, city),
    country,
    postal_code: postalCode,
    city,
    latitude,
    longitude,
  };
  if (entry.admin_code) {
    location.admin_code = String(entry.admin_code);
  }
  return location;
}

/**
 * Resolve a postal code into candidate locations, through the country geocoder.
 *
 * Returns every town of the postal code: a code such as 05100 covers several
 * communes, and only the user can say which one they meant. `cityHint` narrows
 * the list when they already know.
 *
 * @param {string} countryCode
 * @param {string} postalCode
 * @param {string} [cityHint]
 * @returns {Promise<Location[]>}
 */
export async function resolvePostalCode(countryCode, postalCode, cityHint) {
  const country = findCountry(countryCode);
  if (!country) {
    throw new LocationError({
      en: `Unsupported country "${countryCode}".`,
      fr: `Pays « ${countryCode} » non pris en charge.`,
    });
  }

  const trimmed = String(postalCode ?? '').trim();
  if (!country.postalCodePattern.test(trimmed)) {
    throw new LocationError(country.postalCodeHint);
  }

  const candidates = await country.searchPostalCode(trimmed);
  const locations = candidates.map((candidate) => ({
    id: makeLocationId(country.code, trimmed, candidate.city),
    country: country.code,
    postal_code: trimmed,
    city: candidate.city,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    ...(candidate.adminCode ? { admin_code: candidate.adminCode } : {}),
  }));

  const hint = slugify(cityHint);
  if (!hint) {
    return locations;
  }
  // Exact slug first, then "starts with" so "Saint-Étienne" finds
  // "Saint-Étienne-de-Tinée" without matching every town on the list.
  const exact = locations.filter((location) => slugify(location.city) === hint);
  return exact.length > 0
    ? exact
    : locations.filter((location) => slugify(location.city).startsWith(hint));
}

/**
 * Add a location to the list. Idempotent: adding a town already configured
 * returns the list unchanged rather than creating a duplicate device.
 * @param {Location[]} locations
 * @param {Location} location
 * @returns {{ locations: Location[], added: boolean }}
 */
export function addLocation(locations, location) {
  if (locations.some((existing) => existing.id === location.id)) {
    return { locations, added: false };
  }
  if (locations.length >= MAX_LOCATIONS) {
    throw new LocationError({
      en: `You already have ${MAX_LOCATIONS} locations, the maximum. Remove one first.`,
      fr: `Vous avez déjà ${MAX_LOCATIONS} lieux, le maximum. Supprimez-en un d'abord.`,
    });
  }
  return { locations: [...locations, location], added: true };
}

/**
 * Find the configured locations matching what the user typed in the "Remove a
 * location" field: an id, a postal code, a town name, or "postal code city".
 * @param {Location[]} locations
 * @param {string} query
 * @returns {Location[]}
 */
export function matchLocations(locations, query) {
  const raw = String(query ?? '').trim();
  if (!raw) {
    return [];
  }
  const slug = slugify(raw);

  const byId = locations.filter((location) => location.id === slug || location.id === raw);
  if (byId.length > 0) {
    return byId;
  }

  const byPostalCode = locations.filter((location) => location.postal_code === raw);
  if (byPostalCode.length > 0) {
    return byPostalCode;
  }

  const byCity = locations.filter((location) => slugify(location.city) === slug);
  if (byCity.length > 0) {
    return byCity;
  }

  // Last resort: "75001 Paris" or a partial town name.
  return locations.filter(
    (location) =>
      slugify(`${location.postal_code} ${location.city}`) === slug ||
      slugify(location.city).startsWith(slug),
  );
}

/**
 * Remove one location by id.
 * @param {Location[]} locations
 * @param {string} id
 * @returns {{ locations: Location[], removed: Location|null }}
 */
export function removeLocation(locations, id) {
  const removed = locations.find((location) => location.id === id) ?? null;
  if (!removed) {
    return { locations, removed: null };
  }
  return { locations: locations.filter((location) => location.id !== id), removed };
}

/**
 * A user-facing error: its multi-language message is displayed as-is under the
 * action button in the Configuration screen.
 */
export class LocationError extends Error {
  /** @param {{ en: string } & Record<string, string>} message */
  constructor(message) {
    super(message.en);
    this.name = 'LocationError';
    this.multiLanguageMessage = message;
  }
}

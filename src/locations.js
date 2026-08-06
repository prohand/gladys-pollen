// -----------------------------------------------------------------------------
// The user's locations.
//
// A "location" is one point the user wants a pollen device for. The list is the
// single source of truth of the integration:
//   - it drives the devices published in the Discovery tab (one device per
//     location; `publishDiscoveredDevices` REPLACES the previous list, so a
//     removed location disappears from Discovery);
//   - it is stored in the integration configuration under the `locations` key.
//
// WHERE THE LIST IS STORED, and why it is not a config_schema field.
// The Configuration screen is generated from the manifest, which is a static
// file: every field it renders that is not a `section` is an `<input>`, a
// `select` only holds the options the manifest declares, and there is no
// repeatable field type at all. A list the user builds at runtime simply cannot
// be a config_schema entry.
//
// It goes where the core leaves room for it: a key OUTSIDE the schema.
// `setIntegrationConfig` validates the keys the schema declares and treats the
// others as free internal storage of the integration, stored JSON-encoded and
// handed back parsed by `getConfig()`. So the list travels as an array under
// `locations`, and the user manipulates it through the manifest ACTIONS only —
// the message an action resolves to is the one place the Configuration screen
// displays anything this integration has to say.
//
// Coordinates are stored as TEXT, for the reason spelled out in
// `src/coordinates.js`: `Number('')` is 0, a valid latitude, and a French
// browser turns "48.8566" into an empty string in a `number` field.
// -----------------------------------------------------------------------------

import { formatCoordinate, formatPoint, toCoordinate } from './coordinates.js';
import { boldLabel } from './richText.js';

/**
 * @typedef {object} Location
 * @property {string} id stable, unique id (also the device platform id)
 * @property {string} name what the user calls this place
 * @property {string} address_label where it is, as the geocoder named it
 * @property {number|null} latitude
 * @property {number|null} longitude
 */

// Config key holding the list. Deliberately absent from the manifest
// `config_schema`: see the header.
export const LOCATIONS_KEY = 'locations';

// Hard cap: each location is one device polling a free public API. It is ALSO
// the number of options the delete action's dropdown offers — they are positions
// in this list, and a static manifest cannot offer more of them (a test keeps
// the two in sync).
export const MAX_LOCATIONS = 20;

// Long enough that two locations never collide, short enough that
// `ext:pollen:pollen-station:loc-3f8a2b1c` stays readable in a log line.
const ID_LENGTH = 8;

/**
 * A brand new location id, unique among the ones already in use.
 *
 * Random rather than a counter on purpose: an integration cannot delete a Gladys
 * device, so a device whose location was removed here may still exist there. A
 * reused id would silently hand that device's history to the next location the
 * user creates.
 * @param {Array<{ id: string }>} existing
 * @returns {string}
 */
export function newLocationId(existing = []) {
  const taken = new Set(existing.map((location) => location?.id));
  for (;;) {
    const id = `loc-${Math.random()
      .toString(36)
      .slice(2, 2 + ID_LENGTH)
      .padEnd(ID_LENGTH, '0')}`;
    if (!taken.has(id)) {
      return id;
    }
  }
}

/**
 * One location, with its coordinates parsed into numbers.
 *
 * `latitude`/`longitude` are `null` when unusable — the location is kept in the
 * list rather than dropped (losing a location because a stored value was
 * malformed would be worse than showing it as unconfigured), and
 * `hasCoordinates` decides whether it can be published and queried.
 *
 * The `city` / `postal_code` fallbacks are the MIGRATION of the entries written
 * by 1.0.0, when a location was a French postal code rather than a point. Their
 * `id` is read as it is: it is the platform id their device was published
 * under, so keeping it means the device keeps its history and its place in the
 * rooms and scenes.
 * @param {object} raw
 * @param {string} fallbackId id to use when the stored entry has none
 * @returns {Location}
 */
function normalizeLocation(raw, fallbackId) {
  const city = String(raw?.city ?? '').trim();
  const postalCode = String(raw?.postal_code ?? '').trim();
  return {
    id: String(raw?.id ?? fallbackId),
    name: String(raw?.name ?? '').trim() || city || 'Lieu',
    // Purely informational: where the point was geocoded from, so the user can
    // see WHERE the device looks without decoding two decimals.
    address_label:
      String(raw?.address_label ?? '').trim() || [postalCode, city].filter(Boolean).join(' '),
    latitude: toCoordinate(raw?.latitude, 'latitude'),
    longitude: toCoordinate(raw?.longitude, 'longitude'),
  };
}

/**
 * The stored list, normalized: valid entries only, ids unique.
 *
 * Defensive on purpose: depending on how the value made the round trip through
 * the host API it can arrive as an array or as a JSON string, and a hand-edited
 * configuration can contain anything.
 * @param {unknown} raw the `locations` value returned by `getConfig()`
 * @returns {Location[]}
 */
export function normalizeLocations(raw) {
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
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const location = normalizeLocation(entry, newLocationId(locations));
    // A duplicated id would publish two devices under one external_id, and the
    // second would silently overwrite the first's states.
    if (!locations.some((existing) => existing.id === location.id)) {
      locations.push(location);
    }
  }
  return locations;
}

/**
 * The list in the shape it is STORED in: coordinates back to text, so what we
 * write is what `normalizeLocations` reads back.
 * @param {Location[]} locations
 */
export function serializeLocations(locations = []) {
  return locations.map((location) => ({
    id: location.id,
    name: location.name,
    address_label: location.address_label ?? '',
    latitude: location.latitude === null ? '' : formatCoordinate(location.latitude),
    longitude: location.longitude === null ? '' : formatCoordinate(location.longitude),
  }));
}

/**
 * Whether a location knows where to look. A single coordinate is not a point, so
 * it counts as "not configured" rather than as half a query.
 * @param {{ latitude: number|null, longitude: number|null }} location
 */
export function hasCoordinates(location) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
}

/** The locations we can actually publish a device for. */
export function usableLocations(locations = []) {
  return locations.filter(hasCoordinates);
}

/** @returns {Location | undefined} */
export function findLocationById(locations = [], id) {
  return locations.find((location) => location.id === id);
}

/**
 * The location a 1-based POSITION designates — what the `location` select of the
 * delete action carries.
 *
 * The options of a `select` are static (the manifest is a file), so they can
 * only be positions: "Lieu 1", "Lieu 2"... The listing action is what maps a
 * position to a name, hence `describeLocations` below.
 * @param {Location[]} locations
 * @param {unknown} position "1".."20", as the form sends it
 * @returns {Location | null}
 */
export function locationAtPosition(locations = [], position) {
  const index = Number.parseInt(String(position ?? ''), 10) - 1;
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  return locations[index] ?? null;
}

/**
 * The 1-based position of a location, or 0 when it is not in the list. It is the
 * number the listing prints and the delete dropdown offers.
 */
export function positionOf(locations = [], id) {
  return locations.findIndex((location) => location.id === id) + 1;
}

/**
 * Add a location, or update the one that already carries `id`.
 * @param {Location[]} locations
 * @param {object} patch the fields to write, `id` selecting an existing one
 * @returns {Location[]} a new list — the caller stores it, nothing mutates
 */
export function upsertLocation(locations = [], patch = {}) {
  const existing = patch.id ? findLocationById(locations, patch.id) : undefined;
  if (!existing) {
    return [...locations, normalizeLocation(patch, patch.id ?? newLocationId(locations))];
  }
  // Only the keys actually present in the patch are touched: renaming a location
  // must not blank the address it was geocoded from.
  const merged = normalizeLocation({ ...serializeLocations([existing])[0], ...patch }, existing.id);
  return locations.map((location) => (location.id === existing.id ? merged : location));
}

/**
 * Remove a location. The Gladys device published for it is NOT deleted — an
 * integration cannot delete a device, only stop offering it — so the caller
 * tells the user to delete it in Gladys.
 * @returns {Location[]} a new list
 */
export function removeLocation(locations = [], id) {
  return locations.filter((location) => location.id !== id);
}

/**
 * Whether two locations share the same point, to the metre. Adding the same
 * place twice creates two devices reading the same grid cell of the same
 * forecast, which is never what the user meant.
 * @param {Location[]} locations
 * @param {{ latitude: number, longitude: number }} point
 * @returns {Location | undefined}
 */
export function findLocationAtPoint(locations = [], point) {
  return usableLocations(locations).find(
    (location) =>
      location.latitude.toFixed(5) === Number(point.latitude).toFixed(5) &&
      location.longitude.toFixed(5) === Number(point.longitude).toFixed(5),
  );
}

/**
 * WHERE a location is, with no name: what the listing prints after the dash.
 *
 * A location with no usable point shows a dash rather than nothing: it is
 * neither published nor queried, and this is what says so.
 * @param {Location} location
 */
export function locationDetail(location) {
  const point = hasCoordinates(location) ? formatPoint(location) : '—';
  return location.address_label ? `${location.address_label} (${point})` : point;
}

/**
 * One-line description, for the messages shown under the action buttons.
 *
 * Used INSIDE a sentence ("Lieu 2 « Jardin » ajouté : ..."), where the location
 * is already named and numbered by the sentence itself; a line of a LIST is
 * built by `locationLine` instead.
 * @param {Location} location
 */
export function describeLocation(location) {
  return `${location.name} — ${locationDetail(location)}`;
}

// One entry per line — see the marker below for what the Configuration screen
// currently does with it.
export const LOCATION_LINE_SEPARATOR = '\n';

// What OPENS every entry of every list this integration prints.
//
// It exists because the line break does not survive the Configuration screen:
// `ActionsCard.jsx` renders an action's answer as the text of a plain
// `<div class="alert">`, whose default `white-space: normal` collapses a newline
// into a space. A bare number does not survive that collapse — addresses are
// full of digits and dots — while a bullet cannot occur inside an address, which
// makes it the visible boundary between two entries whether the newline lives or
// dies.
export const LOCATION_LINE_MARKER = '• ';

/**
 * ONE entry of ANY list this integration prints, in the single format the
 * reporting actions share: `• n. name — detail`.
 *
 * The listing puts the address and the point in `detail`, the provider test puts
 * the pollen risk there — so both answers read as the same list of the same
 * locations, and the number is the one the delete dropdown offers in both.
 *
 * The number and the name are the only thing shown in bold: they are the label
 * the eye scans to find a location among twenty lines, and emphasis costs
 * something (see src/richText.js) that the detail must not pay.
 * @param {number} position 1-based, as `positionOf` counts
 * @param {string} name
 * @param {string} detail what this list says about the location
 */
export function locationLine(position, name, detail) {
  return `${LOCATION_LINE_MARKER}${boldLabel(`${position}. ${name}`)} — ${detail}`;
}

/**
 * The whole list, numbered, ONE LOCATION PER LINE, as the listing action prints
 * it.
 *
 * Numbered because those numbers ARE the ones the delete dropdown offers: a
 * `select` only holds the static options the manifest declares, so this listing
 * is what tells the user which location "Lieu 2" is.
 *
 * EVERY location is listed, including one whose coordinates are unusable: it is
 * neither published nor queried, and this line is the only thing that says why.
 * @param {Location[]} locations
 */
export function describeLocations(locations = []) {
  if (locations.length === 0) {
    return 'aucun lieu configuré';
  }
  return locations
    .map((location, index) => locationLine(index + 1, location.name, locationDetail(location)))
    .join(LOCATION_LINE_SEPARATOR);
}

// -----------------------------------------------------------------------------
// Reading and writing a WGS-84 coordinate.
//
// Its own module so `src/locations.js` can parse the coordinates of a location
// without importing `src/config.js`, which needs the location list to normalize
// a configuration — a cycle nothing here is worth.
//
// The rules below are the reason coordinates are handled by hand instead of
// being read straight off the form:
//   - an empty field arrives as '' and `Number('')` is 0, a valid latitude in
//     the Gulf of Guinea, so "not filled in" must be an explicit null;
//   - a `number` field is an <input type="number"> the browser sanitizes in ITS
//     OWN locale: a French browser hands "48.8566" back as an empty string and
//     the front then drops the key from the payload. Coordinates therefore
//     travel as TEXT, in the form and in the stored list, and are parsed here —
//     comma included.
// -----------------------------------------------------------------------------

/**
 * A number the user may legitimately leave empty.
 * @param {unknown} value
 * @returns {number | null}
 */
function toOptionalNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Range of a WGS-84 coordinate. */
const COORDINATE_LIMITS = { latitude: 90, longitude: 180 };

/**
 * Parse a coordinate typed by the user, accepting both decimal separators.
 *
 * Anything that is not a usable coordinate — letters, a latitude of 300 — is
 * `null`, i.e. "not configured", which the caller turns into a visible message
 * instead of a query to a point that does not exist.
 * @param {unknown} value
 * @param {'latitude' | 'longitude'} key which limit applies
 * @returns {number | null}
 */
export function toCoordinate(value, key) {
  // The comma is the French decimal separator; `\s` also covers the non-breaking
  // spaces a copy-paste from a web page brings along.
  const cleaned = typeof value === 'string' ? value.replace(/\s/g, '').replace(',', '.') : value;
  const parsed = toOptionalNumber(cleaned);
  if (parsed === null || Math.abs(parsed) > COORDINATE_LIMITS[key]) {
    return null;
  }
  return parsed;
}

/**
 * A coordinate in the form it is STORED in: text, dot-separated, which is what
 * `toCoordinate` reads back.
 * @param {number} value
 * @returns {string}
 */
export function formatCoordinate(value) {
  return String(value);
}

/**
 * The point of a location, as the listing prints it. Five decimals is about a
 * metre: enough to recognize the point, short enough to keep a line readable.
 * @param {{ latitude: number, longitude: number }} point
 */
export function formatPoint(point) {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

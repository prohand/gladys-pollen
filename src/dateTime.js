// -----------------------------------------------------------------------------
// The instant a reading is valid at, and how it is written for a human.
//
// Open-Meteo answers `current.time` as a LOCAL wall clock with no offset at all
// — `"2026-08-06T13:00"` — because the request asks for `timezone=auto`; the
// offset that gives it a meaning travels separately, in `utc_offset_seconds`.
// Taken alone that string is ambiguous, and `new Date('2026-08-06T13:00')` would
// read it in the CONTAINER's timezone (UTC in the Docker image), which is not
// where the location is.
//
// So the two are glued back together here, once, at the provider boundary:
// everything downstream handles a complete ISO 8601 instant.
//
// Displaying it goes the other way round: the timestamp of a location is read in
// the local time OF THAT LOCATION — the hour a user in that town has on their
// own clock — so the wall clock is printed as it is and the offset is dropped
// rather than converted into the container's timezone (which belongs to nobody).
// The fields are read from the string instead of going through `Date`, so the
// printed hour cannot drift with the container's `TZ`.
// -----------------------------------------------------------------------------

import { DEFAULT_LANGUAGE } from './language.js';

// Year, month, day, hour, minute of an ISO 8601 date-time, whatever trails it.
const ISO_PARTS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

// An offset already spelled out: `Z`, `+02:00`, `-0300`.
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/** `7200` -> `+02:00`, the shape ISO 8601 wants. */
function formatOffset(utcOffsetSeconds) {
  const sign = utcOffsetSeconds < 0 ? '-' : '+';
  const total = Math.abs(Math.trunc(utcOffsetSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/**
 * A local wall clock plus its UTC offset, as one unambiguous ISO 8601 instant.
 *
 * Returns the input untouched when there is nothing to glue — no offset given,
 * or an offset already there — because a half-known timestamp is still worth
 * showing, and inventing UTC for it would move the displayed hour.
 * @param {string|null|undefined} localTime e.g. `'2026-08-06T13:00'`
 * @param {number|null|undefined} utcOffsetSeconds e.g. `7200`
 * @returns {string|null} e.g. `'2026-08-06T13:00+02:00'`
 */
export function withUtcOffset(localTime, utcOffsetSeconds) {
  const value = String(localTime ?? '').trim();
  if (!value) {
    return null;
  }
  if (!Number.isFinite(Number(utcOffsetSeconds)) || HAS_OFFSET.test(value)) {
    return value;
  }
  return `${value}${formatOffset(Number(utcOffsetSeconds))}`;
}

/** How a date and an hour are written, per language. */
const DATE_TIME_FORMATS = {
  fr: (year, month, day, hour, minute) => `${day}/${month}/${year} ${hour}:${minute}`,
  en: (year, month, day, hour, minute) => `${year}-${month}-${day} ${hour}:${minute}`,
};

/**
 * An ISO 8601 instant, written for a human, in the language of the device names.
 *
 * The hour printed is the one carried by the string — the LOCAL time of the
 * location it describes — with the offset dropped: a pollen bulletin is read
 * against the clock of the town it covers. A value this cannot parse is returned
 * as it is rather than swallowed: a timestamp in a shape we did not foresee is
 * still more useful than nothing.
 * @param {string|null|undefined} iso
 * @param {string} [language] one of LANGUAGES (see src/language.js)
 * @returns {string|null} e.g. `'06/08/2026 13:00'`, or null when there is nothing
 */
export function formatDateTime(iso, language = DEFAULT_LANGUAGE) {
  const value = String(iso ?? '').trim();
  if (!value) {
    return null;
  }
  const parts = ISO_PARTS.exec(value);
  if (!parts) {
    return value;
  }
  const format = DATE_TIME_FORMATS[language] ?? DATE_TIME_FORMATS[DEFAULT_LANGUAGE];
  return format(...parts.slice(1));
}

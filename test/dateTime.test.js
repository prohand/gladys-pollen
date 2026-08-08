// Timestamps: gluing an Open-Meteo local hour back to its offset, and writing
// the result for a human. No network and no `Date`, so no dependency on the
// container's timezone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTime, withUtcOffset } from '../src/dateTime.js';

test('a local hour and its offset become one ISO instant', () => {
  assert.equal(withUtcOffset('2026-08-06T13:00', 7200), '2026-08-06T13:00+02:00');
  assert.equal(withUtcOffset('2026-01-06T13:00', 3600), '2026-01-06T13:00+01:00');
  assert.equal(withUtcOffset('2026-08-06T13:00', 0), '2026-08-06T13:00+00:00');
});

test('a negative or half-hour offset keeps its shape', () => {
  assert.equal(withUtcOffset('2026-08-06T13:00', -10800), '2026-08-06T13:00-03:00');
  assert.equal(withUtcOffset('2026-08-06T13:00', 19800), '2026-08-06T13:00+05:30');
});

test('a timestamp that already carries an offset is left alone', () => {
  assert.equal(withUtcOffset('2026-08-06T13:00Z', 7200), '2026-08-06T13:00Z');
  assert.equal(withUtcOffset('2026-08-06T13:00+02:00', 0), '2026-08-06T13:00+02:00');
});

test('an undated or unoffset answer is not invented', () => {
  // No offset: the hour is still worth showing, and defaulting to UTC would
  // move it.
  assert.equal(withUtcOffset('2026-08-06T13:00', undefined), '2026-08-06T13:00');
  assert.equal(withUtcOffset(null, 7200), null);
  assert.equal(withUtcOffset('', 7200), null);
});

test('the instant is written in the language of the device names', () => {
  assert.equal(formatDateTime('2026-08-06T13:00+02:00', 'fr'), '06/08/2026 13:00');
  assert.equal(formatDateTime('2026-08-06T13:00+02:00', 'en'), '2026-08-06 13:00');
  // Same fallback as everything else: French when the language is unknown.
  assert.equal(formatDateTime('2026-08-06T13:00+02:00'), '06/08/2026 13:00');
  assert.equal(formatDateTime('2026-08-06T13:00+02:00', 'de'), '06/08/2026 13:00');
});

test('the hour printed is the one of the location, not of the container', () => {
  // The offset is dropped rather than applied: a pollen bulletin is read
  // against the clock of the town it covers.
  assert.equal(formatDateTime('2026-08-06T13:00-03:00', 'fr'), '06/08/2026 13:00');
  assert.equal(formatDateTime('2026-08-06T13:00Z', 'fr'), '06/08/2026 13:00');
});

test('nothing to date stays nothing, an unexpected shape stays readable', () => {
  assert.equal(formatDateTime(null, 'fr'), null);
  assert.equal(formatDateTime('', 'fr'), null);
  assert.equal(formatDateTime('yesterday', 'fr'), 'yesterday');
});

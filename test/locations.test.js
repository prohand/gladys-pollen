// The location list is the integration's state: everything the user sees in the
// Discovery tab comes from it, so its add/remove/parse rules are worth pinning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addLocation,
  LocationError,
  locationLabel,
  makeLocationId,
  matchLocations,
  MAX_LOCATIONS,
  parseLocations,
  removeLocation,
  resolvePostalCode,
} from '../src/locations.js';

const paris = {
  id: 'fr-75001-paris',
  country: 'FR',
  postal_code: '75001',
  city: 'Paris',
  latitude: 48.8592,
  longitude: 2.3417,
};

const lyon = {
  id: 'fr-69001-lyon',
  country: 'FR',
  postal_code: '69001',
  city: 'Lyon',
  latitude: 45.7679,
  longitude: 4.8343,
};

test('the location id is a stable ASCII slug', () => {
  assert.equal(makeLocationId('FR', '42000', 'Saint-Étienne'), 'fr-42000-saint-etienne');
  // Same inputs, same id: the device external_id must survive a restart.
  assert.equal(
    makeLocationId('FR', '42000', 'Saint-Étienne'),
    makeLocationId('fr', '42000', 'Saint-Étienne'),
  );
});

test('parseLocations reads back an array', () => {
  assert.deepEqual(parseLocations([paris]), [paris]);
});

test('parseLocations reads back a JSON string', () => {
  // Depending on the host round trip the value can come back serialized.
  assert.deepEqual(parseLocations(JSON.stringify([paris])), [paris]);
});

test('parseLocations tolerates garbage instead of crashing at boot', () => {
  assert.deepEqual(parseLocations(undefined), []);
  assert.deepEqual(parseLocations('not json'), []);
  assert.deepEqual(parseLocations({ nope: true }), []);
  assert.deepEqual(parseLocations([null, 42, 'x']), []);
});

test('parseLocations drops entries without usable coordinates', () => {
  const entries = [{ ...paris, latitude: 'abc' }, { ...lyon, longitude: 999 }, paris];
  assert.deepEqual(parseLocations(entries), [paris]);
});

test('parseLocations drops duplicates, which would collide as device ids', () => {
  assert.deepEqual(parseLocations([paris, { ...paris }]), [paris]);
});

test('parseLocations rebuilds a missing id', () => {
  const [location] = parseLocations([{ ...paris, id: undefined }]);
  assert.equal(location.id, 'fr-75001-paris');
});

test('addLocation appends without mutating the previous list', () => {
  const before = [paris];
  const { locations, added } = addLocation(before, lyon);
  assert.equal(added, true);
  assert.deepEqual(locations, [paris, lyon]);
  assert.deepEqual(before, [paris], 'the input list must stay untouched');
});

test('adding a configured location twice is a no-op', () => {
  const { locations, added } = addLocation([paris], { ...paris });
  assert.equal(added, false);
  assert.deepEqual(locations, [paris]);
});

test('addLocation refuses to go past the cap', () => {
  const full = Array.from({ length: MAX_LOCATIONS }, (_, i) => ({
    ...paris,
    id: `fr-7500${i}-paris-${i}`,
  }));
  assert.throws(() => addLocation(full, lyon), LocationError);
});

test('removeLocation removes by id and reports what went', () => {
  const { locations, removed } = removeLocation([paris, lyon], lyon.id);
  assert.deepEqual(locations, [paris]);
  assert.equal(removed.city, 'Lyon');
});

test('removing an unknown id changes nothing', () => {
  const { locations, removed } = removeLocation([paris], 'fr-99999-nowhere');
  assert.deepEqual(locations, [paris]);
  assert.equal(removed, null);
});

test('matchLocations accepts an id, a postal code or a town name', () => {
  const locations = [paris, lyon];
  assert.deepEqual(matchLocations(locations, 'fr-69001-lyon'), [lyon]);
  assert.deepEqual(matchLocations(locations, '69001'), [lyon]);
  assert.deepEqual(matchLocations(locations, 'Lyon'), [lyon]);
  assert.deepEqual(matchLocations(locations, '69001 Lyon'), [lyon]);
});

test('matchLocations ignores case and accents', () => {
  const nice = { ...paris, id: 'fr-06000-nice', postal_code: '06000', city: 'Nîmes' };
  assert.deepEqual(matchLocations([nice], 'nimes'), [nice]);
});

test('matchLocations returns every candidate when the query is ambiguous', () => {
  // Two towns sharing a postal code: the caller must ask, not guess.
  const a = { ...paris, id: 'fr-05100-briancon', postal_code: '05100', city: 'Briançon' };
  const b = { ...paris, id: 'fr-05100-montgenevre', postal_code: '05100', city: 'Montgenèvre' };
  assert.equal(matchLocations([a, b], '05100').length, 2);
});

test('matchLocations returns nothing for an empty query', () => {
  assert.deepEqual(matchLocations([paris], '   '), []);
});

test('locationLabel reads like an address', () => {
  assert.equal(locationLabel(paris), 'Paris (75001)');
});

test('resolvePostalCode rejects a malformed French postal code before any call', async () => {
  await assert.rejects(() => resolvePostalCode('FR', '7500'), LocationError);
  await assert.rejects(() => resolvePostalCode('FR', 'abcde'), LocationError);
});

test('resolvePostalCode rejects an unsupported country', async () => {
  await assert.rejects(() => resolvePostalCode('XX', '75001'), LocationError);
});

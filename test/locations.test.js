// The location list is the integration's state: everything the user sees in the
// Discovery tab comes from it, so its rules are worth pinning.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describeLocation,
  describeLocations,
  findLocationAtPoint,
  findLocationById,
  hasCoordinates,
  LOCATION_LINE_MARKER,
  locationAtPosition,
  MAX_LOCATIONS,
  newLocationId,
  normalizeLocations,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
  usableLocations,
} from '../src/locations.js';
import { boldLabel } from '../src/richText.js';

const paris = {
  id: 'loc-paris001',
  name: 'Maison',
  address_label: 'Paris, Île-de-France, France',
  latitude: '48.8592',
  longitude: '2.3417',
};

const lyon = {
  id: 'loc-lyon0001',
  name: 'Bureau',
  address_label: 'Lyon, Auvergne-Rhône-Alpes, France',
  latitude: '45.7679',
  longitude: '4.8343',
};

test('a stored list comes back with its coordinates parsed', () => {
  const [location] = normalizeLocations([paris]);
  assert.equal(location.id, 'loc-paris001');
  assert.equal(location.name, 'Maison');
  assert.equal(location.latitude, 48.8592);
  assert.equal(location.longitude, 2.3417);
});

test('what is stored is what is read back', () => {
  const locations = normalizeLocations([paris, lyon]);
  assert.deepEqual(normalizeLocations(serializeLocations(locations)), locations);
  // Coordinates go back to text: a `number` field is not what holds them.
  const [stored] = serializeLocations(locations);
  assert.equal(stored.latitude, '48.8592');
});

test('a location whose coordinates are unusable is kept, but not usable', () => {
  // Losing a location because a stored value was malformed would be worse than
  // showing it as unconfigured.
  const [broken] = normalizeLocations([{ ...paris, latitude: 'nowhere' }]);
  assert.equal(broken.latitude, null);
  assert.equal(hasCoordinates(broken), false);
  assert.deepEqual(usableLocations([broken]), []);
});

test('a latitude alone is not a point', () => {
  const [half] = normalizeLocations([{ ...paris, longitude: '' }]);
  assert.equal(hasCoordinates(half), false);
});

test('a comma decimal separator is read as one', () => {
  // A French user copying "48,8592" off a map must not end up in the Atlantic.
  const [location] = normalizeLocations([{ ...paris, latitude: '48,8592' }]);
  assert.equal(location.latitude, 48.8592);
});

test('an out-of-range coordinate is refused rather than clamped', () => {
  const [location] = normalizeLocations([{ ...paris, latitude: '300' }]);
  assert.equal(location.latitude, null);
});

test('a corrupted stored value degrades to an empty list', () => {
  assert.deepEqual(normalizeLocations('oops'), []);
  assert.deepEqual(normalizeLocations(null), []);
  assert.deepEqual(normalizeLocations([null, 42, 'x']), []);
});

test('a list stored as a JSON string is still read', () => {
  // Depending on the round trip through the host API, the value can arrive
  // already parsed or as text.
  assert.equal(normalizeLocations(JSON.stringify([paris])).length, 1);
});

test('two entries sharing an id are deduplicated', () => {
  // Two devices under one external_id: the second would silently overwrite the
  // first's states.
  assert.equal(normalizeLocations([paris, { ...paris, name: 'Autre' }]).length, 1);
});

test('the locations of 1.0.0, stored as postal codes, are migrated', () => {
  // Their id is kept as it is: it is the platform id their device was published
  // under, so the device keeps its history instead of being orphaned.
  const [migrated] = normalizeLocations([
    {
      id: 'fr-75001-paris',
      country: 'FR',
      postal_code: '75001',
      city: 'Paris',
      latitude: 48.8592,
      longitude: 2.3417,
    },
  ]);
  assert.equal(migrated.id, 'fr-75001-paris');
  assert.equal(migrated.name, 'Paris');
  assert.equal(migrated.address_label, '75001 Paris');
  assert.equal(migrated.latitude, 48.8592);
});

test('a generated id never collides with an existing one', () => {
  const existing = Array.from({ length: 50 }, () => ({ id: newLocationId([]) }));
  const id = newLocationId(existing);
  assert.ok(!existing.some((location) => location.id === id));
  assert.match(id, /^loc-[a-z0-9]{8}$/);
});

test('adding a location leaves the previous list untouched', () => {
  const locations = normalizeLocations([paris]);
  const next = upsertLocation(locations, { id: 'loc-new00001', name: 'Jardin', latitude: '1' });
  assert.equal(locations.length, 1);
  assert.equal(next.length, 2);
});

test('upserting an existing id updates it without blanking the rest', () => {
  const locations = normalizeLocations([paris]);
  const next = upsertLocation(locations, { id: paris.id, name: 'Chez moi' });
  assert.equal(next.length, 1);
  assert.equal(next[0].name, 'Chez moi');
  // Renaming must not lose where the device looks.
  assert.equal(next[0].latitude, 48.8592);
  assert.equal(next[0].address_label, paris.address_label);
});

test('removing a location removes exactly it', () => {
  const locations = normalizeLocations([paris, lyon]);
  const next = removeLocation(locations, paris.id);
  assert.deepEqual(
    next.map((location) => location.id),
    [lyon.id],
  );
  assert.deepEqual(removeLocation(locations, 'loc-unknown'), locations);
});

test('a location is found by id and by position', () => {
  const locations = normalizeLocations([paris, lyon]);
  assert.equal(findLocationById(locations, lyon.id)?.name, 'Bureau');
  assert.equal(locationAtPosition(locations, '2')?.name, 'Bureau');
  assert.equal(positionOf(locations, lyon.id), 2);
  // The dropdown offers 20 positions whatever the list holds.
  assert.equal(locationAtPosition(locations, '3'), null);
  assert.equal(locationAtPosition(locations, 'x'), null);
  assert.equal(positionOf(locations, 'loc-unknown'), 0);
});

test('the same point is recognized whoever named it', () => {
  // Two devices on one point read the same grid cell of the same forecast.
  const locations = normalizeLocations([paris]);
  assert.equal(
    findLocationAtPoint(locations, { latitude: 48.8592, longitude: 2.3417 })?.id,
    paris.id,
  );
  assert.equal(findLocationAtPoint(locations, { latitude: 45, longitude: 5 }), undefined);
});

test('the listing numbers the locations the delete dropdown offers', () => {
  const listing = describeLocations(normalizeLocations([paris, lyon]));
  const lines = listing.split('\n');
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.ok(line.startsWith(LOCATION_LINE_MARKER), 'every entry opens with the marker');
  }
  // The number and the name open the line, in bold characters (see richText).
  assert.match(lines[1], new RegExp(boldLabel('2. Bureau')));
  assert.match(lines[1], /Auvergne-Rhône-Alpes/);
  // The point is spelled out: it is what the device actually watches.
  assert.match(lines[0], /48\.85920, 2\.34170/);
});

test('a location with no usable point says so in the listing', () => {
  const [broken] = normalizeLocations([{ ...paris, latitude: '' }]);
  assert.match(describeLocation(broken), /—/);
});

test('an empty list says so rather than printing nothing', () => {
  assert.match(describeLocations([]), /aucun lieu/i);
});

test('the maximum is a number the manifest can offer as positions', () => {
  assert.ok(Number.isInteger(MAX_LOCATIONS) && MAX_LOCATIONS > 0);
});

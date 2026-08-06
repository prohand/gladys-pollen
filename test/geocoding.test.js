// Turning what the user types into a point. `fetch` is stubbed so the suite
// never touches the network.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  describePlace,
  filterByHints,
  normalizeText,
  pickPlace,
  placeContext,
  resolvePlace,
  searchPlaces,
  splitQuery,
} from '../src/geocoding.js';

const originalFetch = globalThis.fetch;

/** Stub `fetch` with a canned geocoding payload, recording the URLs called. */
function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok, status, json: async () => payload };
  };
  return calls;
}

function place(name, extra = {}) {
  return {
    name,
    latitude: 44.0181,
    longitude: 1.3549,
    country: 'France',
    country_code: 'FR',
    admin1: 'Occitanie',
    admin2: 'Tarn-et-Garonne',
    postcodes: ['82000'],
    ...extra,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('a place name is searched as it is', async () => {
  const calls = stubFetch({ results: [place('Montauban')] });
  const places = await searchPlaces('Montauban');

  assert.equal(places.length, 1);
  assert.equal(places[0].latitude, 44.0181);
  assert.match(calls[0], /name=Montauban/);
});

test('an answer with no result at all is not an error', async () => {
  // The API answers with no `results` key rather than an empty array.
  stubFetch({ generationtime_ms: 0.1 });
  assert.deepEqual(await searchPlaces('Zzzz'), []);
});

test('an empty query calls nothing', async () => {
  const calls = stubFetch({ results: [place('Montauban')] });
  assert.deepEqual(await searchPlaces('   '), []);
  assert.equal(calls.length, 0);
});

test('an HTTP failure is propagated, not swallowed', async () => {
  stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => searchPlaces('Montauban'), /503/);
});

test('a result without a point is dropped', async () => {
  stubFetch({ results: [place('Nowhere', { latitude: null }), place('Montauban')] });
  const places = await searchPlaces('x');
  assert.deepEqual(
    places.map((p) => p.name),
    ['Montauban'],
  );
});

test('what follows a comma narrows the answers down', () => {
  const { name, hints } = splitQuery(' Montauban , Tarn-et-Garonne , France ');
  assert.equal(name, 'Montauban');
  assert.deepEqual(hints, ['Tarn-et-Garonne', 'France']);
});

test('hints match the region, the country and the postal code alike', () => {
  const candidates = [
    place('Montauban', { admin2: 'Tarn-et-Garonne', postcodes: ['82000'] }),
    place('Montauban', { admin2: 'Ille-et-Vilaine', postcodes: ['35360'] }),
  ];
  assert.equal(filterByHints(candidates, ['Tarn-et-Garonne']).length, 1);
  assert.equal(filterByHints(candidates, ['35360']).length, 1);
  assert.equal(filterByHints(candidates, ['France']).length, 2);
  assert.equal(filterByHints(candidates, []).length, 2);
});

test('a hint nothing carries empties the list rather than being ignored', () => {
  // "No place found for what you typed" is honest; silently dropping the filter
  // would watch a town the user did not ask for.
  assert.deepEqual(filterByHints([place('Montauban')], ['Bretagne']), []);
});

test('accents and case are ignored when comparing', () => {
  assert.equal(normalizeText('Saint-Étienne'), 'saint-etienne');
  assert.equal(filterByHints([place('X', { admin1: 'Occitanie' })], ['occitanie']).length, 1);
});

test('a single candidate is the answer', () => {
  assert.equal(pickPlace([place('Montauban')], 'Montauban')?.name, 'Montauban');
});

test('one exact name among fuzzy matches is the answer', () => {
  const candidates = [place('Parisot'), place('Paris'), place('Parisel')];
  assert.equal(pickPlace(candidates, 'paris')?.name, 'Paris');
});

test('several places of the same name are never picked by coin flip', () => {
  // Picking one here would silently report another town's pollen.
  const candidates = [
    place('Montauban', { admin2: 'Tarn-et-Garonne' }),
    place('Montauban', { admin2: 'Ille-et-Vilaine' }),
  ];
  assert.equal(pickPlace(candidates, 'Montauban'), null);
  assert.equal(pickPlace([], 'Montauban'), null);
});

test('a candidate is described by what tells it from its homonyms', () => {
  const candidate = place('Montauban');
  assert.equal(placeContext(candidate), 'Tarn-et-Garonne, France');
  assert.equal(describePlace(candidate), 'Montauban (Tarn-et-Garonne, France)');
  // A place with no administrative context still describes as its name.
  assert.equal(describePlace(place('X', { admin1: '', admin2: '', country: '' })), 'X');
});

test('resolving searches the name and filters on the hints', async () => {
  const calls = stubFetch({
    results: [
      place('Montauban', { admin2: 'Tarn-et-Garonne' }),
      place('Montauban', { admin2: 'Ille-et-Vilaine' }),
    ],
  });
  const { match, candidates } = await resolvePlace('Montauban, Ille-et-Vilaine');

  // Only the name goes to the API: it searches one name, not a sentence.
  assert.match(calls[0], /name=Montauban&/);
  assert.equal(candidates.length, 1);
  assert.equal(match?.admin2, 'Ille-et-Vilaine');
});

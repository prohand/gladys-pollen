// -----------------------------------------------------------------------------
// Reading the Gladys houses through the SDK (`gladys.getHouses()`).
//
// The SDK is stood in for by the in-memory fake: these tests never touch the
// network.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { fetchHouses, HOUSE_ACCESS_DENIED, normalizeHouse } from '../src/houses.js';
import { createFakeGladys } from './helpers/fakeGladys.js';

test('the houses are read through the SDK, in the order the core sorted them', async () => {
  const gladys = createFakeGladys({
    houses: [
      { id: 'h1', name: 'Maison', selector: 'maison', latitude: 44.0181, longitude: 1.3549 },
    ],
  });

  const houses = await fetchHouses(gladys);

  assert.equal(gladys.houseReads, 1);
  assert.deepEqual(houses, [
    { id: 'h1', name: 'Maison', selector: 'maison', latitude: 44.0181, longitude: 1.3549 },
  ]);
});

test('a house that was never placed on the map has no coordinates, not a zero', async () => {
  // `Number(null)` is 0, a valid latitude in the Gulf of Guinea.
  const gladys = createFakeGladys({
    houses: [{ id: 'h1', name: 'Bureau', latitude: null, longitude: null }],
  });

  const [house] = await fetchHouses(gladys);

  assert.equal(house.latitude, null);
  assert.equal(house.longitude, null);
});

test('a refused access is told apart from every other failure', async () => {
  // A 403 means the installed manifest never declared `location: true`, which
  // only a re-install fixes — nothing a retry would help with.
  const gladys = createFakeGladys({
    houseError: new GladysApiError(403, 'FORBIDDEN', 'Forbidden'),
  });

  await assert.rejects(fetchHouses(gladys), (err) => {
    assert.equal(err.code, HOUSE_ACCESS_DENIED);
    return true;
  });
});

test('any other host API error goes through as it is', async () => {
  const gladys = createFakeGladys({
    houseError: new GladysApiError(500, 'SERVER_ERROR', 'Boom'),
  });
  await assert.rejects(fetchHouses(gladys), (err) => {
    assert.equal(err.status, 500);
    assert.notEqual(err.code, HOUSE_ACCESS_DENIED);
    return true;
  });
});

test('an answer that is not a list is no houses, not a crash', async () => {
  const gladys = createFakeGladys({ houses: { message: 'nope' } });
  assert.deepEqual(await fetchHouses(gladys), []);
});

test('a house with no name is still listed under one', () => {
  // The name is what tells "Maison" from "Bureau" in the answer of the button.
  assert.equal(normalizeHouse({ id: 'h1', name: '   ' }).name, 'Maison');
});

test('an unusable coordinate is dropped rather than watched', () => {
  const house = normalizeHouse({ id: 'h1', name: 'X', latitude: 300, longitude: 2 });
  assert.equal(house.latitude, null);
});

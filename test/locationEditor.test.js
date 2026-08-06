// The three buttons the user actually presses. Everything the outside world
// provides is injected, so nothing here touches Gladys nor the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationEditor } from '../src/locationEditor.js';
import { normalizeConfig } from '../src/config.js';
import { MAX_LOCATIONS } from '../src/locations.js';
import { boldLabel } from '../src/richText.js';

const montauban = {
  name: 'Montauban',
  latitude: 44.0181,
  longitude: 1.3549,
  country: 'France',
  country_code: 'FR',
  admin1: 'Occitanie',
  admin2: 'Tarn-et-Garonne',
  postcodes: ['82000'],
};

/**
 * An editor over an in-memory configuration, with the geocoder answering
 * whatever the test says.
 */
function createEditor({
  locations = [],
  resolved = { match: montauban, candidates: [montauban] },
  ...rest
} = {}) {
  const state = { config: normalizeConfig({ locations }), republished: 0 };
  const editor = createLocationEditor({
    getConfig: () => state.config,
    async setConfig(patch) {
      state.config = normalizeConfig({ ...state.config, ...patch });
    },
    onLocationsChanged: async () => {
      state.republished += 1;
    },
    resolvePlace: async () => resolved,
    ...rest,
  });
  return { state, ...editor.actions };
}

test('a geocoded town becomes a location, and the devices are re-published', async () => {
  const { state, add_location: add } = createEditor();
  const message = await add({ place: 'Montauban' });

  assert.equal(state.config.locations.length, 1);
  const [location] = state.config.locations;
  assert.equal(location.name, 'Montauban');
  assert.equal(location.latitude, 44.0181);
  assert.match(location.address_label, /Tarn-et-Garonne/);
  // Adding a location must reach the Discovery tab: that is the whole point.
  assert.equal(state.republished, 1);
  assert.match(message.fr, /Découverte/);
});

test('the name the user typed wins over the geocoded one', async () => {
  const { state, add_location: add } = createEditor();
  await add({ name: 'Jardin', place: 'Montauban' });
  assert.equal(state.config.locations[0].name, 'Jardin');
});

test('typed coordinates are used as they are, the town being only a label', async () => {
  const { state, add_location: add } = createEditor();
  await add({ place: 'Chez mamie', latitude: '45,7679', longitude: '4.8343' });

  const [location] = state.config.locations;
  assert.equal(location.latitude, 45.7679);
  assert.equal(location.longitude, 4.8343);
  assert.equal(location.address_label, 'Chez mamie');
});

test('half a point is refused with the rule spelled out', async () => {
  const { state, add_location: add } = createEditor();
  const message = await add({ latitude: '45.7679' });
  assert.equal(state.config.locations.length, 0);
  assert.match(message.fr, /longitude/);
});

test('an out-of-range coordinate is refused', async () => {
  const { state, add_location: add } = createEditor();
  await add({ latitude: '300', longitude: '4.8343' });
  assert.equal(state.config.locations.length, 0);
});

test('an empty form asks for something rather than adding a point at 0,0', async () => {
  const { state, add_location: add } = createEditor();
  const message = await add({});
  assert.equal(state.config.locations.length, 0);
  assert.match(message.fr, /commune|latitude/i);
});

test('an unknown town is reported, and nothing is added', async () => {
  const { state, add_location: add } = createEditor({ resolved: { match: null, candidates: [] } });
  const message = await add({ place: 'Zzzz' });
  assert.equal(state.config.locations.length, 0);
  assert.match(message.fr, /Aucun lieu/i);
});

test('an ambiguous name lists the candidates instead of guessing', async () => {
  const candidates = [
    { ...montauban, admin2: 'Tarn-et-Garonne' },
    { ...montauban, admin2: 'Ille-et-Vilaine' },
  ];
  const { state, add_location: add } = createEditor({ resolved: { match: null, candidates } });
  const message = await add({ place: 'Montauban' });

  assert.equal(state.config.locations.length, 0);
  assert.match(message.fr, /Ille-et-Vilaine/);
  assert.match(message.fr, /virgule/);
});

test('a point no pollen forecast covers is refused, not published', async () => {
  // Outside the CAMS European domain the forecast answers nulls for every
  // taxon: the device would sit forever on "no recent value".
  const { state, add_location: add } = createEditor({ isCovered: () => false });
  const message = await add({ latitude: '-33.86', longitude: '151.2' });

  assert.equal(state.config.locations.length, 0);
  assert.match(message.fr, /CAMS/);
});

test('the same point is not added twice', async () => {
  const { state, add_location: add } = createEditor();
  await add({ place: 'Montauban' });
  const message = await add({ name: 'Encore', place: 'Montauban' });

  assert.equal(state.config.locations.length, 1);
  assert.match(message.fr, /déjà surveillé/);
});

test('the maximum number of locations is enforced', async () => {
  const locations = Array.from({ length: MAX_LOCATIONS }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: String(40 + index / 100),
    longitude: '2',
  }));
  const { state, add_location: add } = createEditor({ locations });
  const message = await add({ place: 'Montauban' });

  assert.equal(state.config.locations.length, MAX_LOCATIONS);
  assert.match(message.fr, new RegExp(String(MAX_LOCATIONS)));
});

test('the listing numbers the locations and says so', async () => {
  const { add_location: add, list_locations: list } = createEditor();
  assert.match((await list()).fr, /Aucun lieu/i);

  await add({ name: 'Maison', place: 'Montauban' });
  const message = await list();
  assert.match(message.fr, new RegExp(`1/${MAX_LOCATIONS}`));
  assert.match(message.fr, /•/);
  // The number and the name open the entry, in bold characters.
  assert.match(message.fr, new RegExp(boldLabel('1. Maison')));
});

test('deleting asks for a confirmation first', async () => {
  const { state, add_location: add, remove_location: remove } = createEditor();
  await add({ name: 'Maison', place: 'Montauban' });

  const preview = await remove({ location: '1' });
  assert.match(preview.fr, /confirme/i);
  assert.equal(state.config.locations.length, 1, 'nothing is deleted without the checkbox');

  const done = await remove({ location: '1', confirmation: true });
  assert.equal(state.config.locations.length, 0);
  assert.match(done.fr, /Découverte/);
});

test('deleting a position that does not exist lists what does', async () => {
  const { add_location: add, remove_location: remove } = createEditor();
  await add({ name: 'Maison', place: 'Montauban' });

  const message = await remove({ location: '7', confirmation: true });
  assert.match(message.fr, /pas de lieu 7/i);
  assert.match(message.fr, new RegExp(boldLabel('1. Maison')));
});

test('deleting with no location at all says what to do instead', async () => {
  const { remove_location: remove } = createEditor();
  assert.match((await remove({ location: '1', confirmation: true })).fr, /Ajouter un lieu/);
});

test('a device the user already created is named, since we cannot delete it', async () => {
  const { add_location: add, remove_location: remove } = createEditor({
    findCreatedDevice: async () => ({ name: 'Pollens — Maison' }),
  });
  await add({ name: 'Maison', place: 'Montauban' });

  const message = await remove({ location: '1', confirmation: true });
  assert.match(message.fr, /Pollens — Maison/);
  assert.match(message.fr, /supprimez-le vous-même/i);
});

test('failing to read the devices does not block a deletion', async () => {
  const {
    state,
    add_location: add,
    remove_location: remove,
  } = createEditor({
    findCreatedDevice: async () => {
      throw new Error('host API down');
    },
  });
  await add({ name: 'Maison', place: 'Montauban' });

  await remove({ location: '1', confirmation: true });
  assert.equal(state.config.locations.length, 0);
});

test('deleting from the middle warns that the numbers moved', async () => {
  const { add_location: add, remove_location: remove } = createEditor({
    resolved: { match: montauban, candidates: [montauban] },
  });
  await add({ name: 'Un', latitude: '44.1', longitude: '1.1' });
  await add({ name: 'Deux', latitude: '44.2', longitude: '1.2' });
  await add({ name: 'Trois', latitude: '44.3', longitude: '1.3' });

  const message = await remove({ location: '2', confirmation: true });
  assert.match(message.fr, /remontent/);
});

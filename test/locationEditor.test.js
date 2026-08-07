// The three buttons the user actually presses. Everything the outside world
// provides is injected, so nothing here touches Gladys nor the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocationEditor } from '../src/locationEditor.js';
import { normalizeConfig } from '../src/config.js';
import { HOUSE_ACCESS_DENIED } from '../src/houses.js';
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
  const state = { config: normalizeConfig({ locations }), republished: 0, writes: 0 };
  const editor = createLocationEditor({
    getConfig: () => state.config,
    async setConfig(patch) {
      state.writes += 1;
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

// --- "Ajouter mes maisons Gladys" --------------------------------------------
// The houses come from the injected `listHouses`, so nothing here talks to the
// host API: `src/houses.js` is what test/houses.test.js covers.

/** A house as `src/houses.js` normalizes one. */
function house(name, latitude = null, longitude = null) {
  return { id: `h-${name}`, name, selector: name.toLowerCase(), latitude, longitude };
}

/** An editor whose Gladys instance holds `houses`, or fails with `houseError`. */
function createHouseEditor({ houses = [], houseError = null, ...rest } = {}) {
  return createEditor({
    async listHouses() {
      if (houseError) {
        throw houseError;
      }
      return houses;
    },
    ...rest,
  });
}

test('one click turns the Gladys houses into locations', async () => {
  const { state, import_houses: importHouses } = createHouseEditor({
    houses: [house('Maison', 44.0181, 1.3549), house('Chalet', 46.5, 6.6)],
  });

  const message = await importHouses();

  assert.match(message.fr, /2 maison\(s\) Gladys ajoutée\(s\)/);
  assert.match(message.fr, /Découverte/, 'the answer says where the devices show up');
  assert.equal(state.config.locations.length, 2);
  const [maison, chalet] = state.config.locations;
  assert.equal(maison.name, 'Maison');
  assert.equal(maison.latitude, 44.0181);
  assert.equal(maison.address_label, '', 'a house is a point, not an address');
  assert.equal(chalet.name, 'Chalet');
  assert.equal(state.republished, 1, 'the whole import is ONE write and ONE refresh');
  assert.equal(state.writes, 1);
});

test('a house already watched is named rather than added twice', async () => {
  const { state, import_houses: importHouses } = createHouseEditor({
    locations: [{ id: 'loc-1', name: 'Domicile', latitude: '44.0181', longitude: '1.3549' }],
    houses: [house('Maison', 44.0181, 1.3549), house('Chalet', 46.5, 6.6)],
  });

  const message = await importHouses();

  assert.match(message.fr, /1 maison\(s\) Gladys ajoutée\(s\)/);
  assert.match(message.fr, /déjà le lieu 1 « Domicile »/);
  assert.equal(state.config.locations.length, 2);
});

test('a house with no position on the map is not watched at (0, 0)', async () => {
  const { state, import_houses: importHouses } = createHouseEditor({
    houses: [house('Bureau'), house('Maison', 44.0181, 1.3549)],
  });

  const message = await importHouses();

  assert.match(message.fr, /Sans position sur la carte/);
  assert.match(message.fr, /« Bureau »/);
  assert.match(message.fr, /Réglages > Maisons/);
  assert.equal(state.config.locations.length, 1);
  assert.equal(state.config.locations[0].name, 'Maison');
});

test('a house outside the CAMS domain is skipped by name, not published', async () => {
  // Same rule as the add form: the forecast there answers nulls for every
  // taxon, so the device would never hold a value.
  const { state, import_houses: importHouses } = createHouseEditor({
    houses: [house('Sydney', -33.86, 151.2)],
    isCovered: (point) => point.latitude > 0,
  });

  const message = await importHouses();

  assert.match(message.fr, /CAMS/);
  assert.match(message.fr, /« Sydney »/);
  assert.equal(state.config.locations.length, 0);
  assert.equal(state.writes, 0);
});

test('nothing to import writes nothing at all', async () => {
  const { state, import_houses: importHouses } = createHouseEditor({
    locations: [{ id: 'loc-1', name: 'Domicile', latitude: '44.0181', longitude: '1.3549' }],
    houses: [house('Maison', 44.0181, 1.3549)],
  });

  const message = await importHouses();

  assert.match(message.fr, /Aucune maison à ajouter/);
  assert.equal(state.writes, 0, 'no write means no needless Discovery refresh');
  assert.equal(state.republished, 0);
});

test('an instance with no house says where to create one', async () => {
  const { import_houses: importHouses } = createHouseEditor({ houses: [] });
  const message = await importHouses();
  assert.match(message.fr, /aucune maison/i);
  assert.match(message.fr, /Réglages > Maisons/);
});

test('a refused permission tells the user to re-install, not to retry', async () => {
  // A 403 is the install screen's answer, not an outage: nothing the user does
  // in this screen grants it.
  const denied = Object.assign(new Error('HTTP 403'), { code: HOUSE_ACCESS_DENIED });
  const { state, import_houses: importHouses } = createHouseEditor({ houseError: denied });

  const message = await importHouses();

  assert.match(message.fr, /réinstallez/i);
  assert.match(message.en, /re-install/i);
  assert.equal(state.config.locations.length, 0);
});

test('the houses being unreadable falls back on the town, and never throws', async () => {
  const { import_houses: importHouses } = createHouseEditor({
    houseError: new Error('Gladys host API HTTP 500'),
  });
  const message = await importHouses();
  assert.match(message.fr, /HTTP 500/);
  assert.match(message.fr, /commune/);
});

test('the import respects the cap and names what it left out', async () => {
  const locations = Array.from({ length: MAX_LOCATIONS - 1 }, (unused, index) => ({
    id: `loc-${index}`,
    name: `Lieu ${index}`,
    latitude: String(40 + index / 100),
    longitude: '2',
  }));
  const { state, import_houses: importHouses } = createHouseEditor({
    locations,
    houses: [house('Maison', 44.0181, 1.3549), house('Chalet', 46.5, 6.6)],
  });

  const message = await importHouses();

  assert.equal(state.config.locations.length, MAX_LOCATIONS);
  assert.match(message.fr, new RegExp(`Maximum de ${MAX_LOCATIONS} lieux`));
  assert.match(message.fr, /« Chalet »/);
});

test('an imported house is an ordinary location, deleted like any other', async () => {
  const {
    state,
    import_houses: importHouses,
    remove_location: remove,
  } = createHouseEditor({
    houses: [house('Maison', 44.0181, 1.3549)],
  });
  await importHouses();

  const message = await remove({ location: '1', confirmation: true });

  assert.match(message.fr, /supprimé/);
  assert.equal(state.config.locations.length, 0);
});

test('every answer is a multi-language object, never a thrown string', async () => {
  // The SDK acks a thrown error as a plain English string, which a French
  // screen then shows as-is.
  const {
    add_location: add,
    import_houses: importHouses,
    ...actions
  } = createHouseEditor({
    resolved: { match: null, candidates: [] },
  });
  const answers = [
    await add({}),
    await add({ latitude: '1' }),
    await add({ place: 'Zzzz' }),
    await importHouses(),
    await actions.list_locations(),
    await actions.remove_location({ location: '1' }),
  ];
  for (const answer of answers) {
    assert.equal(typeof answer.en, 'string', JSON.stringify(answer));
    assert.equal(typeof answer.fr, 'string', JSON.stringify(answer));
  }
});

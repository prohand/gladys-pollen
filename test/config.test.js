import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyConfigUpdate, DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

test('an empty config falls back on the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.language, 'fr');
  assert.deepEqual(config.locations, []);
});

test('the language of the names falls back on French', () => {
  // Nothing in the host API tells an integration which language its user reads
  // (see src/language.js): an unknown value is French, not a broken name.
  assert.equal(normalizeConfig({ language: 'en' }).language, 'en');
  assert.equal(normalizeConfig({ language: 'FR' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'en-US' }).language, 'en');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'fr');
  assert.equal(normalizeConfig({ language: null }).language, 'fr');
});

test('numbers arriving as strings from the form are coerced', () => {
  assert.equal(normalizeConfig({ poll_frequency: '1800' }).poll_frequency, 1800);
});

test('the poll frequency is clamped to the manifest bounds', () => {
  // A value below the bound would hammer a free public API for nothing.
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 900);
  assert.equal(normalizeConfig({ poll_frequency: 999999 }).poll_frequency, 86400);
  assert.equal(normalizeConfig({ poll_frequency: 'nonsense' }).poll_frequency, 3600);
});

test('locations are parsed into a usable array', () => {
  const config = normalizeConfig({
    locations: [{ id: 'loc-abc12345', name: 'Maison', latitude: '48.8592', longitude: '2.3417' }],
  });
  assert.equal(config.locations.length, 1);
  assert.equal(config.locations[0].latitude, 48.8592);
});

test('a corrupted locations value degrades to an empty list', () => {
  assert.deepEqual(normalizeConfig({ locations: 'oops' }).locations, []);
});

test('a config with no usable point is not configured', () => {
  // Publishing then would offer a device pinned to nowhere.
  assert.equal(isConfigured(normalizeConfig()), false);
  assert.equal(
    isConfigured(normalizeConfig({ locations: [{ id: 'loc-1', name: 'X', latitude: '48.8' }] })),
    false,
  );
  assert.equal(
    isConfigured(
      normalizeConfig({
        locations: [{ id: 'loc-1', name: 'X', latitude: '48.8', longitude: '2' }],
      }),
    ),
    true,
  );
});

test('a key a former version declared is carried along, not read', () => {
  // `default_country` is still stored by installs made before the country
  // registry was dropped: getConfig hands back every stored key.
  const config = normalizeConfig({ default_country: 'FR' });
  assert.equal(config.default_country, 'FR');
  assert.deepEqual(config.locations, []);
});

// --- A saved form -------------------------------------------------------------

const home = {
  id: 'loc-home0001',
  name: 'Maison',
  address_label: 'Paris',
  latitude: '48.8592',
  longitude: '2.3417',
};

test('a saved form that does not carry the locations keeps them', () => {
  // `locations` is not a field of the form: its absence says nothing about the
  // list, and taking it as "empty" stopped the polling until a restart.
  const current = normalizeConfig({ locations: [home] });
  const updated = applyConfigUpdate(current, { poll_frequency: 7200, language: 'en' });
  assert.equal(updated.poll_frequency, 7200);
  assert.equal(updated.language, 'en');
  assert.deepEqual(updated.locations, current.locations);
  assert.ok(isConfigured(updated));
});

test('a null locations key is no list either', () => {
  const current = normalizeConfig({ locations: [home] });
  assert.deepEqual(applyConfigUpdate(current, { locations: null }).locations, current.locations);
});

test('a payload that carries the locations is taken as it is', () => {
  const current = normalizeConfig({ locations: [home] });
  assert.deepEqual(applyConfigUpdate(current, { locations: [] }).locations, []);
  const other = { ...home, id: 'loc-other001', name: 'Bureau' };
  assert.deepEqual(
    applyConfigUpdate(current, { locations: [other] }).locations.map((location) => location.id),
    ['loc-other001'],
  );
});

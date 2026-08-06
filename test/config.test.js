import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

test('an empty config falls back on the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.deepEqual(config.locations, []);
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('an empty config falls back on the defaults', () => {
  const config = normalizeConfig();
  assert.equal(config.poll_frequency, DEFAULT_CONFIG.poll_frequency);
  assert.equal(config.default_country, 'FR');
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

test('the country code is normalized to uppercase', () => {
  assert.equal(normalizeConfig({ default_country: 'fr' }).default_country, 'FR');
});

test('locations are parsed into a usable array', () => {
  const config = normalizeConfig({
    locations: [
      {
        id: 'fr-75001-paris',
        country: 'FR',
        postal_code: '75001',
        city: 'Paris',
        latitude: 48.8592,
        longitude: 2.3417,
      },
    ],
  });
  assert.equal(config.locations.length, 1);
  assert.equal(config.locations[0].city, 'Paris');
});

test('a corrupted locations value degrades to an empty list', () => {
  assert.deepEqual(normalizeConfig({ locations: 'oops' }).locations, []);
});

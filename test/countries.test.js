// The country layer is the extension point for future countries: these tests
// pin the contract every country module must honour.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { COUNTRIES, DEFAULT_COUNTRY_CODE, findCountry } from '../src/countries/index.js';
import { resolvePostalCode } from '../src/locations.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok, status, json: async () => payload };
  };
  return calls;
}

test('every country honours the same contract', () => {
  for (const country of COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.ok(country.label?.en, `${country.code} needs an English label`);
    assert.ok(country.postalCodePattern instanceof RegExp);
    assert.ok(country.postalCodeHint?.en, `${country.code} needs a hint`);
    assert.equal(typeof country.searchPostalCode, 'function');
    assert.ok(
      country.postalCodePattern.test(country.postalCodeExample),
      `${country.code}: the example must match its own pattern`,
    );
  }
});

test('country codes are unique', () => {
  const codes = COUNTRIES.map((country) => country.code);
  assert.equal(new Set(codes).size, codes.length);
});

test('findCountry is case-insensitive and tolerates whitespace', () => {
  assert.equal(findCountry('fr')?.code, 'FR');
  assert.equal(findCountry(' FR ')?.code, 'FR');
  assert.equal(findCountry('XX'), undefined);
  assert.equal(findCountry(undefined), undefined);
});

test('the default country is implemented', () => {
  assert.ok(findCountry(DEFAULT_COUNTRY_CODE));
});

test('France maps the API Géo payload to locations', async () => {
  const calls = stubFetch([
    {
      nom: 'Paris',
      code: '75056',
      // GeoJSON order: [longitude, latitude] — inverting it is the classic bug.
      centre: { type: 'Point', coordinates: [2.3417, 48.8592] },
    },
  ]);

  const [location] = await resolvePostalCode('FR', '75001');
  assert.equal(location.id, 'fr-75001-paris');
  assert.equal(location.city, 'Paris');
  assert.equal(location.longitude, 2.3417);
  assert.equal(location.latitude, 48.8592);
  assert.equal(location.admin_code, '75056');
  assert.ok(calls[0].includes('codePostal=75001'));
  assert.ok(!/api_?key|token/i.test(calls[0]), 'the lookup must carry no credential');
});

test('a postal code covering several towns returns them all', async () => {
  stubFetch([
    { nom: 'Briançon', code: '05023', centre: { coordinates: [6.6353, 44.8987] } },
    { nom: 'Montgenèvre', code: '05085', centre: { coordinates: [6.7256, 44.9316] } },
  ]);
  const locations = await resolvePostalCode('FR', '05100');
  assert.equal(locations.length, 2);
});

test('a town hint narrows an ambiguous postal code', async () => {
  stubFetch([
    { nom: 'Briançon', code: '05023', centre: { coordinates: [6.6353, 44.8987] } },
    { nom: 'Montgenèvre', code: '05085', centre: { coordinates: [6.7256, 44.9316] } },
  ]);
  // Accent-free, lowercase input still finds the town.
  const locations = await resolvePostalCode('FR', '05100', 'montgenevre');
  assert.equal(locations.length, 1);
  assert.equal(locations[0].city, 'Montgenèvre');
});

test('a town without coordinates is skipped rather than geocoded to null island', async () => {
  stubFetch([
    { nom: 'Sans centre', code: '00000' },
    { nom: 'Paris', code: '75056', centre: { coordinates: [2.3417, 48.8592] } },
  ]);
  const locations = await resolvePostalCode('FR', '75001');
  assert.equal(locations.length, 1);
  assert.equal(locations[0].city, 'Paris');
});

test('an API Géo outage propagates', async () => {
  stubFetch([], { ok: false, status: 502 });
  await assert.rejects(() => resolvePostalCode('FR', '75001'), /API Géo HTTP 502/);
});

test('an unexpected payload is rejected instead of silently returning nothing', async () => {
  stubFetch({ message: 'nope' });
  await assert.rejects(() => resolvePostalCode('FR', '75001'), /unexpected payload/);
});

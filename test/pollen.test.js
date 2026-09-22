// The provider layer: coverage checks, the HTTP mapping and the cache. `fetch`
// is stubbed so the suite never touches the network.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  allTaxa,
  findProvider,
  PROVIDERS,
  readPollenForecast,
  readPollenRisk,
} from '../src/pollen/index.js';
import {
  clearPollenCache,
  openMeteoProvider,
  OPEN_METEO_VARIABLES,
} from '../src/pollen/openMeteo.js';

const paris = { latitude: 48.8592, longitude: 2.3417 };
const originalFetch = globalThis.fetch;

/** Stub `fetch` with a canned Open-Meteo payload, recording the URLs called. */
function stubFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok,
      status,
      json: async () => payload,
    };
  };
  return calls;
}

beforeEach(() => {
  clearPollenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('the taxa list has no duplicate and covers the six CAMS species', () => {
  const taxa = allTaxa();
  assert.equal(new Set(taxa).size, taxa.length);
  assert.deepEqual(taxa.sort(), ['alder', 'birch', 'grass', 'mugwort', 'olive', 'ragweed']);
});

test('a European position finds a provider', () => {
  assert.equal(findProvider(paris)?.key, 'open-meteo-cams');
});

test('a position outside the CAMS domain finds none', () => {
  // Sydney: the API answers nulls there, so claiming coverage would create a
  // device that never holds a value.
  assert.equal(findProvider({ latitude: -33.87, longitude: 151.21 }), undefined);
  assert.equal(findProvider({ latitude: 40.71, longitude: -74.01 }), undefined);
});

test('readPollenRisk fails loudly outside any coverage', async () => {
  await assert.rejects(
    () => readPollenRisk({ latitude: -33.87, longitude: 151.21 }),
    /No pollen provider covers/,
  );
});

test('the provider maps the API payload to concentrations per taxon', async () => {
  stubFetch({
    utc_offset_seconds: 7200,
    current: {
      time: '2026-08-06T13:00',
      [OPEN_METEO_VARIABLES.birch]: 12.5,
      [OPEN_METEO_VARIABLES.grass]: 3,
      [OPEN_METEO_VARIABLES.alder]: null,
    },
  });

  const { concentrations, measuredAt } = await openMeteoProvider.fetchPollen(paris);
  assert.equal(concentrations.birch, 12.5);
  assert.equal(concentrations.grass, 3);
  assert.equal(concentrations.alder, null);
  // A variable absent from the payload is "no data", not zero.
  assert.equal(concentrations.olive, null);
  // `timezone=auto` dates the values on the local clock of the position and
  // gives the offset apart: the provider hands back the two glued together, so
  // nothing downstream reads the hour in the container's timezone.
  assert.equal(measuredAt, '2026-08-06T13:00+02:00');
});

test('an answer with no hour is not dated', async () => {
  stubFetch({ current: { [OPEN_METEO_VARIABLES.birch]: 4 } });
  const { measuredAt } = await openMeteoProvider.fetchPollen(paris);
  assert.equal(measuredAt, null);
});

test('the reading carries the hour it is valid at', async () => {
  stubFetch({
    utc_offset_seconds: 3600,
    current: { time: '2026-01-06T09:00', [OPEN_METEO_VARIABLES.birch]: 12.5 },
  });
  const reading = await readPollenRisk(paris);
  assert.equal(reading.measuredAt, '2026-01-06T09:00+01:00');
});

test('the request asks for every taxon and no API key', async () => {
  const calls = stubFetch({ current: {} });
  await openMeteoProvider.fetchPollen(paris);
  const [url] = calls;
  for (const variable of Object.values(OPEN_METEO_VARIABLES)) {
    assert.ok(url.includes(variable), `the request must ask for ${variable}`);
  }
  assert.ok(!/api_?key|token|apikey/i.test(url), 'the request must carry no credential');
});

test('an HTTP error propagates instead of publishing a wrong zero', async () => {
  stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => openMeteoProvider.fetchPollen(paris), /Open-Meteo HTTP 503/);
});

test('an API-level error is surfaced with its reason', async () => {
  stubFetch({ error: true, reason: 'Latitude must be in range' });
  await assert.rejects(() => openMeteoProvider.fetchPollen(paris), /Latitude must be in range/);
});

test('two reads of the same position hit the API once', async () => {
  // The forecast is hourly: a second call would return the same numbers, and
  // the API is free and unauthenticated — it deserves to be treated gently.
  const calls = stubFetch({ current: { [OPEN_METEO_VARIABLES.birch]: 1 } });
  await openMeteoProvider.fetchPollen(paris);
  await openMeteoProvider.fetchPollen(paris);
  assert.equal(calls.length, 1);
});

test('two different positions are cached separately', async () => {
  const calls = stubFetch({ current: { [OPEN_METEO_VARIABLES.birch]: 1 } });
  await openMeteoProvider.fetchPollen(paris);
  await openMeteoProvider.fetchPollen({ latitude: 45.7679, longitude: 4.8343 });
  assert.equal(calls.length, 2);
});

test('readPollenRisk grades the concentrations it reads', async () => {
  stubFetch({
    current: {
      [OPEN_METEO_VARIABLES.birch]: 150, // high for a tree
      [OPEN_METEO_VARIABLES.ragweed]: 0,
      [OPEN_METEO_VARIABLES.grass]: null,
    },
  });

  const reading = await readPollenRisk(paris);
  assert.equal(reading.provider, 'open-meteo-cams');
  assert.equal(reading.risks.birch, 3);
  assert.equal(reading.risks.ragweed, 0);
  assert.equal(reading.risks.grass, null);
  assert.deepEqual(reading.overall, { level: 3, taxon: 'birch' });
});

test('every registered provider exposes the same contract', () => {
  for (const provider of PROVIDERS) {
    assert.equal(typeof provider.key, 'string');
    assert.ok(Array.isArray(provider.taxa) && provider.taxa.length > 0);
    assert.equal(typeof provider.supports, 'function');
    assert.equal(typeof provider.fetchPollen, 'function');
  }
});

// --- The hourly forecast, which the dashboard widgets draw -------------------

/** Two days of hourly birch values, as Open-Meteo lays them out. */
function hourlyPayload() {
  return {
    utc_offset_seconds: 7200,
    hourly: {
      time: ['2026-04-12T00:00', '2026-04-12T01:00', '2026-04-12T02:00'],
      [OPEN_METEO_VARIABLES.birch]: [0, 150, null],
      [OPEN_METEO_VARIABLES.grass]: [1, 1, 1],
    },
  };
}

test('the forecast asks for the hourly variables, not the current ones', async () => {
  const calls = stubFetch(hourlyPayload());
  await openMeteoProvider.fetchForecast(paris);
  assert.match(String(calls[0]), /hourly=/);
  assert.match(String(calls[0]), /forecast_days=2/);
  assert.ok(!String(calls[0]).includes('current='));
});

test('a forecast hour is a complete instant, never a bare wall clock', async () => {
  stubFetch(hourlyPayload());
  const { hours } = await openMeteoProvider.fetchForecast(paris);
  // The offset travels in a field of its own: glued back on at the provider
  // boundary, so nothing downstream reads the hour in the container's timezone.
  assert.equal(hours[0].t, '2026-04-12T00:00+02:00');
  assert.equal(hours[1].concentrations.birch, 150);
  assert.equal(hours[2].concentrations.birch, null);
});

test('readPollenForecast grades every hour it reads', async () => {
  stubFetch(hourlyPayload());
  const { hours } = await readPollenForecast(paris);
  assert.equal(hours.length, 3);
  assert.equal(hours[0].risks.birch, 0);
  assert.equal(hours[1].risks.birch, 3);
  // A missing value is null, never a zero: a curve dropping to the floor would
  // read as "nothing in the air" where the model simply said nothing.
  assert.equal(hours[2].risks.birch, null);
});

test('the forecast has its own cache, and the current hour keeps its own', async () => {
  const calls = stubFetch(hourlyPayload());
  await openMeteoProvider.fetchForecast(paris);
  await openMeteoProvider.fetchForecast(paris);
  assert.equal(calls.length, 1, 'the curve is read once');
  await openMeteoProvider.fetchPollen(paris);
  assert.equal(calls.length, 2, 'the current hour is a request of its own');
});

test('a provider with no forecast costs the widget its curve, not its card', async () => {
  // Optional capability: a future national source can be registered without
  // implementing it, and `readPollenForecast` answers no hours rather than
  // failing.
  const { fetchForecast, ...noForecast } = openMeteoProvider;
  assert.equal(typeof fetchForecast, 'function');
  PROVIDERS.unshift(noForecast);
  try {
    assert.deepEqual(await readPollenForecast(paris), {
      provider: 'open-meteo-cams',
      hours: [],
    });
  } finally {
    PROVIDERS.shift();
  }
});

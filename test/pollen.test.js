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
  readPollenRisks,
} from '../src/pollen/index.js';
import {
  CACHE_TTL_MS,
  clearPollenCache,
  currentHour,
  MAX_POINTS_PER_REQUEST,
  openMeteoProvider,
  OPEN_METEO_VARIABLES,
  setPollenClock,
} from '../src/pollen/openMeteo.js';
import { CONTENT_TTL_SECONDS } from '../src/widgets/content.js';
import { resetHttpSleep, setHttpSleep } from '../src/http.js';
import { hourAnswer, stubOpenMeteo } from './helpers/openMeteo.js';

const paris = { latitude: 48.8592, longitude: 2.3417 };
const lyon = { latitude: 45.7679, longitude: 4.8343 };
const originalFetch = globalThis.fetch;

/** Stub `fetch` with a canned Open-Meteo payload, recording the URLs called. */
function stubFetch(payload, options) {
  return stubOpenMeteo(payload, options);
}

beforeEach(() => {
  clearPollenCache();
  // The one retry of a 5xx must not cost the suite a real second.
  setHttpSleep(async () => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetHttpSleep();
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

test('readPollenRisk fails loudly outside any coverage, without printing the point', async () => {
  // The message reaches the logs and the Supervision screen, and a location is
  // often somebody's home: it names the place, never its coordinates.
  await assert.rejects(
    () => readPollenRisk({ name: 'Sydney', latitude: -33.87, longitude: 151.21 }),
    (err) => /No pollen provider covers "Sydney"/.test(err.message) && !/151/.test(err.message),
  );
});

test('the provider maps the API payload to concentrations per taxon', async () => {
  stubFetch(hourAnswer({ birch: 12.5, grass: 3, alder: null }, { time: '2026-08-06T13:00' }));

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

test('an answer with no hour is neither dated nor read as zeros', async () => {
  stubFetch(hourAnswer({ birch: 4 }, { time: null }));
  const { measuredAt, concentrations } = await openMeteoProvider.fetchPollen(paris);
  assert.equal(measuredAt, null);
  assert.equal(concentrations.birch, null);
});

test('the reading carries the hour it is valid at', async () => {
  stubFetch(hourAnswer({ birch: 12.5 }, { time: '2026-01-06T09:00', offset: 3600 }));
  const reading = await readPollenRisk(paris);
  assert.equal(reading.measuredAt, '2026-01-06T09:00+01:00');
});

test('the request asks for every taxon and no API key', async () => {
  const calls = stubFetch(hourAnswer({}));
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
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  await openMeteoProvider.fetchPollen(paris);
  await openMeteoProvider.fetchPollen(paris);
  assert.equal(calls.length, 1);
});

test('two different positions are cached separately', async () => {
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  await openMeteoProvider.fetchPollen(paris);
  await openMeteoProvider.fetchPollen(lyon);
  assert.equal(calls.length, 2);
});

test('readPollenRisk grades the concentrations it reads', async () => {
  stubFetch(
    hourAnswer({
      birch: 150, // high for a tree
      ragweed: 0,
      grass: null,
    }),
  );

  const reading = await readPollenRisk(paris);
  assert.equal(reading.provider, 'open-meteo-cams');
  assert.equal(reading.risks.birch, 3);
  assert.equal(reading.risks.ragweed, 0);
  assert.equal(reading.risks.grass, null);
  // The measured band travels next to the published level: 150 grains/m³ of
  // birch is "high" (band 4), not "very high" (band 5), and the folded 3
  // cannot tell them apart.
  assert.equal(reading.eanRisks.birch, 4);
  assert.equal(reading.eanRisks.ragweed, 0);
  assert.equal(reading.eanRisks.grass, null);
  assert.deepEqual(reading.overall, { level: 3, eanLevel: 4, taxon: 'birch' });
});

test('the dominant taxon is the one highest on the measured scale', async () => {
  // Both are level 3 once folded; only the bands tell them apart, and the
  // dominant pollen must be the one actually higher in the air.
  stubFetch(
    hourAnswer({
      birch: 100, // band 4, folded 3
      ragweed: 60, // band 5, folded 3
    }),
  );

  const reading = await readPollenRisk(paris);
  assert.equal(reading.risks.birch, 3);
  assert.equal(reading.risks.ragweed, 3);
  assert.deepEqual(reading.overall, { level: 3, eanLevel: 5, taxon: 'ragweed' });
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

test('the current hour and the curve are ONE request', async () => {
  // A station card asks for both at once: they used to be two requests for the
  // same point, the current hour being nothing but a row of the curve.
  const calls = stubFetch(hourlyPayload());
  await Promise.all([openMeteoProvider.fetchForecast(paris), openMeteoProvider.fetchPollen(paris)]);
  await openMeteoProvider.fetchForecast(paris);
  await openMeteoProvider.fetchPollen(paris);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes('current='), 'no separate current block');
});

test('the current hour is the last one that has started', async () => {
  stubFetch(hourlyPayload());
  // 01:30 in Paris (+02:00) is 23:30 UTC the day before.
  setPollenClock(() => Date.parse('2026-04-11T23:30:00Z'));
  const reading = await openMeteoProvider.fetchPollen(paris);
  assert.equal(reading.measuredAt, '2026-04-12T01:00+02:00');
  assert.equal(reading.concentrations.birch, 150);

  // The cached curve moves to the next hour on its own: no request needed.
  setPollenClock(() => Date.parse('2026-04-12T00:00:00Z'));
  const later = await openMeteoProvider.fetchPollen(paris);
  assert.equal(later.measuredAt, '2026-04-12T02:00+02:00');
  assert.equal(later.concentrations.birch, null, 'a missing value stays missing');
});

test('a clock behind the first hour reads the first hour', () => {
  const hours = [
    { t: '2026-04-12T00:00+02:00', concentrations: { birch: 1 } },
    { t: '2026-04-12T01:00+02:00', concentrations: { birch: 2 } },
  ];
  assert.equal(currentHour(hours, Date.parse('2026-04-01T00:00:00Z')).concentrations.birch, 1);
});

test('the cache outlives the widget ttl, so a card re-pull costs no request', () => {
  // A card is re-pulled on expiry of its ttl: a cache shorter than that made
  // every scheduled pull a miss, one request per place every quarter hour.
  assert.ok(CACHE_TTL_MS >= CONTENT_TTL_SECONDS * 1000);
});

test('the cache expires', async () => {
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  let now = Date.parse('2026-04-12T12:00:00Z');
  setPollenClock(() => now);
  await openMeteoProvider.fetchPollen(paris);
  now += CACHE_TTL_MS + 1;
  await openMeteoProvider.fetchPollen(paris);
  assert.equal(calls.length, 2);
});

// --- Several places in one request -------------------------------------------

test('every place of a cycle is read in ONE request', async () => {
  const calls = stubFetch((url) => {
    // Open-Meteo answers an array, in the order of the coordinates.
    const latitudes = new URL(url).searchParams.get('latitude').split(',');
    return latitudes.map((latitude) => hourAnswer({ birch: latitude.startsWith('48') ? 150 : 0 }));
  });
  const outcomes = await readPollenRisks([
    { name: 'Paris', ...paris },
    { name: 'Lyon', ...lyon },
  ]);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0]);
  assert.equal(url.searchParams.get('latitude'), `${paris.latitude},${lyon.latitude}`);
  assert.equal(url.searchParams.get('longitude'), `${paris.longitude},${lyon.longitude}`);
  assert.equal(outcomes[0].reading.risks.birch, 3);
  assert.equal(outcomes[1].reading.risks.birch, 0);
});

test('a place already cached is not asked for again', async () => {
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  await readPollenRisk(paris);
  await readPollenRisks([paris, lyon]);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('latitude'), String(lyon.latitude));
});

test('a long list is chunked', async () => {
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  const many = Array.from({ length: MAX_POINTS_PER_REQUEST + 3 }, (unused, index) => ({
    latitude: 40 + index / 100,
    longitude: 2,
  }));
  const outcomes = await readPollenRisks(many);
  assert.equal(calls.length, 2);
  assert.ok(outcomes.every((outcome) => outcome.reading));
});

test('a failed request is one error per place, never a rejection', async () => {
  stubFetch({}, { ok: false, status: 503 });
  const outcomes = await readPollenRisks([paris, lyon, { latitude: -33.87, longitude: 151.21 }]);
  assert.match(outcomes[0].error.message, /Open-Meteo HTTP 503/);
  assert.match(outcomes[1].error.message, /Open-Meteo HTTP 503/);
  assert.match(outcomes[2].error.message, /No pollen provider covers/);
});

test('an answer that does not match the request is refused', async () => {
  stubFetch(() => [hourAnswer({ birch: 1 })]);
  const outcomes = await readPollenRisks([paris, lyon]);
  assert.ok(outcomes.every((outcome) => /answered 1 point/.test(outcome.error?.message)));
});

test('concurrent readers of one place share one request', async () => {
  const calls = stubFetch(hourAnswer({ birch: 1 }));
  await Promise.all([readPollenRisk(paris), readPollenRisks([paris]), readPollenForecast(paris)]);
  assert.equal(calls.length, 1);
});

test('a provider without the batch method is read place by place', async () => {
  const { fetchPollenMany, ...single } = openMeteoProvider;
  assert.equal(typeof fetchPollenMany, 'function');
  PROVIDERS.unshift(single);
  try {
    const calls = stubFetch(hourAnswer({ birch: 1 }));
    const outcomes = await readPollenRisks([paris, lyon]);
    assert.equal(calls.length, 2);
    assert.ok(outcomes.every((outcome) => outcome.reading));
  } finally {
    PROVIDERS.shift();
  }
});

// --- One retry on a transient failure ----------------------------------------

test('a 503 is retried once, then the answer is read', async () => {
  let attempt = 0;
  const waits = [];
  setHttpSleep(async (ms) => waits.push(ms));
  globalThis.fetch = async () => {
    attempt += 1;
    return attempt === 1
      ? { ok: false, status: 503, headers: new Headers(), json: async () => ({}) }
      : {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => hourAnswer({ birch: 1 }),
        };
  };
  const reading = await readPollenRisk(paris);
  assert.equal(attempt, 2);
  assert.equal(reading.concentrations.birch, 1);
  assert.equal(waits.length, 1);
});

test('a 429 waits what Retry-After asks, capped short', async () => {
  let attempt = 0;
  const waits = [];
  setHttpSleep(async (ms) => waits.push(ms));
  globalThis.fetch = async () => {
    attempt += 1;
    return attempt === 1
      ? {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '120' }),
          json: async () => ({}),
        }
      : { ok: true, status: 200, headers: new Headers(), json: async () => hourAnswer({}) };
  };
  await readPollenRisk(paris);
  assert.deepEqual(waits, [5000]);
});

test('a failure that persists is retried ONCE only', async () => {
  const calls = stubFetch({}, { ok: false, status: 503 });
  await assert.rejects(() => readPollenRisk(paris), /Open-Meteo HTTP 503/);
  assert.equal(calls.length, 2);
});

test('a 4xx other than 429 is not retried', async () => {
  const calls = stubFetch({}, { ok: false, status: 400 });
  await assert.rejects(() => readPollenRisk(paris), /Open-Meteo HTTP 400/);
  assert.equal(calls.length, 1);
});

test('a network error is retried once', async () => {
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new TypeError('fetch failed');
    }
    return { ok: true, status: 200, headers: new Headers(), json: async () => hourAnswer({}) };
  };
  await readPollenRisk(paris);
  assert.equal(attempt, 2);
});

test('a timeout is not retried: waiting twice would overrun the callers', async () => {
  let attempt = 0;
  globalThis.fetch = async () => {
    attempt += 1;
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  };
  await assert.rejects(() => readPollenRisk(paris), /timeout/);
  assert.equal(attempt, 1);
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

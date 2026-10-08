// The refresh pass: single-flight, one request for every place, states paced
// through the host API, and a connection status that blames the right party.
// `fetch` is stubbed and the publisher's clock injected: nothing here touches
// the network or actually waits.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys, gladysApiError } from './helpers/fakeGladys.js';
import { hourAnswer, pointCount } from './helpers/openMeteo.js';
import { normalizeConfig } from '../src/config.js';
import {
  deviceExternalIds,
  poll,
  pollenStation,
  refreshLocations,
} from '../src/devices/pollenStation.js';
import { resetHttpSleep, setHttpSleep } from '../src/http.js';
import { clearPollenCache } from '../src/pollen/openMeteo.js';
import { resetRiskMemory } from '../src/scenes/index.js';
import { resetStatePublisher, setStatePublisherClock } from '../src/statePublisher.js';

const paris = {
  id: 'loc-paris001',
  name: 'Maison',
  address_label: 'Paris, Île-de-France, France',
  latitude: '48.8592',
  longitude: '2.3417',
};
const lyon = {
  id: 'loc-lyon0001',
  name: 'Bureau',
  address_label: 'Lyon, Auvergne-Rhône-Alpes, France',
  latitude: '45.7679',
  longitude: '4.8343',
};

const config = normalizeConfig({ locations: [paris, lyon] });
const [PARIS, LYON] = config.locations;

const originalFetch = globalThis.fetch;

/**
 * Stub `fetch` with a pollen answer for every point; `gate` (a promise) holds
 * every answer back until it resolves, to keep a pass in flight.
 */
function stubPollen({ birch = 80, gate = null, ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    await gate;
    const count = pointCount(String(url));
    const one = hourAnswer({ birch });
    return {
      ok,
      status: ok ? 200 : 503,
      headers: new Headers(),
      json: async () => (count > 1 ? Array.from({ length: count }, () => one) : one),
    };
  };
  return calls;
}

/** A promise and the function that releases it. */
function gate() {
  let open;
  const promise = new Promise((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

beforeEach(() => {
  clearPollenCache();
  resetRiskMemory();
  resetStatePublisher();
  setHttpSleep(async () => {});
  setStatePublisherClock({ sleep: async () => {} });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetHttpSleep();
  resetStatePublisher();
});

test('a cycle reads every place in ONE request', async () => {
  const gladys = createFakeGladys();
  const calls = stubPollen();
  await pollenStation.refresh(gladys, config);
  assert.equal(calls.length, 1);
  assert.equal(pointCount(calls[0]), 2);
  assert.deepEqual(gladys.statuses.at(-1), { connected: true, message: undefined });
});

test('a request covered by the running pass JOINS it', async () => {
  const gladys = createFakeGladys();
  const { promise, open } = gate();
  const calls = stubPollen({ gate: promise });

  const cycle = pollenStation.refresh(gladys, config);
  const button = refreshLocations(gladys, [PARIS], 'fr');
  const scene = poll(gladys, LYON, 'fr');
  open();
  await Promise.all([cycle, button, scene]);

  assert.equal(calls.length, 1, 'one request for the three of them');
  const overall = deviceExternalIds(gladys, PARIS).feature('overall-risk');
  assert.equal(
    gladys.published.filter((state) => state.featureExternalId === overall).length,
    1,
    'the states of a place are published once',
  );
});

test('requests the running pass does not cover are merged into ONE follow-up', async () => {
  const gladys = createFakeGladys();
  const { promise, open } = gate();
  const calls = stubPollen({ gate: promise });

  const first = refreshLocations(gladys, [PARIS], 'fr');
  // Lyon is not in the running pass, and neither is the English wording.
  const second = refreshLocations(gladys, [LYON], 'fr');
  const third = refreshLocations(gladys, [PARIS], 'en');
  open();
  const counts = await Promise.all([first, second, third]);

  assert.deepEqual(counts, [
    { refreshed: 1, failed: 0 },
    { refreshed: 1, failed: 0 },
    { refreshed: 1, failed: 0 },
  ]);
  // Paris alone, then Paris (cached) and Lyon in ONE follow-up pass.
  assert.equal(calls.length, 2);
  assert.equal(pointCount(calls[1]), 1, 'the follow-up only asks for what is not cached');
  // The follow-up publishes in the most recent language.
  const text = deviceExternalIds(gladys, LYON).feature('overall-risk-text');
  assert.match(gladys.published.findLast((state) => state.featureExternalId === text).text, /high/);
});

test('a provider outage is reported as such', async () => {
  const gladys = createFakeGladys();
  stubPollen({ ok: false });
  await pollenStation.refresh(gladys, config);
  const status = gladys.statuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /pollen forecast unavailable: Open-Meteo HTTP 503/);
  assert.match(status.message.en, /\+1 other location/);
});

test('a host-API 429 is NOT blamed on the pollen provider', async () => {
  const gladys = createFakeGladys({ refuseStates: () => gladysApiError(429) });
  stubPollen();
  await pollenStation.refresh(gladys, config);
  const status = gladys.statuses.at(-1);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /Gladys rate limit reached \(HTTP 429\)/);
  assert.doesNotMatch(status.message.en, /pollen forecast/);
  assert.match(status.message.fr, /limite de débit de Gladys/);
  // One request, its one retry, and nothing more: the next cycle tries again.
  assert.equal(gladys.stateBatches.length, 2);
});

test('another host-API refusal names Gladys too', async () => {
  const gladys = createFakeGladys({ refuseStates: () => gladysApiError(400, 'invalid state') });
  stubPollen();
  await pollenStation.refresh(gladys, config);
  assert.match(
    gladys.statuses.at(-1).message.en,
    /Gladys did not accept the states: invalid state/,
  );
});

test('a place whose states were refused fires no scene event', async () => {
  const gladys = createFakeGladys({ refuseStates: () => gladysApiError(429) });
  stubPollen({ birch: 2 });
  await pollenStation.refresh(gladys, config);
  clearPollenCache();
  stubPollen({ birch: 400 });
  await pollenStation.refresh(gladys, config);
  // The event would describe a value the features do not hold.
  assert.deepEqual(gladys.sceneEvents, []);
});

test('a single poll that Gladys refuses throws, for the caller to count', async () => {
  const gladys = createFakeGladys({ refuseStates: () => gladysApiError(500) });
  stubPollen();
  await assert.rejects(() => poll(gladys, PARIS, 'fr'), /HTTP 500/);
  assert.deepEqual(await refreshLocations(gladys, [PARIS], 'fr'), { refreshed: 0, failed: 1 });
});

test('no place, no status: "add a location" must stay on screen', async () => {
  const gladys = createFakeGladys();
  await pollenStation.refresh(gladys, normalizeConfig({ locations: [] }));
  assert.deepEqual(gladys.statuses, []);
});

test('the status goes through the reporter it is given', async () => {
  const gladys = createFakeGladys();
  stubPollen();
  const reported = [];
  await pollenStation.refresh(gladys, config, {
    reportStatus: async (...args) => reported.push(args),
  });
  assert.deepEqual(reported, [[true]]);
  assert.deepEqual(gladys.statuses, []);
});

test('a created device refreshes ITS place only', async () => {
  const gladys = createFakeGladys();
  const calls = stubPollen();
  const device = deviceExternalIds(gladys, LYON).device;

  assert.equal(await pollenStation.onDeviceCreated(gladys, config, device), true);
  assert.equal(calls.length, 1);
  assert.equal(pointCount(calls[0]), 1);
  assert.ok(gladys.published.every((state) => state.featureExternalId.startsWith(device)));
});

test('a created device that is not ours refreshes nothing', async () => {
  const gladys = createFakeGladys();
  const calls = stubPollen();
  assert.equal(await pollenStation.onDeviceCreated(gladys, config, 'zigbee:lamp'), false);
  assert.equal(calls.length, 0);
});

// --- The timer --------------------------------------------------------------

test('a first start refreshes straight away', async () => {
  const gladys = createFakeGladys();
  const calls = stubPollen();
  const stop = pollenStation.startPolling(gladys, config);
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
});

test('a restart right after a healthy cycle resumes the cadence instead', async () => {
  // A reconnection or a saved form used to re-read and re-publish everything,
  // whatever the age of the data.
  const gladys = createFakeGladys();
  stubPollen();
  await pollenStation.refresh(gladys, config);
  const published = gladys.published.length;
  const statuses = gladys.statuses.length;

  const stop = pollenStation.startPolling(gladys, config);
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(gladys.published.length, published, 'nothing re-published');
  // ... but the healthy status is said again, for a core that restarted.
  assert.equal(gladys.statuses.length, statuses + 1);
  assert.equal(gladys.statuses.at(-1).connected, true);
});

test('a restart on another list, or another language, refreshes straight away', async () => {
  const gladys = createFakeGladys();
  const calls = stubPollen();
  await pollenStation.refresh(gladys, config);
  assert.equal(calls.length, 1);

  const english = normalizeConfig({ locations: [paris, lyon], language: 'en' });
  const stop = pollenStation.startPolling(gladys, english);
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  const text = deviceExternalIds(gladys, PARIS).feature('overall-risk-text');
  assert.match(gladys.published.findLast((state) => state.featureExternalId === text).text, /high/);
});

test('a restart after a FAILED cycle refreshes straight away', async () => {
  const gladys = createFakeGladys();
  stubPollen({ ok: false });
  await pollenStation.refresh(gladys, config);
  const calls = stubPollen();
  const stop = pollenStation.startPolling(gladys, config);
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
});

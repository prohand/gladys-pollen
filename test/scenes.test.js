// The scene surface: when a trigger fires (and, mostly, when it must NOT), and
// what the two scene actions hand back to the scene. `fetch` is stubbed so the
// suite never touches the network.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { normalizeConfig } from '../src/config.js';
import { deviceExternalIds } from '../src/devices/pollenStation.js';
import { clearPollenCache, OPEN_METEO_VARIABLES } from '../src/pollen/openMeteo.js';
import {
  publishRiskEvents,
  resetRiskMemory,
  riskTransitions,
  SCENE_ACTION_HANDLERS,
  SCENE_TRIGGERS,
} from '../src/scenes/index.js';

const paris = {
  id: 'loc-paris001',
  name: 'Maison',
  address_label: 'Paris, Île-de-France, France',
  latitude: '48.8592',
  longitude: '2.3417',
};

const config = normalizeConfig({ locations: [paris] });
const location = config.locations[0];
const DEVICE_ID = 'pollen-station:loc-paris001';

const originalFetch = globalThis.fetch;

/** A reading as `readPollenRisk` builds one, with the given per-taxon levels. */
function reading(risks, { concentrations = {}, measuredAt = '2026-04-12T13:00+02:00' } = {}) {
  let level = null;
  let taxon = null;
  for (const [key, value] of Object.entries(risks)) {
    if (value !== null && (level === null || value > level)) {
      level = value;
      taxon = key;
    }
  }
  return {
    provider: 'open-meteo-cams',
    concentrations,
    risks,
    overall: { level, taxon: level > 0 ? taxon : null },
    measuredAt,
  };
}

function stubFetch(payload) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => payload };
  };
  return calls;
}

/** The canned Open-Meteo answer the scene actions read. */
function currentPayload({ birch = 80, grass = 2 } = {}) {
  return {
    utc_offset_seconds: 7200,
    current: {
      time: '2026-04-12T13:00',
      [OPEN_METEO_VARIABLES.birch]: birch,
      [OPEN_METEO_VARIABLES.grass]: grass,
    },
  };
}

async function fire(gladys, risks, options) {
  return publishRiskEvents(gladys, {
    location,
    deviceExternalId: DEVICE_ID,
    reading: reading(risks, options),
    language: 'fr',
  });
}

beforeEach(() => {
  resetRiskMemory();
  clearPollenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --- When a trigger fires, and when it does not ------------------------------

test('the first reading fires nothing: unknown is not a previous level', async () => {
  const gladys = createFakeGladys();
  assert.equal(await fire(gladys, { birch: 4 }), 0);
  assert.deepEqual(gladys.sceneEvents, []);
});

test('a level that moved fires one overall event and one taxon event', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 2 });
  await fire(gladys, { birch: 4 });

  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.key),
    [SCENE_TRIGGERS.RISK_LEVEL_CHANGED, SCENE_TRIGGERS.TAXON_RISK_LEVEL_CHANGED],
  );
});

test('the same reading twice fires nothing at all', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 3 });
  gladys.sceneEvents.length = 0;
  await fire(gladys, { birch: 3 });
  await fire(gladys, { birch: 3 });
  assert.deepEqual(gladys.sceneEvents, []);
});

test('a taxon with no value is not a fall to zero', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 4 });
  gladys.sceneEvents.length = 0;
  // The model has no birch value this hour: no state is published for it, and
  // no event either — the level stays the last known one.
  await fire(gladys, { birch: null });
  assert.deepEqual(gladys.sceneEvents, []);

  // ...so the next real value is compared with 4, not with nothing.
  await fire(gladys, { birch: 4 });
  assert.deepEqual(gladys.sceneEvents, []);
  await fire(gladys, { birch: 1 });
  assert.equal(gladys.sceneEvents.length, 2);
});

test('two locations remember their own levels', () => {
  assert.deepEqual(riskTransitions('loc-a', reading({ birch: 2 })).taxa, []);
  assert.deepEqual(riskTransitions('loc-b', reading({ birch: 5 })).taxa, []);
  assert.deepEqual(riskTransitions('loc-a', reading({ birch: 5 })).taxa, [
    { taxon: 'birch', from: 2, to: 5, direction: 'rising' },
  ]);
  // loc-b never moved: its own memory says 5.
  assert.deepEqual(riskTransitions('loc-b', reading({ birch: 5 })).taxa, []);
});

// --- What the event carries ---------------------------------------------------

test('the overall event carries the filters and the words of the scene', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 1 });
  await fire(gladys, { birch: 3, grass: 1 }, { concentrations: { birch: 95 } });

  const { data } = gladys.sceneEvents.find(
    (event) => event.key === SCENE_TRIGGERS.RISK_LEVEL_CHANGED,
  );
  assert.equal(data.location, DEVICE_ID, 'the filter compares device external_ids');
  assert.equal(data.location_name, 'Maison');
  // A multi_select can only declare STRING options: a number would match none.
  assert.equal(data.level, '3');
  assert.equal(typeof data.level, 'string');
  assert.equal(data.previous_level, '1');
  assert.equal(data.level_label, 'élevé');
  assert.equal(data.direction, 'rising');
  assert.equal(data.taxon, 'birch');
  assert.equal(data.taxon_name, 'Bouleau');
  assert.equal(data.measured_at, '12/04/2026 13:00');
  assert.equal(data.summary, 'Pollens à Maison : risque 3/3 (élevé), dominant Bouleau.');
});

test('the taxon event names the species and its concentration', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { grass: 3 });
  await fire(gladys, { grass: 1 }, { concentrations: { grass: 0.5 } });

  const { data } = gladys.sceneEvents.find(
    (event) => event.key === SCENE_TRIGGERS.TAXON_RISK_LEVEL_CHANGED,
  );
  assert.equal(data.taxon, 'grass');
  assert.equal(data.taxon_name, 'Graminées');
  assert.equal(data.direction, 'falling');
  assert.equal(data.concentration, 0.5);
  assert.equal(data.summary, 'Graminées à Maison : risque 1/3 (faible).');
});

test('a falling risk back to nothing still names no dominant pollen', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 3 });
  await fire(gladys, { birch: 0 });

  const { data } = gladys.sceneEvents.find(
    (event) => event.key === SCENE_TRIGGERS.RISK_LEVEL_CHANGED,
  );
  assert.equal(data.level, '0');
  assert.equal(data.taxon, '', 'level 0 has no dominant species to name');
  assert.equal(data.summary, 'Pollens à Maison : risque 0/3 (pas de risque).');
});

test('the event data stays flat and small enough for the core', async () => {
  const gladys = createFakeGladys();
  await fire(gladys, { birch: 1 });
  await fire(gladys, { birch: 5 }, { concentrations: { birch: 400 } });

  for (const { data } of gladys.sceneEvents) {
    assert.ok(Object.keys(data).length <= 30);
    for (const [key, value] of Object.entries(data)) {
      assert.ok(
        value === null || ['string', 'number', 'boolean'].includes(typeof value),
        `${key} must be a primitive, got ${typeof value}`,
      );
      if (typeof value === 'string') {
        assert.ok(value.length <= 1000);
      }
    }
  }
});

test('a refused event never takes the refresh cycle down', async () => {
  const gladys = createFakeGladys({ refuseSceneEvents: true });
  await fire(gladys, { birch: 1 });
  assert.equal(await fire(gladys, { birch: 4 }), 0, 'nothing accepted, nothing thrown');
});

// --- Scene actions -------------------------------------------------------------

test('get_pollen_risk answers the declared outputs, in the configured language', async () => {
  const gladys = createFakeGladys();
  stubFetch(currentPayload({ birch: 80 }));

  const outputs = await SCENE_ACTION_HANDLERS.get_pollen_risk(gladys, {
    fields: { location: DEVICE_ID, taxon: 'overall' },
    config,
  });

  assert.equal(outputs.level, 3);
  assert.equal(outputs.level_label, 'élevé');
  assert.equal(outputs.taxon, 'birch');
  assert.equal(outputs.taxon_name, 'Bouleau');
  assert.equal(outputs.concentration, 80);
  assert.equal(outputs.location_name, 'Maison');
  assert.equal(outputs.measured_at, '12/04/2026 13:00');
  assert.equal(outputs.summary, 'Pollens à Maison : risque 3/3 (élevé), dominant Bouleau.');
});

test('get_pollen_risk reads ONE species when asked for one', async () => {
  const gladys = createFakeGladys();
  stubFetch(currentPayload({ birch: 80, grass: 2 }));

  const outputs = await SCENE_ACTION_HANDLERS.get_pollen_risk(gladys, {
    fields: { location: DEVICE_ID, taxon: 'grass' },
    config,
  });

  assert.equal(outputs.taxon, 'grass');
  assert.equal(outputs.level, 1, 'the grass level, not the birch one');
  assert.equal(outputs.concentration, 2);
  assert.equal(outputs.summary, 'Graminées à Maison : risque 1/3 (faible).');
});

test('get_pollen_risk reports "no data" as an output, never as a failure', async () => {
  const gladys = createFakeGladys();
  stubFetch({ utc_offset_seconds: 7200, current: { time: '2026-04-12T13:00' } });

  const outputs = await SCENE_ACTION_HANDLERS.get_pollen_risk(gladys, {
    fields: { location: DEVICE_ID },
    config,
  });
  // A scene action is never a condition: the scene author branches on the
  // output rather than on an exception that stops nothing.
  assert.equal(outputs.level, null);
  assert.equal(outputs.summary, 'Pollens à Maison : données indisponibles.');
});

test('a scene pointing at a device nobody watches says so', async () => {
  const gladys = createFakeGladys();
  await assert.rejects(
    () =>
      SCENE_ACTION_HANDLERS.get_pollen_risk(gladys, {
        fields: { location: 'pollen-station:loc-gone' },
        config,
      }),
    /No location watches the device/,
  );
});

test('refresh_pollen republishes the states and counts the places', async () => {
  const gladys = createFakeGladys();
  stubFetch(currentPayload({ birch: 80 }));

  const outputs = await SCENE_ACTION_HANDLERS.refresh_pollen(gladys, {
    fields: { location: '' },
    config,
  });

  assert.deepEqual(outputs, { refreshed: 1, failed: 0 });
  const ids = deviceExternalIds(gladys, location);
  assert.ok(
    gladys.published.some((state) => state.featureExternalId === ids.feature('overall-risk')),
  );
  // The card of an open dashboard must not wait a whole ttl for a value the
  // user just asked for.
  assert.ok(gladys.widgetRefreshes.includes('pollen_station'));
});

test('refresh_pollen counts a failing place instead of throwing', async () => {
  const gladys = createFakeGladys();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  const outputs = await SCENE_ACTION_HANDLERS.refresh_pollen(gladys, { fields: {}, config });
  assert.deepEqual(outputs, { refreshed: 0, failed: 1 });
});

// The dashboard widgets: what each card is made of, and that the core would
// render it exactly as sent. `validateWidgetContent` is the SDK's own copy of
// the checks the core applies — an empty array means nothing is dropped,
// truncated or trimmed by the content budget.
//
// `fetch` is stubbed so the suite never touches the network.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { normalizeConfig } from '../src/config.js';
import { deviceExternalIds } from '../src/devices/pollenStation.js';
import { clearPollenCache, OPEN_METEO_VARIABLES } from '../src/pollen/openMeteo.js';
import { findWidget, WIDGET_KEYS, WIDGETS } from '../src/widgets/index.js';
import { MAX_ROWS } from '../src/widgets/locationsWidget.js';
import { selectedTaxa } from '../src/widgets/stationWidget.js';

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
const PARIS_DEVICE = 'pollen-station:loc-paris001';

const station = findWidget(WIDGET_KEYS.STATION);
const locations = findWidget(WIDGET_KEYS.LOCATIONS);

const originalFetch = globalThis.fetch;

/** 48 hourly points, rising from nothing to a birch peak. */
function hourlyPayload() {
  const time = [];
  const birch = [];
  const grass = [];
  for (let hour = 0; hour < 48; hour += 1) {
    time.push(`2026-04-12T${String(hour % 24).padStart(2, '0')}:00`);
    birch.push(hour * 5);
    grass.push(hour < 24 ? 0 : 6);
  }
  return {
    utc_offset_seconds: 7200,
    hourly: {
      time,
      [OPEN_METEO_VARIABLES.birch]: birch,
      [OPEN_METEO_VARIABLES.grass]: grass,
    },
  };
}

function currentPayload({ birch = 80, grass = 2, olive = 0 } = {}) {
  return {
    utc_offset_seconds: 7200,
    current: {
      time: '2026-04-12T13:00',
      [OPEN_METEO_VARIABLES.birch]: birch,
      [OPEN_METEO_VARIABLES.grass]: grass,
      [OPEN_METEO_VARIABLES.olive]: olive,
    },
  };
}

/** The station card needs TWO requests: the current hour, then the curve. */
function stubFetch({ current = currentPayload(), hourly = hourlyPayload(), ok = true } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return {
      ok,
      status: ok ? 200 : 503,
      json: async () => (String(url).includes('hourly=') ? hourly : current),
    };
  };
  return calls;
}

/** Every content this suite builds must pass the core's own checks. */
function assertRenderable(content) {
  assert.deepEqual(validateWidgetContent(content), [], 'the core would alter this content');
  return content;
}

function componentsOf(content, type) {
  return content.components.filter((component) => component.type === type);
}

beforeEach(() => {
  clearPollenCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// --- The registry --------------------------------------------------------------

test('every widget answers both questions the core asks', () => {
  for (const widget of WIDGETS) {
    assert.match(widget.key, /^[a-z0-9_]{2,32}$/);
    assert.equal(typeof widget.getContent, 'function');
    assert.equal(typeof widget.onAction, 'function');
  }
});

// --- The station card ----------------------------------------------------------

test('a widget with no place picked asks for one instead of looking broken', async () => {
  const gladys = createFakeGladys();
  const content = assertRenderable(await station.getContent(gladys, config, { settings: {} }));
  assert.equal(content.components.length, 1);
  assert.equal(content.components[0].type, 'text');
});

test('a place the integration no longer watches gets the same answer', async () => {
  const gladys = createFakeGladys();
  const content = await station.getContent(gladys, config, {
    settings: { location: 'pollen-station:loc-gone' },
  });
  assert.equal(content.components[0].type, 'text');
});

test('the station card holds the heading, the gauge, the species, the curve', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const content = assertRenderable(
    await station.getContent(gladys, config, {
      settings: { location: PARIS_DEVICE },
      language: 'fr',
    }),
  );

  assert.deepEqual(
    content.components.map((component) => component.type),
    ['text', 'gauge', 'status', 'chart', 'text', 'button'],
  );
  assert.equal(content.components[0].text, 'Maison');
  assert.match(content.components[4].text, /^CAMS · 12\/04\/2026 13:00$/);
});

test('an unfiltered gauge is bound to the device feature, a filtered one is not', async () => {
  const gladys = createFakeGladys();
  stubFetch();
  const ids = deviceExternalIds(gladys, config.locations[0]);

  const every = await station.getContent(gladys, config, { settings: { location: PARIS_DEVICE } });
  const [gauge] = componentsOf(every, 'gauge');
  // Device-bound: the tile follows the published states in real time, with no
  // pull and no nudge at all.
  assert.equal(gauge.device_feature, ids.feature('overall-risk'));
  assert.equal(gauge.value, undefined);

  const filtered = await station.getContent(gladys, config, {
    settings: { location: PARIS_DEVICE, taxa: ['grass'] },
  });
  const [own] = componentsOf(filtered, 'gauge');
  // No feature holds "the worst of the species you ticked": that number can
  // only be the one this content computed.
  assert.equal(own.device_feature, undefined);
  assert.equal(own.value, 2, 'the grass level, not the birch one');
});

test('the species rows show what IS in the air, worst first', async () => {
  const gladys = createFakeGladys();
  stubFetch({ current: currentPayload({ birch: 80, grass: 2, olive: 0 }) });

  const content = await station.getContent(gladys, config, {
    settings: { location: PARIS_DEVICE },
    language: 'fr',
  });
  const [status] = componentsOf(content, 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Bouleau', 'Graminées'],
    'olive is at zero: a row saying nothing is a row too many',
  );
  assert.equal(status.items[0].value, '4/5 (élevé)');
  assert.equal(status.items[0].color, 'danger');
});

test('nothing in the air is an answer, not an empty card', async () => {
  const gladys = createFakeGladys();
  stubFetch({ current: currentPayload({ birch: 0, grass: 0, olive: 0 }) });

  const content = assertRenderable(
    await station.getContent(gladys, config, {
      settings: { location: PARIS_DEVICE },
      language: 'fr',
    }),
  );
  const [status] = componentsOf(content, 'status');
  assert.equal(status.items.length, 1);
  assert.match(status.items[0].label, /Aucun pollen/);
});

test('the curve is one series per followed species, and steps', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const content = await station.getContent(gladys, config, {
    settings: { location: PARIS_DEVICE, taxa: ['birch', 'grass'] },
    language: 'fr',
  });
  const [chart] = componentsOf(content, 'chart');
  assert.deepEqual(
    chart.series.map((series) => series.name),
    ['Bouleau', 'Graminées'],
  );
  assert.equal(chart.chart_type, 'stepline');
  assert.equal(chart.now_marker, true);
  assert.equal(chart.series[0].points.length, 48);
  // A forecast hour is a complete instant: the local clock of the place plus
  // its offset, never a bare wall clock.
  assert.equal(chart.series[0].points[0].t, '2026-04-12T00:00+02:00');
});

test('more than four species share ONE curve', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const content = assertRenderable(
    await station.getContent(gladys, config, {
      settings: { location: PARIS_DEVICE },
      language: 'fr',
    }),
  );
  const [chart] = componentsOf(content, 'chart');
  assert.equal(chart.series.length, 1, 'a chart takes four series at most');
  assert.equal(chart.series[0].name, 'Risque global');
});

test('the forecast can be switched off', async () => {
  const gladys = createFakeGladys();
  const calls = stubFetch();

  const content = await station.getContent(gladys, config, {
    settings: { location: PARIS_DEVICE, forecast: false },
  });
  assert.deepEqual(componentsOf(content, 'chart'), []);
  assert.ok(!calls.some((url) => url.includes('hourly=')), 'no curve, no second request');
});

test('a failing forecast costs the curve, never the risk', async () => {
  const gladys = createFakeGladys();
  globalThis.fetch = async (url) => {
    if (String(url).includes('hourly=')) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => currentPayload() };
  };

  const content = assertRenderable(
    await station.getContent(gladys, config, { settings: { location: PARIS_DEVICE } }),
  );
  assert.deepEqual(componentsOf(content, 'chart'), []);
  assert.equal(componentsOf(content, 'gauge').length, 1);
});

test('a provider outage says so instead of showing an empty card', async () => {
  const gladys = createFakeGladys();
  stubFetch({ ok: false });

  const content = assertRenderable(
    await station.getContent(gladys, config, { settings: { location: PARIS_DEVICE } }),
  );
  assert.equal(content.components.length, 1);
  assert.equal(content.components[0].type, 'text');
});

// --- The language of a card ------------------------------------------------------

test('a card is written in the language of whoever reads it', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const english = await station.getContent(gladys, config, {
    settings: { location: PARIS_DEVICE },
    language: 'en',
  });
  const [status] = componentsOf(english, 'status');
  assert.equal(status.items[0].label, 'Birch');
  assert.equal(status.items[0].value, '4/5 (high)');
});

test('a language this integration does not speak falls back to the configured one', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const german = await station.getContent(gladys, normalizeConfig({ ...config, language: 'en' }), {
    settings: { location: PARIS_DEVICE },
    language: 'de',
  });
  const [status] = componentsOf(german, 'status');
  assert.equal(status.items[0].label, 'Birch', 'an English install stays English');
});

// --- The settings ----------------------------------------------------------------

test('nothing ticked means every species', () => {
  assert.equal(selectedTaxa([]).length, 6);
  assert.equal(selectedTaxa(undefined).length, 6);
  assert.deepEqual(selectedTaxa(['birch', 'grass']), ['birch', 'grass']);
  // An option the code no longer knows is dropped rather than looked up.
  assert.deepEqual(selectedTaxa(['birch', 'cypress']), ['birch']);
  assert.equal(selectedTaxa(['cypress']).length, 6);
});

// --- The "all places" card --------------------------------------------------------

test('the list card holds one row per place, with its dominant pollen', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const content = assertRenderable(await locations.getContent(gladys, config, { language: 'fr' }));
  assert.deepEqual(
    content.components.map((component) => component.type),
    ['status', 'text', 'button'],
  );
  const [status] = componentsOf(content, 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Maison', 'Bureau'],
  );
  assert.equal(status.items[0].value, '4/5 (élevé) — Bouleau');
});

test('a place the provider refuses is one row saying so', async () => {
  const gladys = createFakeGladys();
  let first = true;
  globalThis.fetch = async () => {
    const ok = first;
    first = false;
    return { ok, status: ok ? 200 : 503, json: async () => currentPayload() };
  };

  const content = assertRenderable(await locations.getContent(gladys, config, { language: 'fr' }));
  const [status] = componentsOf(content, 'status');
  assert.equal(status.items.length, 2, 'one place failing hides none of the others');
  assert.ok(status.items.some((item) => item.value === 'indisponible'));
});

test('no place at all asks for one', async () => {
  const gladys = createFakeGladys();
  const content = assertRenderable(
    await locations.getContent(gladys, normalizeConfig({ locations: [] }), {}),
  );
  assert.equal(content.components.length, 1);
});

test('the list stops at ten rows and reads only those', async () => {
  const many = normalizeConfig({
    locations: Array.from({ length: 14 }, (unused, index) => ({
      ...paris,
      id: `loc-${String(index).padStart(8, '0')}`,
      name: `Lieu ${index}`,
      // Distinct points, so the provider cache cannot serve them from one call.
      latitude: String(48 + index / 100),
    })),
  });
  const gladys = createFakeGladys();
  const calls = stubFetch();

  const content = assertRenderable(await locations.getContent(gladys, many, { language: 'fr' }));
  const [status] = componentsOf(content, 'status');
  assert.equal(status.items.length, MAX_ROWS);
  assert.equal(calls.length, MAX_ROWS, 'a row nobody sees is a request nobody needs');
  assert.match(componentsOf(content, 'text')[0].text, /10 lieux sur 14/);
});

// --- The buttons -------------------------------------------------------------------

test('the station button refreshes that place only', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const toast = await station.onAction(
    gladys,
    config,
    'refresh',
    {},
    {
      settings: { location: PARIS_DEVICE },
    },
  );
  assert.equal(toast.fr, 'Maison rafraîchi.');
  const ids = deviceExternalIds(gladys, config.locations[0]);
  assert.ok(
    gladys.published.every((state) => state.featureExternalId.startsWith(ids.device)),
    'only the place of this instance was refreshed',
  );
});

test('the list button refreshes every place', async () => {
  const gladys = createFakeGladys();
  stubFetch();

  const toast = await locations.onAction(gladys, config, 'refresh', {}, { settings: {} });
  assert.equal(toast.fr, '2 lieu(x) rafraîchi(s).');
});

test('a toast stays inside the 200 characters the core keeps', async () => {
  const gladys = createFakeGladys();
  stubFetch();
  const toast = await locations.onAction(gladys, config, 'refresh', {}, { settings: {} });
  for (const text of Object.values(toast)) {
    assert.ok(text.length <= 200);
  }
});

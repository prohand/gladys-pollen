// The discovery payload and the state mapping: what Gladys actually receives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import {
  buildDiscoveredDevices,
  findBlueprintByDevice,
  locationDeviceIds,
} from '../src/devices/index.js';
import {
  buildDevice,
  buildStates,
  deviceExternalIds,
  FEATURE,
  MIN_REFRESH_SECONDS,
  pollenStation,
  watchedLocations,
} from '../src/devices/pollenStation.js';
import { allTaxa } from '../src/pollen/index.js';
import { normalizeConfig } from '../src/config.js';

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

function configWith(locations, rest = {}) {
  return normalizeConfig({ locations, ...rest });
}

/** The location as it comes out of the configuration (coordinates parsed). */
function stored(location, config) {
  return config.locations.find((candidate) => candidate.id === location.id);
}

test('one device is discovered per configured location', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, configWith([paris, lyon]));
  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Pollens — Maison', 'Pollens — Bureau'],
  );
});

test('no location means an empty Discovery tab, not an error', () => {
  const gladys = createFakeGladys();
  assert.deepEqual(buildDiscoveredDevices(gladys, configWith([])), []);
});

test('a location with no usable point publishes no device', () => {
  const gladys = createFakeGladys();
  const config = configWith([{ ...paris, latitude: '' }]);
  assert.deepEqual(buildDiscoveredDevices(gladys, config), []);
});

test('a location no provider covers publishes no device', () => {
  // Sydney: outside the CAMS European domain, the forecast is all nulls there.
  const gladys = createFakeGladys();
  const sydney = { ...paris, id: 'loc-sydney01', latitude: '-33.8688', longitude: '151.2093' };
  assert.deepEqual(watchedLocations(configWith([sydney])), []);
  assert.deepEqual(buildDiscoveredDevices(gladys, configWith([sydney])), []);
});

test('device external ids are unique and stable', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris, lyon]);
  const devices = buildDiscoveredDevices(gladys, config);
  const ids = devices.map((device) => device.external_id);
  assert.equal(new Set(ids).size, 2);

  // The identity is the LOCATION ID, not the point: renaming a location or
  // moving it must not orphan the device the user added to a room.
  const moved = configWith([{ ...paris, name: 'Chez moi', latitude: '48.90' }]);
  assert.equal(buildDevice(gladys, stored(paris, moved)).external_id, ids[0]);
});

test('a device declares NO poll_frequency', () => {
  // The core only accepts a fixed enum of intervals in milliseconds, capped at
  // one minute: any other value has the WHOLE batch refused, which is what left
  // the Discovery tab empty. The integration runs its own timer instead.
  const gladys = createFakeGladys();
  const config = configWith([paris], { poll_frequency: 7200 });
  const device = buildDevice(gladys, stored(paris, config));
  assert.equal(device.poll_frequency, undefined);
});

test('every feature carries a numeric min and max', () => {
  // `t_device_feature.min`/`max` are NOT NULL with no default in the core: a
  // feature without them is refused when the user adds the device — publishing
  // succeeds, the click fails.
  const gladys = createFakeGladys();
  const config = configWith([paris]);
  for (const feature of buildDevice(gladys, stored(paris, config)).features) {
    assert.equal(typeof feature.min, 'number', `${feature.name} needs a min`);
    assert.equal(typeof feature.max, 'number', `${feature.name} needs a max`);
    assert.equal(feature.read_only, true);
    assert.equal(feature.has_feedback, false);
  }
});

test('a device carries one risk feature per taxon, plus the overall trio', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris]);
  const device = buildDevice(gladys, stored(paris, config));
  assert.equal(device.features.length, allTaxa().length + 3);

  const ids = deviceExternalIds(gladys, paris);
  const externalIds = device.features.map((feature) => feature.external_id);
  for (const taxon of allTaxa()) {
    assert.ok(externalIds.includes(ids.feature(taxon)), `missing feature for ${taxon}`);
  }
  assert.ok(externalIds.includes(ids.feature(FEATURE.OVERALL_RISK)));
  assert.ok(externalIds.includes(ids.feature(FEATURE.OVERALL_RISK_TEXT)));
  assert.ok(externalIds.includes(ids.feature(FEATURE.DOMINANT_POLLEN)));
});

test('risk features are historized and bounded to 0-5', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris]);
  const device = buildDevice(gladys, stored(paris, config));
  const riskFeatures = device.features.filter((feature) => feature.category === 'risk');
  assert.equal(riskFeatures.length, allTaxa().length + 1);
  for (const feature of riskFeatures) {
    assert.equal(feature.keep_history, true);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 5);
  }
});

test('the device carries its resolved position as params', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris]);
  const device = buildDevice(gladys, stored(paris, config));
  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(params.LOCATION_ID, paris.id);
  assert.equal(params.LOCATION_NAME, 'Maison');
  assert.equal(params.LATITUDE, '48.8592');
});

test('a device is routed back to the blueprint that owns it', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris, lyon]);
  const [, lyonDevice] = buildDiscoveredDevices(gladys, config);
  assert.equal(findBlueprintByDevice(gladys, config, lyonDevice), pollenStation);
});

test('a device whose location was removed routes nowhere', () => {
  const gladys = createFakeGladys();
  const [parisDevice] = buildDiscoveredDevices(gladys, configWith([paris]));
  // The user removed the location but kept the device in Gladys.
  assert.equal(findBlueprintByDevice(gladys, configWith([lyon]), parisDevice), undefined);
});

test('the external ids of one location are what the delete action looks for', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith([paris]));
  assert.deepEqual(locationDeviceIds(gladys, paris), [device.external_id]);
});

test('a reading becomes one state per taxon plus the overall trio', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: 3, grass: 1 },
    overall: { level: 3, taxon: 'birch' },
  });

  assert.deepEqual(states, [
    { device_feature_external_id: ids.feature('birch'), state: 3 },
    { device_feature_external_id: ids.feature('grass'), state: 1 },
    { device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK), state: 3 },
    { device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK_TEXT), text: 'moderate' },
    { device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLEN), text: 'Birch' },
  ]);
});

test('a taxon without data publishes nothing rather than a zero', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: 2, olive: null },
    overall: { level: 2, taxon: 'birch' },
  });
  const featureIds = states.map((state) => state.device_feature_external_id);
  assert.ok(!featureIds.includes(ids.feature('olive')));
});

test('a quiet day reports no dominant pollen', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: 0, grass: 0 },
    overall: { level: 0, taxon: null },
  });
  const dominant = states.find(
    (state) => state.device_feature_external_id === ids.feature(FEATURE.DOMINANT_POLLEN),
  );
  assert.equal(dominant.text, 'None');
});

test('a reading with no data at all publishes nothing', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: null, grass: null },
    overall: { level: null, taxon: null },
  });
  assert.deepEqual(states, []);
});

test('the refresh timer never runs faster than the floor', async () => {
  const gladys = createFakeGladys();
  const config = configWith([], { poll_frequency: 900 });
  // No location: the cycle publishes nothing and reports a healthy connection.
  const stop = pollenStation.startPolling(gladys, config);
  stop();
  assert.ok(MIN_REFRESH_SECONDS <= config.poll_frequency);
});

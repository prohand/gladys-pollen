// The discovery payload and the state mapping: what Gladys actually receives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { buildDiscoveredDevices, findLocationByDevice } from '../src/devices/index.js';
import {
  buildDevice,
  buildStates,
  deviceExternalIds,
  FEATURE,
} from '../src/devices/pollenStation.js';
import { allTaxa } from '../src/pollen/index.js';
import { normalizeConfig } from '../src/config.js';

const paris = {
  id: 'fr-75001-paris',
  country: 'FR',
  postal_code: '75001',
  city: 'Paris',
  latitude: 48.8592,
  longitude: 2.3417,
};

const lyon = {
  id: 'fr-69001-lyon',
  country: 'FR',
  postal_code: '69001',
  city: 'Lyon',
  latitude: 45.7679,
  longitude: 4.8343,
};

function configWith(locations) {
  return normalizeConfig({ locations });
}

test('one device is discovered per configured location', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, configWith([paris, lyon]));
  assert.equal(devices.length, 2);
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Pollen Paris (75001)', 'Pollen Lyon (69001)'],
  );
});

test('no location means an empty Discovery tab, not an error', () => {
  const gladys = createFakeGladys();
  assert.deepEqual(buildDiscoveredDevices(gladys, configWith([])), []);
});

test('device external ids are unique and stable', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, configWith([paris, lyon]));
  const ids = devices.map((device) => device.external_id);
  assert.equal(new Set(ids).size, 2);
  // Rebuilt from the same location: the user's device must not be orphaned.
  const again = buildDevice(gladys, paris, configWith([paris]));
  assert.equal(again.external_id, devices[0].external_id);
});

test('a device carries one risk feature per taxon, plus overall and dominant', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, paris, configWith([paris]));
  assert.equal(device.features.length, allTaxa().length + 2);

  const ids = deviceExternalIds(gladys, paris);
  const externalIds = device.features.map((feature) => feature.external_id);
  for (const taxon of allTaxa()) {
    assert.ok(externalIds.includes(ids.feature(taxon)), `missing feature for ${taxon}`);
  }
  assert.ok(externalIds.includes(ids.feature(FEATURE.OVERALL_RISK)));
  assert.ok(externalIds.includes(ids.feature(FEATURE.DOMINANT_POLLEN)));
});

test('risk features are read-only, historized and bounded to 0-5', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, paris, configWith([paris]));
  const riskFeatures = device.features.filter((feature) => feature.category === 'risk');
  assert.equal(riskFeatures.length, allTaxa().length + 1);
  for (const feature of riskFeatures) {
    assert.equal(feature.read_only, true);
    assert.equal(feature.keep_history, true);
    assert.equal(feature.min, 0);
    assert.equal(feature.max, 5);
  }
});

test('the device carries its resolved position as params', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(gladys, paris, configWith([paris]));
  const params = Object.fromEntries(device.params.map((p) => [p.name, p.value]));
  assert.equal(params.CITY, 'Paris');
  assert.equal(params.POSTAL_CODE, '75001');
  assert.equal(params.LATITUDE, '48.8592');
});

test('the poll frequency of the config reaches the device', () => {
  const gladys = createFakeGladys();
  const device = buildDevice(
    gladys,
    paris,
    normalizeConfig({ locations: [paris], poll_frequency: 7200 }),
  );
  assert.equal(device.poll_frequency, 7200);
});

test('a device is routed back to its location', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris, lyon]);
  const [, lyonDevice] = buildDiscoveredDevices(gladys, config);
  assert.equal(findLocationByDevice(gladys, config, lyonDevice)?.city, 'Lyon');
});

test('a device whose location was removed routes nowhere', () => {
  const gladys = createFakeGladys();
  const [parisDevice] = buildDiscoveredDevices(gladys, configWith([paris]));
  // The user removed the location but kept the device in Gladys.
  assert.equal(findLocationByDevice(gladys, configWith([lyon]), parisDevice), undefined);
});

test('a reading becomes one state per taxon plus the overall pair', () => {
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

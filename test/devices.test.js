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
  taxonName,
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

test('a device carries one risk feature per taxon, plus the overall four', () => {
  const gladys = createFakeGladys();
  const config = configWith([paris]);
  const device = buildDevice(gladys, stored(paris, config));
  assert.equal(device.features.length, allTaxa().length + 4);

  const ids = deviceExternalIds(gladys, paris);
  const externalIds = device.features.map((feature) => feature.external_id);
  for (const taxon of allTaxa()) {
    assert.ok(externalIds.includes(ids.feature(taxon)), `missing feature for ${taxon}`);
  }
  assert.ok(externalIds.includes(ids.feature(FEATURE.OVERALL_RISK)));
  assert.ok(externalIds.includes(ids.feature(FEATURE.OVERALL_RISK_TEXT)));
  assert.ok(externalIds.includes(ids.feature(FEATURE.DOMINANT_POLLEN)));
  // The date of the data sits on EACH station rather than on one device global
  // to the integration: it is the local hour the forecast is valid at for that
  // point, which two locations in two timezones do not share.
  assert.ok(externalIds.includes(ids.feature(FEATURE.LAST_UPDATE)));
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

test('the features are named in French unless the user asks for English', () => {
  // A feature name is a plain string the core stores as it is published: Gladys
  // translates the action messages for us, never a name (see src/language.js).
  const gladys = createFakeGladys();
  const french = configWith([paris]);
  const namesOf = (config) =>
    buildDevice(gladys, stored(paris, config), config.language).features.map((f) => f.name);

  assert.deepEqual(namesOf(french), [
    'Risque pollinique global',
    'Risque pollinique global (texte)',
    'Risque pollinique — Aulne',
    'Risque pollinique — Bouleau',
    'Risque pollinique — Graminées',
    'Risque pollinique — Armoise',
    'Risque pollinique — Olivier',
    'Risque pollinique — Ambroisie',
    'Pollen dominant',
    'Dernière mise à jour des données',
  ]);

  const english = namesOf(configWith([paris], { language: 'en' }));
  assert.equal(english[0], 'Overall pollen risk');
  assert.ok(english.includes('Birch pollen risk'));
  assert.ok(english.includes('Dominant pollen'));
  assert.ok(english.includes('Last data update'));
});

test('the language of the names is the one of the configuration', () => {
  const gladys = createFakeGladys();
  const [device] = buildDiscoveredDevices(gladys, configWith([paris], { language: 'en' }));
  assert.ok(device.features.some((feature) => feature.name === 'Ragweed pollen risk'));

  // An unsupported language is French, not a device named after a taxon key.
  const [fallback] = buildDiscoveredDevices(gladys, configWith([paris], { language: 'de' }));
  assert.ok(fallback.features.some((feature) => feature.name === 'Risque pollinique — Ambroisie'));
});

test('renaming the features leaves the identity of the device untouched', () => {
  // The external ids carry the history: switching language must not orphan a
  // device the user already added to a room.
  const gladys = createFakeGladys();
  const french = configWith([paris]);
  const english = configWith([paris], { language: 'en' });
  const idsOf = (config) => [
    buildDevice(gladys, stored(paris, config), config.language).external_id,
    ...buildDevice(gladys, stored(paris, config), config.language).features.map(
      (feature) => feature.external_id,
    ),
  ];
  assert.deepEqual(idsOf(english), idsOf(french));
});

test('a taxon no translation knows keeps its key as a name', () => {
  assert.equal(taxonName('birch', 'fr'), 'Bouleau');
  assert.equal(taxonName('cypress', 'fr'), 'cypress');
  assert.equal(taxonName('cypress', 'en'), 'cypress');
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
    measuredAt: '2026-08-06T13:00+02:00',
  });

  // The TEXT states are stored as they are published, so they follow the same
  // language as the feature names — French unless the user says otherwise.
  assert.deepEqual(states, [
    { device_feature_external_id: ids.feature('birch'), state: 3 },
    { device_feature_external_id: ids.feature('grass'), state: 1 },
    { device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK), state: 3 },
    { device_feature_external_id: ids.feature(FEATURE.OVERALL_RISK_TEXT), text: 'moyen' },
    { device_feature_external_id: ids.feature(FEATURE.DOMINANT_POLLEN), text: 'Bouleau' },
    { device_feature_external_id: ids.feature(FEATURE.LAST_UPDATE), text: '06/08/2026 13:00' },
  ]);
});

test('the date of the data is written in the configured language', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const reading = {
    risks: { birch: 3 },
    overall: { level: 3, taxon: 'birch' },
    measuredAt: '2026-08-06T13:00+02:00',
  };
  const lastUpdate = (states) =>
    states.find((state) => state.device_feature_external_id === ids.feature(FEATURE.LAST_UPDATE))
      ?.text;

  assert.equal(lastUpdate(buildStates(ids, reading, 'en')), '2026-08-06 13:00');
  assert.equal(lastUpdate(buildStates(ids, reading, 'fr')), '06/08/2026 13:00');
});

test('an undated reading publishes its risks and no date', () => {
  // A provider that does not date its answer must not stop the risks being
  // published — and must not have a date invented for it either.
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: 3 },
    overall: { level: 3, taxon: 'birch' },
    measuredAt: null,
  });
  assert.ok(states.some((state) => state.device_feature_external_id === ids.feature('birch')));
  assert.ok(
    !states.some((state) => state.device_feature_external_id === ids.feature(FEATURE.LAST_UPDATE)),
  );
});

test('the text states are written in the configured language', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const reading = { risks: { birch: 3 }, overall: { level: 3, taxon: 'birch' } };
  const text = (states, feature) =>
    states.find((state) => state.device_feature_external_id === ids.feature(feature)).text;

  const english = buildStates(ids, reading, 'en');
  assert.equal(text(english, FEATURE.OVERALL_RISK_TEXT), 'moderate');
  assert.equal(text(english, FEATURE.DOMINANT_POLLEN), 'Birch');
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
  const quiet = { risks: { birch: 0, grass: 0 }, overall: { level: 0, taxon: null } };
  const dominant = buildStates(ids, quiet).find(
    (state) => state.device_feature_external_id === ids.feature(FEATURE.DOMINANT_POLLEN),
  );
  assert.equal(dominant.text, 'Aucun');
  const english = buildStates(ids, quiet, 'en').find(
    (state) => state.device_feature_external_id === ids.feature(FEATURE.DOMINANT_POLLEN),
  );
  assert.equal(english.text, 'None');
});

test('a reading with no data at all publishes nothing', () => {
  const gladys = createFakeGladys();
  const ids = deviceExternalIds(gladys, paris);
  const states = buildStates(ids, {
    risks: { birch: null, grass: null },
    overall: { level: null, taxon: null },
    // Dated, but about nothing: a lone timestamp would date a measurement that
    // is not there.
    measuredAt: '2026-08-06T13:00+02:00',
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

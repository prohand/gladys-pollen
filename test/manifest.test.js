// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code registers, nor how many positions the delete dropdown
// must offer — these tests keep them in sync so a forgotten step fails CI, not
// the install.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, POLL_FREQUENCY_LIMITS } from '../src/config.js';
import { DEVICE_BLUEPRINTS } from '../src/devices/index.js';
import { DEFAULT_LANGUAGE, LANGUAGES } from '../src/language.js';
import { createLocationEditor } from '../src/locationEditor.js';
import { MAX_LOCATIONS } from '../src/locations.js';
import { allTaxa } from '../src/pollen/index.js';
import { RISK_LEVEL_LABELS, RISK_LEVEL_MAX } from '../src/pollen/risk.js';
import { OVERALL_TAXON, SCENE_ACTION_HANDLERS, SCENE_TRIGGERS } from '../src/scenes/index.js';
import { WIDGETS } from '../src/widgets/index.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

// Every action key the code actually registers: the device blueprints own the
// ones about pollen, the location manager the ones about the list.
const HANDLED_ACTIONS = [
  ...DEVICE_BLUEPRINTS.flatMap((blueprint) => Object.keys(blueprint.actions ?? {})),
  ...Object.keys(
    createLocationEditor({
      getConfig: () => ({ locations: [] }),
      setConfig: async () => {},
      onLocationsChanged: async () => {},
    }).actions,
  ),
];

// The store schema only accepts these widget types — 'text' is NOT one of them,
// the free-text widget is called 'string'.
const ALLOWED_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

/**
 * Every field of the manifest: the configuration form, the action mini-forms,
 * the widget settings and the scene cards. They are all rendered by the same
 * `config_schema` engine, so the rules below apply to all of them.
 */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
    ...sceneDeclarations().flatMap((declaration) => declaration.fields ?? []),
  ];
}

/** The scene cards of the manifest, triggers and actions alike. */
function sceneDeclarations() {
  return [...(manifest.scene_triggers ?? []), ...(manifest.scene_actions ?? [])];
}

/** Their `variables` (triggers) and `outputs` (actions): the same shape. */
function sceneScalars(declaration) {
  return declaration.variables ?? declaration.outputs ?? [];
}

function action(key) {
  return (manifest.actions ?? []).find((a) => a.key === key);
}

function widget(key) {
  return (manifest.widgets ?? []).find((w) => w.key === key);
}

function sceneTrigger(key) {
  return (manifest.scene_triggers ?? []).find((t) => t.key === key);
}

function sceneAction(key) {
  return (manifest.scene_actions ?? []).find((a) => a.key === key);
}

/** The `options` values of a field, in order. */
function optionValues(field) {
  return (field.options ?? []).map((option) => option.value);
}

function fieldOf(declaration, key) {
  return (declaration.fields ?? []).find((f) => f.key === key);
}

test('every manifest action has a registered handler, and vice versa', () => {
  for (const declared of manifest.actions ?? []) {
    assert.ok(
      HANDLED_ACTIONS.includes(declared.key),
      `manifest action "${declared.key}" has no handler in the code`,
    );
  }
  for (const handled of HANDLED_ACTIONS) {
    assert.ok(
      (manifest.actions ?? []).some((declared) => declared.key === handled),
      `handler "${handled}" is not declared in the manifest: no button runs it`,
    );
  }
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
});

test('the refresh interval is clamped to the bounds the manifest declares', () => {
  const field = manifest.config_schema.find((f) => f.key === 'poll_frequency');
  assert.equal(field.min, POLL_FREQUENCY_LIMITS.min);
  assert.equal(field.max, POLL_FREQUENCY_LIMITS.max);
});

test('the language dropdown offers exactly the languages the code writes', () => {
  // The names of the devices are the one thing Gladys cannot translate for us,
  // so the user picks their language here — French by default, because the host
  // API never says which language the user reads (see src/language.js).
  const field = manifest.config_schema.find((f) => f.key === 'language');
  assert.equal(field.type, 'select');
  assert.equal(field.default, DEFAULT_LANGUAGE);
  assert.deepEqual(
    field.options.map((option) => option.value),
    LANGUAGES,
    'a language offered in the form must be one the code can write',
  );
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((field) => field.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    // A section stores NO value: declaring `required`, `default` or
    // `placeholder` on it rejects the manifest, and its key must never leak
    // into the config the code manipulates.
    assert.equal(section.required, undefined, `section "${section.key}" must not be required`);
    assert.equal(section.default, undefined, `section "${section.key}" must not have a default`);
    assert.equal(section.placeholder, undefined, `section "${section.key}" needs no placeholder`);
    assert.ok(section.label?.en, `section "${section.key}" needs an English label`);
    assert.ok(!(section.key in DEFAULT_CONFIG), `section "${section.key}" stores no value`);
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('locations is NOT a config_schema field', () => {
  // It is written by the integration through setConfig, not typed by the user:
  // no static form can hold a list built at runtime.
  const keys = manifest.config_schema.map((field) => field.key);
  assert.ok(!keys.includes('locations'));
});

test('nothing asks the user for a country any more', () => {
  // Everything downstream works on a latitude and a longitude, and the geocoder
  // is worldwide: a country field would be a question with no consequence.
  for (const field of allFields()) {
    assert.ok(
      !/country|pays/i.test(field.key),
      `field "${field.key}" brings the country back into the form`,
    );
  }
});

test('a coordinate is typed in a `string` field, never in a `number` one', () => {
  // An <input type="number"> is sanitized by the browser against ITS OWN locale:
  // a French one refuses "48.8566" and the front then drops the key from the
  // payload, so the value silently keeps whatever it held.
  for (const field of allFields()) {
    if (/latitude|longitude/.test(field.key)) {
      assert.equal(field.type, 'string', `"${field.key}" must not be a number field`);
    }
  }
});

test('the delete action names a location by its number in the listing', () => {
  const picker = (action('remove_location').fields ?? []).find((f) => f.key === 'location');
  assert.ok(picker, 'the only dropdown left, and it deletes');
  assert.equal(picker.type, 'select');
  assert.equal(picker.required, true);
  assert.equal(picker.default, '1');
  // Static options, because that is all a manifest can hold: they are the
  // positions the listing prints, which is what maps a number to a name.
  assert.deepEqual(
    picker.options.map((option) => option.value),
    Array.from({ length: MAX_LOCATIONS }, (unused, index) => String(index + 1)),
    'the dropdown and MAX_LOCATIONS must not drift apart',
  );
});

test('the delete action is guarded by a confirmation', () => {
  const confirmation = (action('remove_location').fields ?? []).find(
    (f) => f.key === 'confirmation',
  );
  assert.ok(confirmation, 'one click away from losing a location is one too few');
  assert.equal(confirmation.type, 'boolean');
  assert.equal(confirmation.default, false);
});

test('the delete action is the LAST button of the screen', () => {
  // The buttons are rendered in manifest order, and this one is the only
  // destructive button of the page: it sits under the read-only reports rather
  // than between them, where a mis-click lands while looking for the test.
  const keys = manifest.actions.map((a) => a.key);
  assert.equal(keys[keys.length - 1], 'remove_location');
});

test('the two reporting actions announce the SAME entry format', () => {
  // They answer about the same list of locations, under the same numbers:
  // "• number. name — detail" (see locationLine in src/locations.js).
  for (const key of ['list_locations', 'test_provider']) {
    const reporting = action(key);
    assert.equal((reporting.fields ?? []).length, 0, `${key} reports on every location`);
    assert.match(reporting.description.fr, /•/, `${key} documents the entry marker`);
    assert.match(reporting.description.fr, /numéro/i, `${key} documents the entry number`);
    assert.match(reporting.description.en, /•/);
  }
});

test('every field declares a widget type the store accepts', () => {
  for (const field of allFields()) {
    assert.ok(
      ALLOWED_FIELD_TYPES.includes(field.type),
      `field "${field.key}" has the unsupported type "${field.type}"`,
    );
  }
});

// The rules below are the ones Gladys enforces itself in `validateManifest`
// before installing: getting them wrong shows the user "The integration
// manifest is invalid." with no detail, so they are worth pinning here.

test('the store description fits the catalog card', () => {
  // 10-100 characters PER LANGUAGE — the card is one line, and a long
  // description rejects the whole manifest at install time.
  assert.ok(manifest.description.en, 'an English description is mandatory');
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

test('every human text is a multi-language object', () => {
  // `label`, `description` and `placeholder` are ALWAYS { en, … } objects,
  // never bare strings — including a placeholder that looks like a constant.
  const check = (value, path) => {
    if (value === undefined) {
      return;
    }
    assert.equal(typeof value, 'object', `${path} must be a { en, … } object, not a bare value`);
    assert.equal(typeof value.en, 'string', `${path}.en is mandatory`);
  };

  const checkField = (field, path) => {
    check(field.label, `${path}.label`);
    check(field.description, `${path}.description`);
    check(field.placeholder, `${path}.placeholder`);
    for (const [index, option] of (field.options ?? []).entries()) {
      check(option.label, `${path}.options[${index}].label`);
    }
    for (const [index, link] of (field.links ?? []).entries()) {
      check(link.label, `${path}.links[${index}].label`);
    }
  };

  for (const [index, field] of manifest.config_schema.entries()) {
    checkField(field, `config_schema[${index}]`);
  }
  for (const declared of manifest.actions ?? []) {
    check(declared.label, `action "${declared.key}".label`);
    check(declared.description, `action "${declared.key}".description`);
    for (const [index, field] of (declared.fields ?? []).entries()) {
      checkField(field, `action "${declared.key}".fields[${index}]`);
    }
  }
  for (const declared of manifest.widgets ?? []) {
    check(declared.label, `widget "${declared.key}".label`);
    check(declared.description, `widget "${declared.key}".description`);
    for (const [index, field] of (declared.settings ?? []).entries()) {
      checkField(field, `widget "${declared.key}".settings[${index}]`);
    }
  }
  for (const declared of sceneDeclarations()) {
    check(declared.label, `scene "${declared.key}".label`);
    check(declared.description, `scene "${declared.key}".description`);
    for (const [index, field] of (declared.fields ?? []).entries()) {
      checkField(field, `scene "${declared.key}".fields[${index}]`);
    }
    for (const scalar of sceneScalars(declared)) {
      check(scalar.label, `scene "${declared.key}".${scalar.key}.label`);
    }
  }
});

test('a section description stays under the 1000-character limit', () => {
  for (const field of allFields()) {
    for (const [language, text] of Object.entries(field.description ?? {})) {
      assert.ok(
        text.length <= 1000,
        `${field.key}.description.${language} is ${text.length} characters`,
      );
    }
  }
});

test('placeholders stay on the field types that render an input', () => {
  const allowed = new Set(['string', 'number', 'secret']);
  for (const field of allFields()) {
    if (field.placeholder !== undefined) {
      assert.ok(allowed.has(field.type), `"${field.key}": a ${field.type} takes no placeholder`);
    }
  }
});

test('an action timeout stays inside the range the core accepts', () => {
  for (const declared of manifest.actions ?? []) {
    if (declared.timeout_seconds !== undefined) {
      assert.ok(
        declared.timeout_seconds >= 5 && declared.timeout_seconds <= 120,
        `action "${declared.key}": timeout_seconds must be 5-120`,
      );
    }
  }
});

test('the manifest asks for the house coordinates the import button reads', () => {
  // `GET /house` is an authorization contract, not just an endpoint: without
  // this line the core answers 403 and "Add my Gladys houses" can only apologize.
  assert.equal(manifest.location, true, 'import_houses reads GET /house');
  assert.ok(
    (manifest.actions ?? []).some((declared) => declared.key === 'import_houses'),
    'declaring the permission without the button asks the user for nothing in return',
  );
});

test('the compatibility range covers every field the manifest declares', () => {
  // Each capability field has a floor, and the range must clear the HIGHEST
  // one: house coordinates landed in Gladys 4.85.0, `categories` in 4.86.0,
  // and the widgets / scene declarations in 5.1.0. An instance older than that
  // validates manifests against a strict field allowlist and rejects the whole
  // integration over the unknown field — which turns a catalog filter into a
  // cryptic install failure. 5.1.0 is the floor as long as `widgets`,
  // `scene_triggers` or `scene_actions` is declared.
  assert.match(manifest.gladys_version, /^>=(5\.[1-9]\d*|[6-9]\.\d+|\d{2,}\.\d+)\./);
  const [, major, minor] = manifest.gladys_version.match(/^>=(\d+)\.(\d+)\./).map(Number);
  for (const field of ['widgets', 'scene_triggers', 'scene_actions']) {
    if (manifest[field] !== undefined) {
      assert.ok(
        major > 5 || (major === 5 && minor >= 1),
        `${field} requires gladys_version >= 5.1.0, got "${manifest.gladys_version}"`,
      );
    }
  }
});

test('the catalog categories are 1 to 3 keys of the store vocabulary', () => {
  // The browse categories the catalog shelves this integration under. The store
  // filters unknown keys with a warning rather than rejecting, so a typo would
  // silently leave the integration reachable through "All" and search only.
  const STORE_CATEGORIES = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
  ];
  assert.ok(Array.isArray(manifest.categories), 'categories must be declared');
  assert.ok(
    manifest.categories.length >= 1 && manifest.categories.length <= 3,
    `categories takes 1 to 3 keys, got ${manifest.categories.length}`,
  );
  assert.equal(
    new Set(manifest.categories).size,
    manifest.categories.length,
    'the keys must be unique',
  );
  for (const category of manifest.categories) {
    assert.ok(STORE_CATEGORIES.includes(category), `"${category}" is not a store category`);
  }
  // The coupling rule the store validator enforces: a core older than 4.86.0
  // validates manifests against a strict field allowlist and rejects any
  // unknown top-level field, so declaring `categories` below that range turns a
  // catalog filter into a cryptic install failure.
  const [, major, minor] = manifest.gladys_version.match(/^>=(\d+)\.(\d+)\./).map(Number);
  assert.ok(
    major > 4 || (major === 4 && minor >= 86),
    `categories requires gladys_version >= 4.86.0, got "${manifest.gladys_version}"`,
  );
});

test('the manifest declares the cloud transport only', () => {
  // Every source is an HTTP API on the Internet: there is no local channel to
  // prefer, so Gladys must not show the "prefer local" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

// -----------------------------------------------------------------------------
// The three surfaces Gladys 5.1 opened: dashboard widgets, scene triggers and
// scene actions. Their failure mode is the same as the manifest actions': a
// declared key with no handler is a card that does nothing, and a handler with
// no declaration is code nobody can reach. Both are silent, so both are tested.
// -----------------------------------------------------------------------------

test('every declared widget has a handler, and vice versa', () => {
  const handled = WIDGETS.map((w) => w.key);
  for (const declared of manifest.widgets ?? []) {
    assert.ok(
      handled.includes(declared.key),
      `widget "${declared.key}" is declared but nothing builds its content`,
    );
  }
  for (const key of handled) {
    assert.ok(
      widget(key),
      `widget "${key}" has a builder but no declaration: no dashboard can add it`,
    );
  }
});

test('the manifest stays inside the widget caps the core enforces', () => {
  // Five widgets per integration, and a label the picker tile can hold.
  assert.ok((manifest.widgets ?? []).length <= 5);
  for (const declared of manifest.widgets ?? []) {
    assert.match(declared.key, /^[a-z0-9_]{2,32}$/);
    for (const [language, text] of Object.entries(declared.label)) {
      assert.ok(
        text.length >= 3 && text.length <= 30,
        `widget "${declared.key}".label.${language} must be 3-30 characters, got ${text.length}`,
      );
    }
    for (const text of Object.values(declared.description ?? {})) {
      assert.ok(text.length <= 100, `widget "${declared.key}": description is one line`);
    }
    assert.ok((declared.settings ?? []).length <= 10);
    if (declared.action_timeout_seconds !== undefined) {
      assert.ok(
        declared.action_timeout_seconds >= 5 && declared.action_timeout_seconds <= 120,
        `widget "${declared.key}": action_timeout_seconds must be 5-120`,
      );
    }
  }
});

test('a widget setting never asks for a secret', () => {
  // A dashboard JSON is readable by every user of that dashboard, non-admins
  // included: the store refuses `secret`, `oauth2` and `account_link` there.
  const allowed = ['string', 'number', 'boolean', 'select', 'multi_select', 'section'];
  for (const declared of manifest.widgets ?? []) {
    for (const field of declared.settings ?? []) {
      assert.ok(
        allowed.includes(field.type),
        `widget "${declared.key}": a ${field.type} setting is refused`,
      );
    }
  }
});

test('the station widget binds to one of OUR devices, not to a typed name', () => {
  // `source: "devices"` is the only way a widget instance can point at a
  // device: the options are the created devices of this integration, and the
  // stored value is the external_id the code maps back to a location.
  const picker = (widget('pollen_station').settings ?? []).find((f) => f.key === 'location');
  assert.equal(picker.type, 'select');
  assert.equal(picker.source, 'devices');
  assert.equal(picker.required, true);
  assert.equal(picker.options, undefined, '`source` and `options` are mutually exclusive');
});

test('the species a widget can follow are the species the code knows', () => {
  const picker = (widget('pollen_station').settings ?? []).find((f) => f.key === 'taxa');
  assert.equal(picker.type, 'multi_select');
  assert.deepEqual(optionValues(picker), allTaxa());
  assert.equal(picker.default, undefined, 'nothing ticked is the "every species" wildcard');
});

test('every declared scene action has a handler, and vice versa', () => {
  const handled = Object.keys(SCENE_ACTION_HANDLERS);
  for (const declared of manifest.scene_actions ?? []) {
    assert.ok(
      handled.includes(declared.key),
      `scene action "${declared.key}" is declared but nothing runs it`,
    );
  }
  for (const key of handled) {
    assert.ok(sceneAction(key), `scene action handler "${key}" is in no scene editor`);
  }
});

test('every trigger the code fires is declared, and vice versa', () => {
  const fired = Object.values(SCENE_TRIGGERS);
  for (const key of fired) {
    // The core answers 404 on an undeclared key: the event would be fired into
    // the void, with nothing in the scene editor to catch it.
    assert.ok(sceneTrigger(key), `the code fires "${key}", the manifest declares no such trigger`);
  }
  for (const declared of manifest.scene_triggers ?? []) {
    assert.ok(
      fired.includes(declared.key),
      `trigger "${declared.key}" is a card nothing ever fires`,
    );
  }
});

test('a scene card stays inside the caps the core enforces', () => {
  assert.ok((manifest.scene_triggers ?? []).length <= 20);
  assert.ok((manifest.scene_actions ?? []).length <= 20);
  for (const declared of sceneDeclarations()) {
    assert.match(declared.key, /^[a-z0-9_]+$/);
    assert.ok(declared.key.length <= 40);
    assert.ok((declared.fields ?? []).length <= 10);
    assert.ok(sceneScalars(declared).length <= 20);
    if (declared.timeout_seconds !== undefined) {
      assert.ok(declared.timeout_seconds >= 5 && declared.timeout_seconds <= 120);
    }
  }
});

test('a trigger filter is never a boolean, and never has a default', () => {
  for (const declared of manifest.scene_triggers ?? []) {
    for (const field of declared.fields ?? []) {
      // A toggle has no empty state, so it could never express "any"; and a
      // default would take the wildcard away from a filter left untouched.
      assert.notEqual(field.type, 'boolean', `trigger "${declared.key}.${field.key}"`);
      assert.equal(
        field.default,
        undefined,
        `trigger "${declared.key}.${field.key}": an empty filter must stay a wildcard`,
      );
      assert.notEqual(field.required, true, `trigger "${declared.key}.${field.key}"`);
    }
  }
});

test('a scene variable or output is a scalar, under a unique key', () => {
  for (const declared of sceneDeclarations()) {
    const keys = sceneScalars(declared).map((scalar) => scalar.key);
    assert.equal(new Set(keys).size, keys.length, `scene "${declared.key}": duplicate key`);
    for (const scalar of sceneScalars(declared)) {
      assert.ok(
        ['string', 'number', 'boolean'].includes(scalar.type),
        `scene "${declared.key}.${scalar.key}": an image or a file is not a scene value`,
      );
      assert.match(scalar.key, /^[a-z0-9_]+$/);
    }
  }
});

test('the level filters offer exactly the 0-5 scale the code publishes', () => {
  const scale = Array.from({ length: RISK_LEVEL_MAX + 1 }, (unused, level) => String(level));
  for (const declared of manifest.scene_triggers ?? []) {
    const field = fieldOf(declared, 'level');
    assert.ok(field, `trigger "${declared.key}" filters on a level`);
    assert.equal(field.type, 'multi_select');
    // The event data carries the level as a STRING for this very reason: a
    // multi_select stores option values, and an option value is a string.
    assert.deepEqual(optionValues(field), scale);
    for (const [index, option] of field.options.entries()) {
      for (const language of Object.keys(RISK_LEVEL_LABELS[index])) {
        assert.match(
          option.label[language],
          new RegExp(RISK_LEVEL_LABELS[index][language]),
          `trigger "${declared.key}": level ${index} is not named as the code names it`,
        );
      }
    }
  }
});

test('the species filters and the read action know the same species', () => {
  assert.deepEqual(optionValues(fieldOf(sceneTrigger('taxon_risk_level_changed'), 'taxon')), [
    ...allTaxa(),
  ]);
  // The read action offers one more choice: "the worst of them", which is what
  // the overall risk means.
  assert.deepEqual(optionValues(fieldOf(sceneAction('get_pollen_risk'), 'taxon')), [
    OVERALL_TAXON,
    ...allTaxa(),
  ]);
  assert.equal(fieldOf(sceneAction('get_pollen_risk'), 'taxon').default, OVERALL_TAXON);
});

test('the scene action that reads a place requires one, the one that refreshes does not', () => {
  // Reading needs a place to read; refreshing without one means "all of them",
  // which is the documented wildcard of that field.
  assert.equal(fieldOf(sceneAction('get_pollen_risk'), 'location').required, true);
  assert.notEqual(fieldOf(sceneAction('refresh_pollen'), 'location').required, true);
  for (const key of ['get_pollen_risk', 'refresh_pollen']) {
    assert.equal(fieldOf(sceneAction(key), 'location').source, 'devices');
  }
});

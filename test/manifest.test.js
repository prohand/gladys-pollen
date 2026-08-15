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

/** Every field of the manifest, config fields and action fields alike. */
function allFields() {
  return [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((action) => action.fields ?? []),
  ];
}

function action(key) {
  return (manifest.actions ?? []).find((a) => a.key === key);
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
  // House coordinates landed in Gladys 4.85.0 and `categories` in 4.86.0. An
  // instance older than that rejects the field, and the whole integration with
  // it: the range is what keeps this version away from the instances it cannot
  // run on. 4.86.0 is the floor as long as `categories` is declared.
  assert.match(manifest.gladys_version, /^>=4\.(8[6-9]|9\d|\d{3,})\./);
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

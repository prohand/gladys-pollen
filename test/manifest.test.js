// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code registers, nor which countries are implemented —
// these tests keep them in sync so a forgotten step fails CI, not the install.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { supportedCountryCodes } from '../src/countries/index.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');

test('every manifest action has a registered handler', () => {
  for (const action of manifest.actions ?? []) {
    assert.ok(
      indexSource.includes(`gladys.onAction('${action.key}'`),
      `manifest action "${action.key}" has no handler in index.js`,
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
  // It is written by the integration through setConfig, not typed by the user.
  // Declaring it would render a raw JSON textarea in the Configuration screen.
  const keys = manifest.config_schema.map((field) => field.key);
  assert.ok(!keys.includes('locations'));
});

test('the country options match the implemented countries', () => {
  // The single place where adding a country can silently go half-done: the
  // registry has the code but the form still offers only France.
  const implemented = supportedCountryCodes().sort();

  const addLocation = manifest.actions.find((action) => action.key === 'add_location');
  const countryField = addLocation.fields.find((field) => field.key === 'country');
  assert.deepEqual(
    countryField.options.map((option) => option.value).sort(),
    implemented,
    'the add_location country options must list every implemented country',
  );

  const defaultCountry = manifest.config_schema.find((field) => field.key === 'default_country');
  assert.deepEqual(
    defaultCountry.options.map((option) => option.value).sort(),
    implemented,
    'the default_country options must list every implemented country',
  );
  assert.ok(implemented.includes(defaultCountry.default));
});

test('every action field declares a supported type', () => {
  const supported = new Set(['string', 'number', 'select', 'multi_select', 'secret', 'section']);
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.ok(
        supported.has(field.type),
        `action "${action.key}": unknown field type ${field.type}`,
      );
    }
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
  for (const action of manifest.actions ?? []) {
    check(action.label, `action "${action.key}".label`);
    check(action.description, `action "${action.key}".description`);
    for (const [index, field] of (action.fields ?? []).entries()) {
      checkField(field, `action "${action.key}".fields[${index}]`);
    }
  }
});

test('placeholders stay on the field types that render an input', () => {
  const allowed = new Set(['string', 'number', 'secret']);
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      if (field.placeholder !== undefined) {
        assert.ok(
          allowed.has(field.type),
          `action "${action.key}": a ${field.type} field takes no placeholder`,
        );
      }
    }
  }
  for (const field of manifest.config_schema) {
    if (field.placeholder !== undefined) {
      assert.ok(
        allowed.has(field.type),
        `config field "${field.key}": a ${field.type} field takes no placeholder`,
      );
    }
  }
});

test('the manifest declares the cloud transport only', () => {
  // Every source is an HTTP API on the Internet: there is no local channel to
  // prefer, so Gladys must not show the "prefer local" toggle.
  assert.deepEqual(manifest.transports, ['cloud']);
});

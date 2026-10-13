import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inEveryLanguage,
  inLanguage,
  LANGUAGES,
  MESSAGE_LANGUAGES,
  normalizeLanguage,
} from '../src/language.js';
import { levelText, overallSummary } from '../src/riskText.js';

test('the device names speak the four languages of the Gladys interface', () => {
  assert.deepEqual([...LANGUAGES].sort(), ['de', 'en', 'es', 'fr']);
  assert.deepEqual(MESSAGE_LANGUAGES, ['en', 'fr', 'de', 'es']);
  assert.equal(normalizeLanguage('de-DE'), 'de');
  assert.equal(normalizeLanguage('ES'), 'es');
});

test('a missing translation falls back on English', () => {
  assert.equal(inLanguage({ en: 'Birch', fr: 'Bouleau', de: 'Birke' }, 'de'), 'Birke');
  assert.equal(inLanguage({ en: 'Birch', fr: 'Bouleau' }, 'es'), 'Birch');
  assert.equal(inLanguage({ fr: 'Bouleau' }, 'es'), 'Bouleau');
});

test('a message built per language carries every language', () => {
  assert.deepEqual(
    inEveryLanguage((language) => language.toUpperCase()),
    { en: 'EN', fr: 'FR', de: 'DE', es: 'ES' },
  );
});

test('the risk is put into German and Spanish words', () => {
  assert.equal(levelText(3, 'de'), '3/3 (hoch)');
  assert.equal(levelText(0, 'es'), '0/3 (sin riesgo)');
  assert.equal(
    overallSummary({ locationName: 'Montauban', level: 3, taxon: 'birch' }, 'de'),
    'Pollen in Montauban: Risiko 3/3 (hoch), vorherrschend Birke.',
  );
  assert.equal(
    overallSummary({ locationName: 'Montauban', level: 2, taxon: 'grass' }, 'es'),
    'Polen en Montauban: riesgo 2/3 (medio), dominante Gramíneas.',
  );
});

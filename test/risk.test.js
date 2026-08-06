// Thresholds are the part of the integration a user actually feels: a wrong
// band turns a quiet day into a "very high risk" notification.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concentrationToRiskLevel, overallRisk, RISK_LEVELS } from '../src/pollen/risk.js';

test('a zero concentration is level 0, not level 1', () => {
  assert.equal(concentrationToRiskLevel('birch', 0), RISK_LEVELS.NONE);
  assert.equal(concentrationToRiskLevel('grass', 0), RISK_LEVELS.NONE);
});

test('missing data is null, never a zero risk', () => {
  assert.equal(concentrationToRiskLevel('birch', null), null);
  assert.equal(concentrationToRiskLevel('birch', undefined), null);
  assert.equal(concentrationToRiskLevel('birch', 'not a number'), null);
});

test('the same concentration grades differently per taxon', () => {
  // 30 grains/m³ is a quiet day for birch but a heavy one for ragweed:
  // this asymmetry is the whole point of per-taxon thresholds.
  assert.equal(concentrationToRiskLevel('birch', 30), RISK_LEVELS.MODERATE);
  assert.equal(concentrationToRiskLevel('ragweed', 30), RISK_LEVELS.HIGH);
});

test('every band of a taxon is reachable', () => {
  const birch = [0.5, 5, 50, 200, 500].map((value) => concentrationToRiskLevel('birch', value));
  assert.deepEqual(birch, [
    RISK_LEVELS.VERY_LOW,
    RISK_LEVELS.LOW,
    RISK_LEVELS.MODERATE,
    RISK_LEVELS.HIGH,
    RISK_LEVELS.VERY_HIGH,
  ]);
});

test('a bound belongs to the band above it', () => {
  // Boundaries are exclusive upper bounds: 10 is the start of "moderate".
  assert.equal(concentrationToRiskLevel('birch', 9.99), RISK_LEVELS.LOW);
  assert.equal(concentrationToRiskLevel('birch', 10), RISK_LEVELS.MODERATE);
});

test('an unknown taxon falls back on the default bands', () => {
  assert.equal(concentrationToRiskLevel('cypress', 0), RISK_LEVELS.NONE);
  assert.equal(concentrationToRiskLevel('cypress', 500), RISK_LEVELS.VERY_HIGH);
});

test('the overall risk is the worst taxon', () => {
  const overall = overallRisk({ birch: 1, grass: 4, ragweed: 2 });
  assert.deepEqual(overall, { level: 4, taxon: 'grass' });
});

test('the overall risk ignores taxa without data', () => {
  const overall = overallRisk({ birch: null, grass: 2, olive: undefined });
  assert.deepEqual(overall, { level: 2, taxon: 'grass' });
});

test('no data at all leaves the overall risk unknown', () => {
  assert.deepEqual(overallRisk({ birch: null, grass: null }), { level: null, taxon: null });
});

test('an all-zero day has no dominant pollen', () => {
  // Level 0 everywhere: reporting "dominant: birch" would be misleading.
  assert.deepEqual(overallRisk({ birch: 0, grass: 0 }), { level: 0, taxon: null });
});

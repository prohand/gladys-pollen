// What a `connected` does, step by step, and what each failure costs. Every
// dependency is injected: no Gladys, no timer actually armed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys, gladysApiError } from './helpers/fakeGladys.js';
import { createLifecycle, INIT_RETRY_MS, isTransient } from '../src/lifecycle.js';

/** A lifecycle over recorded steps; `failures` names the steps that throw. */
function createRecorded({ failures = {}, ready = true } = {}) {
  const gladys = createFakeGladys();
  const steps = [];
  const timers = [];
  const lifecycle = createLifecycle({
    gladys,
    async loadConfig() {
      steps.push('loadConfig');
      if (failures.loadConfig) {
        throw failures.loadConfig;
      }
    },
    isReady: () => ready,
    startPolling: () => steps.push('startPolling'),
    stopPolling: () => steps.push('stopPolling'),
    async publishDevices() {
      steps.push('publishDevices');
      const failure = failures.publishDevices;
      if (failure) {
        failures.publishDevices = failures.publishDevicesOnce ? null : failure;
        throw failure;
      }
    },
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  return { gladys, steps, timers, lifecycle };
}

test('the refresh is armed BEFORE anything is published', async () => {
  const { steps, lifecycle } = createRecorded();
  await lifecycle.initialize();
  assert.deepEqual(steps, ['loadConfig', 'startPolling', 'publishDevices']);
});

test('a 429 on the discovery publication leaves the refresh running and retries', async () => {
  const { steps, timers, gladys, lifecycle } = createRecorded({
    failures: { publishDevices: gladysApiError(429), publishDevicesOnce: true },
  });
  await lifecycle.initialize();

  assert.ok(steps.includes('startPolling'), 'the devices already created keep refreshing');
  assert.equal(gladys.statuses.at(-1).connected, false);
  assert.match(gladys.statuses.at(-1).message.en, /Initialization failed: HTTP 429/);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, INIT_RETRY_MS);

  // A minute later, it goes through and the problem is forgotten.
  await timers[0].fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lifecycle.problem, null);
  assert.equal(steps.filter((step) => step === 'publishDevices').length, 2);
});

test('a refused payload is not retried by itself, and stays on screen', async () => {
  const { timers, lifecycle, gladys } = createRecorded({
    failures: { publishDevices: gladysApiError(422, 'min cannot be null') },
  });
  await lifecycle.initialize();
  assert.equal(timers.length, 0);
  assert.match(lifecycle.problem.en, /min cannot be null/);

  // A healthy refresh cycle does not say "connected" over it.
  await lifecycle.reportStatus(true);
  assert.equal(gladys.statuses.at(-1).connected, false);
  assert.match(gladys.statuses.at(-1).message.en, /min cannot be null/);
});

test('an unreadable configuration still arms the refresh on the one in memory', async () => {
  const { steps, timers, lifecycle } = createRecorded({
    failures: { loadConfig: new TypeError('fetch failed') },
  });
  await lifecycle.initialize();
  assert.deepEqual(steps, ['loadConfig', 'startPolling']);
  assert.equal(timers.length, 1, 'a network failure is transient');
});

test('nothing to refresh stops the timer instead', async () => {
  const { steps, lifecycle } = createRecorded({ ready: false });
  await lifecycle.initialize();
  assert.deepEqual(steps, ['loadConfig', 'stopPolling', 'publishDevices']);
});

test('without a pending problem, a status goes through as it is', async () => {
  const { gladys, lifecycle } = createRecorded();
  await lifecycle.initialize();
  await lifecycle.reportStatus(true);
  await lifecycle.reportStatus(false, { en: 'x', fr: 'x' });
  assert.deepEqual(gladys.statuses, [
    { connected: true, message: undefined },
    { connected: false, message: { en: 'x', fr: 'x' } },
  ]);
});

test('what is transient and what is not', () => {
  assert.ok(isTransient(gladysApiError(429)));
  assert.ok(isTransient(gladysApiError(503)));
  assert.ok(isTransient(new TypeError('fetch failed')));
  assert.ok(!isTransient(gladysApiError(400)));
  assert.ok(!isTransient(gladysApiError(422)));
});

// The paced publisher: what keeps a full cycle under the host API rate limit,
// and what it does when Gladys answers 429 anyway. The clock is injected, so
// nothing here actually waits.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys, gladysApiError } from './helpers/fakeGladys.js';
import {
  DEFAULT_RATE_LIMIT_WAIT_MS,
  HOST_STATES_PER_MINUTE,
  isHostApiError,
  isRateLimited,
  MAX_STATES_PER_REQUEST,
  packBatches,
  publishStateGroups,
  resetStatePublisher,
  setStatePublisherClock,
  STATE_BUDGET_PER_MINUTE,
} from '../src/statePublisher.js';

/** A device's worth of states: 16, as a pollen station publishes. */
function device(index, size = 16) {
  return Array.from({ length: size }, (unused, feature) => ({
    device_feature_external_id: `pollen-station:loc-${index}:f${feature}`,
    state: 1,
  }));
}

/** A fake clock: `sleep` moves it forward and records the wait. */
function fakeClock() {
  const clock = { at: 0, waits: [] };
  setStatePublisherClock({
    now: () => clock.at,
    sleep: async (ms) => {
      clock.waits.push(ms);
      clock.at += ms;
    },
  });
  return clock;
}

beforeEach(() => {
  resetStatePublisher();
});

afterEach(() => {
  resetStatePublisher();
});

test('the budget stays under what the core admits', () => {
  assert.ok(STATE_BUDGET_PER_MINUTE < HOST_STATES_PER_MINUTE);
  assert.equal(MAX_STATES_PER_REQUEST, 100);
});

test('a device is never split across two requests', () => {
  const batches = packBatches(Array.from({ length: 7 }, (unused, index) => device(index)));
  // 6 devices of 16 fill 96 states; the seventh opens a second request.
  assert.deepEqual(
    batches.map((batch) => batch.states.length),
    [96, 16],
  );
  assert.deepEqual(batches[1].groups, [6]);
});

test('twenty places are published within the limit, over two minutes', async () => {
  const clock = fakeClock();
  const gladys = createFakeGladys();
  const groups = Array.from({ length: 20 }, (unused, index) => device(index));

  const outcomes = await publishStateGroups(gladys, groups);

  assert.ok(outcomes.every((outcome) => outcome === null));
  assert.equal(gladys.published.length, 320);
  assert.ok(gladys.stateBatches.every((size) => size <= MAX_STATES_PER_REQUEST));
  // 320 states do not fit in one minute: the tail waited for the window to
  // slide instead of being refused.
  assert.ok(clock.waits.length >= 1);
  assert.ok(clock.waits.reduce((total, ms) => total + ms, 0) <= 60_000);
});

test('a single place publishes at once, without waiting', async () => {
  const clock = fakeClock();
  const gladys = createFakeGladys();
  await publishStateGroups(gladys, [device(1)]);
  assert.deepEqual(clock.waits, []);
  assert.deepEqual(gladys.stateBatches, [16]);
});

test('two callers share ONE budget', async () => {
  const clock = fakeClock();
  const gladys = createFakeGladys();
  const many = Array.from({ length: 15 }, (unused, index) => device(index));
  await Promise.all([publishStateGroups(gladys, many), publishStateGroups(gladys, many)]);
  // 480 states: the second caller waited for the first one's minute.
  assert.ok(clock.waits.length >= 1);
  assert.equal(gladys.published.length, 480);
});

test('a 429 waits, then the same request is sent once more', async () => {
  const clock = fakeClock();
  const gladys = createFakeGladys({
    refuseStates: (states, call) => (call === 0 ? gladysApiError(429) : null),
  });
  const outcomes = await publishStateGroups(gladys, [device(1)]);
  assert.deepEqual(outcomes, [null]);
  assert.deepEqual(gladys.stateBatches, [16, 16]);
  assert.deepEqual(clock.waits, [DEFAULT_RATE_LIMIT_WAIT_MS]);
});

test('a Retry-After the error carries is honoured, capped', async () => {
  const clock = fakeClock();
  const gladys = createFakeGladys({
    refuseStates: (states, call) =>
      call === 0 ? Object.assign(gladysApiError(429), { retryAfter: '7' }) : null,
  });
  await publishStateGroups(gladys, [device(1)]);
  assert.deepEqual(clock.waits, [7000]);
});

test('a 429 that persists fails that request and stops knocking', async () => {
  fakeClock();
  const gladys = createFakeGladys({ refuseStates: () => gladysApiError(429) });
  const groups = Array.from({ length: 8 }, (unused, index) => device(index));
  const outcomes = await publishStateGroups(gladys, groups);
  // First request + its one retry; the second request is not even tried.
  assert.equal(gladys.stateBatches.length, 2);
  assert.ok(outcomes.every((outcome) => isRateLimited(outcome)));
});

test('another refusal is not retried, and is tagged as the host API', async () => {
  fakeClock();
  const gladys = createFakeGladys({
    refuseStates: (states, call) => (call === 0 ? gladysApiError(400, 'bad state') : null),
  });
  const groups = Array.from({ length: 8 }, (unused, index) => device(index));
  const outcomes = await publishStateGroups(gladys, groups);
  assert.equal(gladys.stateBatches.length, 2, 'the second request still goes');
  assert.ok(isHostApiError(outcomes[0]));
  assert.ok(!isRateLimited(outcomes[0]));
  assert.equal(outcomes[7], null);
});

test('a network failure of the host API is tagged too', async () => {
  fakeClock();
  const gladys = createFakeGladys({ refuseStates: () => new TypeError('fetch failed') });
  const [outcome] = await publishStateGroups(gladys, [device(1)]);
  assert.ok(isHostApiError(outcome));
});

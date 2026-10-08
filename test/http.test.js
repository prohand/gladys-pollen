// The one retry every third-party call gets, and how long it waits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_DELAY_MS,
  isRetryableStatus,
  RETRY_AFTER_CAP_MS,
  retryAfterMs,
} from '../src/http.js';

test('only a 429 or a 5xx is worth a second attempt', () => {
  assert.ok(isRetryableStatus(429));
  assert.ok(isRetryableStatus(500));
  assert.ok(isRetryableStatus(503));
  assert.ok(!isRetryableStatus(400));
  assert.ok(!isRetryableStatus(404));
  assert.ok(!isRetryableStatus(200));
});

test('Retry-After in seconds is honoured, under the cap', () => {
  assert.equal(retryAfterMs('2'), 2000);
  assert.equal(retryAfterMs('3600'), RETRY_AFTER_CAP_MS);
});

test('Retry-After as an HTTP date is honoured too', () => {
  const nowMs = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(retryAfterMs('Thu, 08 Oct 2026 12:00:03 GMT', { nowMs }), 3000);
});

test('an absent, garbled or past Retry-After falls back on the default', () => {
  const nowMs = Date.parse('2026-10-08T12:00:00Z');
  assert.equal(retryAfterMs(null), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryAfterMs('soon'), DEFAULT_RETRY_DELAY_MS);
  assert.equal(retryAfterMs('Thu, 08 Oct 2026 11:00:00 GMT', { nowMs }), DEFAULT_RETRY_DELAY_MS);
});

test('the default and the cap can be chosen by the caller', () => {
  assert.equal(retryAfterMs(undefined, { defaultMs: 20_000 }), 20_000);
  assert.equal(retryAfterMs('120', { capMs: 60_000 }), 60_000);
});

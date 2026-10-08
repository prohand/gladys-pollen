// -----------------------------------------------------------------------------
// The one way this integration calls a THIRD-PARTY HTTP API.
//
// Both the pollen forecast and the geocoder are free, public, key-free
// Open-Meteo services. They answer 429 when too many people share an IP (a NAT,
// a CGNAT box), and a 502/503 when one of their nodes restarts — both gone a
// second later. Without a retry, one of those costs a whole refresh cycle (an
// hour of "no recent value") or makes the "Add a location" button answer an
// error the user then clicks again by hand.
//
// So every call is retried ONCE, and only once:
//   - on 429 and 5xx, honouring `Retry-After` but CAPPED short — the callers
//     run under deadlines of their own (a widget pull must answer in 15 s, an
//     action button too), and a server asking for a minute is better answered
//     by the next cycle than by a frozen card;
//   - on a network error (DNS, reset, refused).
// NOT on a timeout: a server that did not answer in 10 s is not going to answer
// in the next 10, and waiting twice would overrun those same deadlines.
//
// The wait goes through an injectable `sleep`, so the tests exercise the retry
// without ever waiting for it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'http' });

/** The longest `Retry-After` honoured before the one retry, in ms. */
export const RETRY_AFTER_CAP_MS = 5000;

/** The wait before the retry when the server names none, in ms. */
export const DEFAULT_RETRY_DELAY_MS = 1000;

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let sleep = realSleep;

/** Replace the wait between the two attempts (the tests only). */
export function setHttpSleep(fn) {
  sleep = fn;
}

/** Put the real wait back (the tests only). */
export function resetHttpSleep() {
  sleep = realSleep;
}

/** Whether an HTTP status is worth one more attempt. */
export function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * How long a `Retry-After` header asks to wait, in ms, capped.
 *
 * The header is either a number of seconds or an HTTP date; anything else —
 * absent, garbage, in the past — falls back on the default delay.
 * @param {string|number|null|undefined} header
 * @param {object} [options]
 * @param {number} [options.nowMs]
 * @param {number} [options.defaultMs] the wait when the header says nothing usable
 * @param {number} [options.capMs] the longest wait honoured
 * @returns {number}
 */
export function retryAfterMs(
  header,
  { nowMs = Date.now(), defaultMs = DEFAULT_RETRY_DELAY_MS, capMs = RETRY_AFTER_CAP_MS } = {},
) {
  const value = String(header ?? '').trim();
  if (value === '') {
    return defaultMs;
  }
  let ms;
  if (/^\d+(\.\d+)?$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const at = Date.parse(value);
    ms = Number.isFinite(at) ? at - nowMs : Number.NaN;
  }
  if (!Number.isFinite(ms) || ms < 0) {
    return defaultMs;
  }
  return Math.min(ms, capMs);
}

/** A timeout is the one network failure NOT retried (see the header). */
function isTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

/**
 * `fetch`, with its own timeout per attempt and ONE retry on a transient
 * failure.
 *
 * Resolves with the last `Response` — the caller still checks `ok`, so the
 * error a user reads is the one the caller words. Rejects only when the
 * network itself failed twice, or timed out.
 * @param {string} url
 * @param {object} options
 * @param {number} options.timeoutMs the timeout of EACH attempt
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.label] names the service in the log line of a retry
 * @returns {Promise<Response>}
 */
export async function fetchWithRetry(url, { timeoutMs, headers, label = 'HTTP' }) {
  const attempt = () =>
    fetch(url, {
      ...(headers ? { headers } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });

  let response;
  try {
    response = await attempt();
  } catch (err) {
    if (isTimeout(err)) {
      throw err;
    }
    logger.warn(`${label}: network error (${err?.message ?? err}), retrying once`);
    await sleep(DEFAULT_RETRY_DELAY_MS);
    return attempt();
  }

  if (!isRetryableStatus(response.status)) {
    return response;
  }
  const delay = retryAfterMs(response.headers?.get?.('retry-after'));
  logger.warn(`${label}: HTTP ${response.status}, retrying once in ${delay} ms`);
  await sleep(delay);
  return attempt();
}

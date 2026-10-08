// -----------------------------------------------------------------------------
// Publishing states without tripping the host API rate limit.
//
// The host API admits 300 states a minute per integration, and 100 per request.
// One location publishes up to 16 states (six taxa and their wording, the
// overall trio, the date), so the 20 locations an install may hold are 320
// states — over the limit in a single cycle, and a cycle is not the only thing
// that publishes: a widget button, a scene action, a device the user just
// created all refresh on demand. Past the limit the core answers 429 and the
// states of that request are LOST: the device sits on its previous value until
// the next cycle, an hour later.
//
// So every state goes through here:
//   - batched by `publishStates`, at most 100 per request, a location's states
//     never split across two requests (a half-published device is a device
//     whose wording contradicts its index);
//   - PACED on a sliding minute, with a margin under the core's 300 so the two
//     windows never disagree at their edge — a long list simply takes two
//     minutes instead of losing its tail;
//   - one retry on a 429, after `Retry-After` (capped). The SDK does not hand
//     the headers over (0.14.0), so the default wait applies unless the error
//     carries one.
// A failure is TAGGED as a host-API one, so the connection status blames
// Gladys and not the pollen provider — the two call for different fixes.
//
// Every publication of the integration shares ONE queue per SDK instance, so
// two callers cannot both pass the budget check and overrun it together.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { retryAfterMs } from './http.js';

const logger = createLogger({ name: 'state-publisher' });

/** The core refuses a request holding more (SDK `publishStates` too). */
export const MAX_STATES_PER_REQUEST = 100;

/** The core's limit, per integration and per minute. */
export const HOST_STATES_PER_MINUTE = 300;

/** What this integration allows itself per minute: a margin under the limit. */
export const STATE_BUDGET_PER_MINUTE = 240;

const WINDOW_MS = 60_000;

/** The wait before the one retry of a 429 that names no `Retry-After`. */
export const DEFAULT_RATE_LIMIT_WAIT_MS = 20_000;

/** The longest wait honoured before that retry. */
export const RATE_LIMIT_WAIT_CAP_MS = 60_000;

const realClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};
let clock = realClock;

// Per SDK instance: the batches sent in the last minute, and the queue.
let publishers = new WeakMap();

/** Replace the clock the pacing waits on (the tests only). */
export function setStatePublisherClock({ sleep = realClock.sleep, now = realClock.now } = {}) {
  clock = { sleep, now };
}

/** Real clock back, every budget forgotten (the tests only). */
export function resetStatePublisher() {
  clock = realClock;
  publishers = new WeakMap();
}

function publisherOf(gladys) {
  let publisher = publishers.get(gladys);
  if (!publisher) {
    publisher = { sent: [], queue: Promise.resolve() };
    publishers.set(gladys, publisher);
  }
  return publisher;
}

/** The HTTP status of a host-API error, whatever shape carries it. */
function statusOf(err) {
  return Number(err?.status ?? err?.statusCode ?? err?.response?.status) || null;
}

/**
 * Whether an error came from the Gladys host API rather than from a provider.
 * @param {unknown} err
 */
export function isHostApiError(err) {
  return err?.hostApi === true || err?.name === 'GladysApiError';
}

/** Whether an error is the host API saying "too many states". */
export function isRateLimited(err) {
  return isHostApiError(err) && statusOf(err) === 429;
}

function tagHostApi(err) {
  const tagged = err instanceof Error ? err : new Error(String(err));
  tagged.hostApi = true;
  return tagged;
}

/**
 * Pack groups of states into requests of at most `max`, never splitting a
 * group unless it is larger than a request on its own.
 * @param {Array<Array<object>>} groups
 * @param {number} [max]
 * @returns {Array<{ states: object[], groups: number[] }>} each request and the
 *   indexes of the groups it carries
 */
export function packBatches(groups, max = MAX_STATES_PER_REQUEST) {
  const batches = [];
  let current = null;
  groups.forEach((group, index) => {
    if (group.length === 0) {
      return;
    }
    if (group.length > max) {
      // Cannot happen with 16 states a location, but a request the SDK refuses
      // outright would be worse than a split.
      for (let start = 0; start < group.length; start += max) {
        batches.push({ states: group.slice(start, start + max), groups: [index] });
      }
      current = null;
      return;
    }
    if (!current || current.states.length + group.length > max) {
      current = { states: [], groups: [] };
      batches.push(current);
    }
    current.states.push(...group);
    current.groups.push(index);
  });
  return batches;
}

/** Wait until `count` more states fit in the budget of the sliding minute. */
async function waitForBudget(publisher, count) {
  for (;;) {
    const at = clock.now();
    publisher.sent = publisher.sent.filter((entry) => at - entry.at < WINDOW_MS);
    const used = publisher.sent.reduce((total, entry) => total + entry.count, 0);
    if (used + count <= STATE_BUDGET_PER_MINUTE || publisher.sent.length === 0) {
      return;
    }
    const wait = Math.max(publisher.sent[0].at + WINDOW_MS - at, 1);
    logger.info(
      `${used} states published in the last minute: waiting ${Math.ceil(wait / 1000)} s ` +
        'to stay under the Gladys rate limit',
    );
    await clock.sleep(wait);
  }
}

/** One request, retried once after a 429. */
async function send(gladys, publisher, states) {
  await waitForBudget(publisher, states.length);
  try {
    await gladys.publishStates(states);
  } catch (err) {
    if (statusOf(err) !== 429) {
      throw tagHostApi(err);
    }
    const wait = retryAfterMs(err?.retryAfter ?? err?.headers?.get?.('retry-after'), {
      nowMs: clock.now(),
      defaultMs: DEFAULT_RATE_LIMIT_WAIT_MS,
      capMs: RATE_LIMIT_WAIT_CAP_MS,
    });
    logger.warn(`Gladys answered 429 to ${states.length} states: retrying once in ${wait} ms`);
    await clock.sleep(wait);
    try {
      await gladys.publishStates(states);
    } catch (retryErr) {
      throw tagHostApi(retryErr);
    }
  }
  publisher.sent.push({ at: clock.now(), count: states.length });
}

/**
 * Publish several groups of states — one group per device — batched, paced
 * and retried once on a 429.
 *
 * Never rejects: each group gets its own outcome, `null` when published, the
 * (host-API tagged) error otherwise. After a 429 that survived its retry the
 * groups not sent yet fail with it rather than knocking again: the next cycle
 * is the better time.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {Array<Array<object>>} groups
 * @returns {Promise<Array<Error|null>>} in the order of `groups`
 */
export function publishStateGroups(gladys, groups) {
  const publisher = publisherOf(gladys);
  const run = async () => {
    const outcomes = groups.map(() => null);
    let stopped = null;
    for (const batch of packBatches(groups)) {
      if (!stopped) {
        try {
          await send(gladys, publisher, batch.states);
          continue;
        } catch (err) {
          if (isRateLimited(err)) {
            stopped = err;
          }
          for (const index of batch.groups) {
            outcomes[index] = err;
          }
          continue;
        }
      }
      for (const index of batch.groups) {
        outcomes[index] = stopped;
      }
    }
    return outcomes;
  };
  const result = publisher.queue.then(run, run);
  publisher.queue = result.catch(() => {});
  return result;
}

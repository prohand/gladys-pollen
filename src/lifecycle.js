// -----------------------------------------------------------------------------
// What happens on every `connected`: read the configuration, arm the refresh,
// publish the devices — in THAT order, and what a failure of one step costs.
//
// Out of index.js so the order can be tested: index.js connects at import time
// and cannot be loaded by a test. Everything it touches is injected.
//
// THE ORDER IS THE POINT. The refresh timer is armed as soon as the
// configuration is known, BEFORE anything is published to Gladys. A transient
// 429 or 5xx of the host API on the discovery publication used to jump straight
// to the catch, and nothing at all ran until the next WebSocket reconnection —
// hours later, perhaps: the devices already created froze on their last value.
// Now they keep refreshing, and a TRANSIENT failure (rate limit, server error,
// network) schedules another initialization a minute later. A refused payload
// (another 4xx) would be refused again: it stays on screen instead.
//
// The reason of a failure stays on the Supervision screen until an
// initialization succeeds: a refresh cycle that went well reports through
// `reportStatus`, which does not say "connected" over it.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'lifecycle' });

/** How long a failed initialization waits before it tries again. */
export const INIT_RETRY_MS = 60_000;

/**
 * Whether a failure is worth trying again by itself: a rate limit, a server
 * error, or no HTTP status at all (the network).
 * @param {unknown} err
 */
export function isTransient(err) {
  const status = Number(err?.status);
  return !Number.isFinite(status) || status === 0 || status === 429 || status >= 500;
}

/**
 * @param {object} deps
 * @param {{ setConnectionStatus: Function }} deps.gladys
 * @param {() => Promise<void>} deps.loadConfig read (and migrate) the stored
 *   configuration into memory
 * @param {() => boolean} deps.isReady whether the configuration in memory has
 *   anything to refresh
 * @param {() => void} deps.startPolling
 * @param {() => void} deps.stopPolling
 * @param {() => Promise<unknown>} deps.publishDevices
 * @param {number} [deps.retryMs]
 * @param {typeof setTimeout} [deps.setTimer] injected in tests
 * @param {typeof clearTimeout} [deps.clearTimer] injected in tests
 */
export function createLifecycle({
  gladys,
  loadConfig,
  isReady,
  startPolling,
  stopPolling,
  publishDevices,
  retryMs = INIT_RETRY_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let problem = null;
  let retry = null;

  function cancelRetry() {
    if (retry !== null) {
      clearTimer(retry);
      retry = null;
    }
  }

  /**
   * The connection status of a refresh cycle — unless an initialization
   * failure is pending, which stays on screen until one succeeds.
   * @param {boolean} connected
   * @param {{ en: string, fr: string }} [message]
   */
  function reportStatus(connected, message) {
    if (connected && problem) {
      return gladys.setConnectionStatus(false, problem).catch(() => {});
    }
    return gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  /** Run one initialization. Never rejects. */
  async function initialize() {
    cancelRetry();
    let failure = null;

    // 1) The configuration. If it cannot be read, the one in memory (from
    // before a reconnection) is the best there is.
    try {
      await loadConfig();
    } catch (err) {
      failure = err;
    }

    // 2) The refresh, before any publication (see the header). Its first
    // cycle reports the status.
    try {
      if (isReady()) {
        startPolling();
      } else {
        stopPolling();
      }
    } catch (err) {
      failure = failure ?? err;
    }

    // 3) The devices.
    if (!failure) {
      try {
        await publishDevices();
      } catch (err) {
        failure = err;
      }
    }

    if (!failure) {
      problem = null;
      return;
    }

    logger.error('Post-connection initialization failed', failure);
    // Carry the real reason into the Supervision screen. A rejected device
    // batch is otherwise invisible: the user just sees an empty Discovery tab
    // with no clue that Gladys refused the payload.
    const reason = String(failure?.message ?? failure).slice(0, 150);
    problem = {
      en: `Initialization failed: ${reason}`,
      fr: `L'initialisation a échoué : ${reason}`,
    };
    await gladys.setConnectionStatus(false, problem).catch(() => {});
    if (isTransient(failure)) {
      logger.info(`Trying the initialization again in ${Math.round(retryMs / 1000)} s`);
      retry = setTimer(() => {
        retry = null;
        initialize();
      }, retryMs);
      retry?.unref?.();
    }
  }

  return {
    initialize,
    reportStatus,
    cancelRetry,
    /** Forget a pending failure: the devices went through since. */
    clearProblem() {
      problem = null;
    },
    /** The failure on screen, or null. */
    get problem() {
      return problem;
    },
  };
}

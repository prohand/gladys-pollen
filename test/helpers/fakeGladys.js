// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface this integration relies on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishStates                 -> record calls so tests can assert them, and
//                                      refuse some (`refuseStates`) like the
//                                      host API does past its rate limit
//   - publishDiscoveredDevices      -> record the last published list
//   - setConfig                     -> record the persisted config keys
//   - getDevices                    -> the devices the user already created
//   - setConnectionStatus           -> record the reported status
//   - publishSceneEvent             -> record the fired scene triggers
//   - requestWidgetRefresh          -> record the widget freshness nudges
// This lets us test the pure "wiring" logic (discovery payloads, state mapping,
// the location actions) without a running Gladys server or a real WebSocket.
//
// Extend it when you use a new SDK method, rather than mocking the SDK itself.
// -----------------------------------------------------------------------------

/**
 * The error the SDK throws for a non-2xx answer of the host API.
 * @param {number} status
 */
export function gladysApiError(status, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), {
    name: 'GladysApiError',
    status,
    code: status === 429 ? 'TOO_MANY_REQUESTS' : 'UNKNOWN_ERROR',
  });
}

/**
 * @param {object} [options]
 * @param {Array<object>} [options.devices] what getDevices answers
 * @param {boolean} [options.refuseSceneEvents]
 * @param {(states: object[], call: number) => Error|null} [options.refuseStates]
 *   the error a publishStates request is refused with, by call number (0-based)
 */
export function createFakeGladys({ devices = [], refuseSceneEvents = false, refuseStates } = {}) {
  const published = [];
  // The size of every publishStates request, accepted or not.
  const stateBatches = [];
  const discovered = [];
  const configs = [];
  const statuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];

  return {
    published,
    stateBatches,
    discovered,
    configs,
    statuses,
    sceneEvents,
    widgetRefreshes,

    externalIds(type, platformId) {
      const device = `${type}:${platformId}`;
      return {
        device,
        feature: (key) => `${device}:${key}`,
      };
    },

    async publishStates(states) {
      if (states.length > 100) {
        // What the SDK itself throws before sending anything.
        throw new Error('publishStates: maximum 100 states per request');
      }
      stateBatches.push(states.length);
      const refusal = refuseStates?.(states, stateBatches.length - 1);
      if (refusal) {
        throw refusal;
      }
      for (const s of states) {
        published.push({
          featureExternalId: s.device_feature_external_id,
          state: s.state,
          text: s.text,
        });
      }
    },

    async publishDiscoveredDevices(list) {
      discovered.push(list);
      return { success: true, count: list.length };
    },

    async setConfig(partialConfig) {
      configs.push(partialConfig);
      return { success: true };
    },

    async getDevices() {
      return devices;
    },

    async setConnectionStatus(connected, message) {
      statuses.push({ connected, message });
      return { success: true };
    },

    async publishSceneEvent(key, data) {
      // The core answers 404 on an undeclared key and 429 past its rate limit;
      // `refuseSceneEvents` is how a test checks that neither takes the refresh
      // cycle down with it.
      if (refuseSceneEvents) {
        throw new Error('scene event refused');
      }
      sceneEvents.push({ key, data });
      return { success: true };
    },

    requestWidgetRefresh(key) {
      widgetRefreshes.push(key);
    },
  };
}

// -----------------------------------------------------------------------------
// Minimal in-memory stand-in for the Gladys SDK object, for unit tests.
//
// It reproduces the only surface this integration relies on:
//   - externalIds(type, platformId) -> { device, feature(key) }
//   - publishStates                 -> record calls so tests can assert them
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

export function createFakeGladys({ devices = [], refuseSceneEvents = false } = {}) {
  const published = [];
  const discovered = [];
  const configs = [];
  const statuses = [];
  const sceneEvents = [];
  const widgetRefreshes = [];

  return {
    published,
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

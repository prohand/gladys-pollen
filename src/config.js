// -----------------------------------------------------------------------------
// Integration configuration.
//
// Two kinds of keys live here:
//   - the ones the user fills in the Configuration form, declared in the
//     `config_schema` of `gladys-assistant-integration.json` (the refresh
//     interval). Their defaults below MUST match the manifest — a unit test
//     enforces it;
//   - `locations`, written by the integration itself through `gladys.setConfig()`
//     when the user clicks "Add a location" / "Remove a location". It is not in
//     the schema because no static form can hold a list built at runtime; see
//     `src/locations.js`.
//
// Keys a former version declared and this one does not — `default_country`, from
// the days when a location was a national postal code — are still handed back by
// `getIntegrationConfig`, which returns every stored variable, schema or not.
// They are read by nobody and simply sit there: an integration cannot delete a
// config key.
// -----------------------------------------------------------------------------

import { normalizeLocations, usableLocations } from './locations.js';

// Re-exported so callers that only read or write a coordinate do not have to
// know which module holds the parsing rules.
export { formatCoordinate, toCoordinate } from './coordinates.js';

/** Defaults, kept consistent with the manifest `config_schema`. */
export const DEFAULT_CONFIG = {
  // The CAMS pollen forecast is refreshed once a day and interpolated hourly:
  // polling faster than that just returns the same numbers.
  poll_frequency: 3600,
};

/** Bounds declared in the manifest for the refresh interval, in seconds. */
export const POLL_FREQUENCY_LIMITS = { min: 900, max: 86400 };

/**
 * Merge the user config with the defaults and force the types: values coming
 * back from a form arrive as strings.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    poll_frequency: clampPollFrequency(raw.poll_frequency),
    // Not a schema field: written by the integration, read back here.
    locations: normalizeLocations(raw.locations),
  };
}

/** Keep the polling interval inside the bounds declared in the manifest. */
function clampPollFrequency(value) {
  const seconds = Number(value ?? DEFAULT_CONFIG.poll_frequency);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  return Math.min(
    Math.max(Math.round(seconds), POLL_FREQUENCY_LIMITS.min),
    POLL_FREQUENCY_LIMITS.max,
  );
}

/**
 * Whether the integration knows where to look at all. Anything less than one
 * usable point means nothing is published and the Supervision screen says why —
 * a device pinned to an empty location is worse than no device.
 * @param {ReturnType<typeof normalizeConfig>} config
 */
export function isConfigured(config) {
  return usableLocations(config.locations).length > 0;
}

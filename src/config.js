// -----------------------------------------------------------------------------
// Integration configuration.
//
// Two kinds of keys live here:
//   - the ones the user fills in the Configuration form, declared in the
//     `config_schema` of `gladys-assistant-integration.json` (poll frequency,
//     default country). Their defaults below MUST match the manifest — a unit
//     test enforces it;
//   - `locations`, written by the integration itself through
//     `gladys.setConfig()` when the user clicks "Add a location" / "Remove a
//     location". It is not in the schema because a list of geocoded towns is
//     not something to type into a form field.
// -----------------------------------------------------------------------------

import { DEFAULT_COUNTRY_CODE } from './countries/index.js';
import { parseLocations } from './locations.js';

/** Defaults, kept consistent with the manifest `config_schema`. */
export const DEFAULT_CONFIG = {
  // The CAMS pollen forecast is refreshed once a day and interpolated hourly:
  // polling faster than that just returns the same numbers.
  poll_frequency: 3600,
  // Pre-selected country of the "Add a location" form.
  default_country: DEFAULT_COUNTRY_CODE,
};

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
    default_country: String(raw.default_country ?? DEFAULT_CONFIG.default_country).toUpperCase(),
    // Not a schema field: written by the integration, read back here.
    locations: parseLocations(raw.locations),
  };
}

/** Keep the polling interval inside the bounds declared in the manifest. */
function clampPollFrequency(value) {
  const seconds = Number(value ?? DEFAULT_CONFIG.poll_frequency);
  if (!Number.isFinite(seconds)) {
    return DEFAULT_CONFIG.poll_frequency;
  }
  return Math.min(Math.max(Math.round(seconds), 900), 86400);
}

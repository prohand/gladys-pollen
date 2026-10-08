// -----------------------------------------------------------------------------
// Device registry.
//
// This integration has a single device TYPE (the pollen station) but a variable
// NUMBER of devices: one per location the user configured. So the registry is
// not a static list of blueprints like in the template — each blueprint is a
// projection of `config.locations`.
//
// Every blueprint exposes the same shape:
//   - key                              : short identifier (used in logs)
//   - deviceExternalIds(gladys, config): every external_id it publishes
//   - buildDevices(gladys, config)     : the discovery payloads sent to Gladys
//   - onPoll(gladys, config, id)        (optional): read of ONE device
//   - startPolling / refresh            (optional): self-driven refresh
//   - actions                           (optional): manifest action handlers,
//     keyed by the action `key` declared in gladys-assistant-integration.json
//
// Consequence for the Discovery tab: `publishDiscoveredDevices()` REPLACES the
// previously published list, so re-publishing after every configuration change
// is what makes an added location appear and a removed one disappear.
// -----------------------------------------------------------------------------

import { pollenStation } from './pollenStation.js';

export const DEVICE_BLUEPRINTS = [pollenStation];

/** Build the discovery payload: every blueprint, for every watched location. */
export function buildDiscoveredDevices(gladys, config) {
  return DEVICE_BLUEPRINTS.flatMap((blueprint) => blueprint.buildDevices(gladys, config));
}

/**
 * Find the blueprint that owns a given device, from its external_id (used to
 * route onPoll to the right device).
 */
export function findBlueprintByDevice(gladys, config, device) {
  return DEVICE_BLUEPRINTS.find((blueprint) =>
    blueprint.deviceExternalIds(gladys, config).includes(device.external_id),
  );
}

/**
 * The external_ids every blueprint publishes for ONE location.
 *
 * Used to answer "has the user already created this location's device?", which
 * decides what the delete action can promise: an integration may stop OFFERING a
 * device, but the host API gives it no way to delete one the user created.
 */
export function locationDeviceIds(gladys, location) {
  return DEVICE_BLUEPRINTS.map((blueprint) => blueprint.locationDeviceId(gladys, location));
}

/** Device params whose VALUE never goes to a log: the point of a location. */
const PRIVATE_PARAMS = new Set(['LATITUDE', 'LONGITUDE']);

/**
 * A discovery payload as it may be LOGGED: everything that tells which feature
 * the core refused, nothing that tells where somebody lives. The params keep
 * their names, so the shape logged is still the shape sent.
 * @param {Array<object>} devices
 */
export function devicesForLog(devices = []) {
  return devices.map((device) => ({
    ...device,
    params: (device.params ?? []).map((param) =>
      PRIVATE_PARAMS.has(param?.name) ? { ...param, value: '<redacted>' } : param,
    ),
  }));
}

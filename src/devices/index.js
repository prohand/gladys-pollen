// -----------------------------------------------------------------------------
// Device registry.
//
// This integration has a single device TYPE (the pollen station) but a variable
// NUMBER of devices: one per location the user configured. So the registry is
// not a static list of blueprints like in the template — it is a projection of
// `config.locations`.
//
// Consequence for the Discovery tab: `publishDiscoveredDevices()` REPLACES the
// previously published list, so re-publishing after every configuration change
// is what makes an added location appear and a removed one disappear.
// -----------------------------------------------------------------------------

import { buildDevice, deviceExternalIds, poll } from './pollenStation.js';

/**
 * Build the discovery payload: one device per configured location.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('../locations.js').Location[], poll_frequency: number }} config
 */
export function buildDiscoveredDevices(gladys, config) {
  return config.locations.map((location) => buildDevice(gladys, location, config));
}

/**
 * Find the location a Gladys device belongs to, from its external_id.
 * Used to route `onPoll` to the right coordinates.
 * @returns {import('../locations.js').Location|undefined}
 */
export function findLocationByDevice(gladys, config, device) {
  return config.locations.find(
    (location) => deviceExternalIds(gladys, location).device === device.external_id,
  );
}

/** Poll one location and publish its states. */
export function pollLocation(gladys, location) {
  return poll(gladys, location);
}

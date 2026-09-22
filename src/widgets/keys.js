// -----------------------------------------------------------------------------
// The widget keys, and the "re-pull me now" nudge.
//
// A module of its own, with no import but the SDK, because the refresh cycle
// has to nudge the widgets and the widgets have to read the devices: anything
// bigger here would close that circle. Keys in, cards out.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'widgets' });

/** Keys declared in the manifest `widgets` field. */
export const WIDGET_KEYS = {
  STATION: 'pollen_station',
  LOCATIONS: 'pollen_locations',
};

/**
 * Tell the core our widget contents are stale.
 *
 * "Trigger, not data": the nudge carries nothing, it only makes every open
 * dashboard re-pull the content through `onWidgetGet` instead of waiting for
 * its `ttl_seconds`. Fire-and-forget, rate-limited core-side to one per ten
 * seconds and per widget, and silently dropped while disconnected — so it is
 * called ONCE per refresh cycle, not once per location.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 */
export function nudgeWidgets(gladys) {
  for (const key of Object.values(WIDGET_KEYS)) {
    try {
      gladys.requestWidgetRefresh?.(key);
    } catch (err) {
      // Nothing here is worth a failed refresh: the content is still served on
      // the next pull, at most one ttl later.
      logger.debug(`Widget refresh nudge failed for "${key}"`, err);
    }
  }
}

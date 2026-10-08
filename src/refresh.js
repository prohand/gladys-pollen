// -----------------------------------------------------------------------------
// The refresh of the pollen stations: the timer, the passes, the publication.
//
// Everything that READS a location and PUBLISHES its states goes through this
// module — the timer, a reconnection, a saved form, a device just created, a
// widget button, a scene action — and nothing else calls
// `gladys.publishStates`. The device schema it publishes is
// src/devices/pollenStation.js, which imports nothing back: the widgets and the
// scene actions read that schema AND ask for refreshes here, and the arrow
// only ever points one way.
//
// It is also what reports the health of the integration: one connection status
// per cycle, naming WHO failed — the pollen provider or the Gladys host API.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import {
  buildStates,
  deviceExternalIds,
  DEVICE_TYPE,
  findLocationByDeviceId,
  taxonName,
  watchedLocations,
} from './devices/pollenStation.js';
import { DEFAULT_LANGUAGE } from './language.js';
import { readPollenRisks } from './pollen/index.js';
import { RISK_LEVEL_LABELS } from './pollen/risk.js';
import { publishRiskEvents } from './scenes/riskEvents.js';
import { isHostApiError, isRateLimited, publishStateGroups } from './statePublisher.js';
import { nudgeWidgets } from './widgets/keys.js';

// Same name as before the split: these lines are the device type's own story,
// and a log filter written for it keeps catching them.
const logger = createLogger({ name: DEVICE_TYPE });

// Floor on the refresh interval, whatever the configuration says. Open-Meteo is
// a free public service and the CAMS forecast is interpolated hourly: hammering
// it buys nothing.
export const MIN_REFRESH_SECONDS = 300;

// -----------------------------------------------------------------------------
// The refresh, SINGLE-FLIGHT.
//
// Six things ask for a refresh, and nothing stops them from asking together:
// the timer, a reconnection, a configuration save, a device the user just
// created, a widget button, a scene action. Each used to run its own pass —
// its own requests to Open-Meteo, its own states to a rate-limited host API,
// and its own scene events, compared against levels another pass was updating
// at the same moment.
//
// Now there is ONE pass at a time per SDK instance. A request whose locations
// the running pass already covers (in the same language) JOINS it and gets its
// outcome; any other request waits for it and is merged into ONE follow-up
// pass, which reads the latest locations asked for. Nothing runs twice in
// parallel, and nothing asked for is dropped.
//
// A pass reads every location in ONE request (`readPollenRisks`), publishes the
// states through the paced publisher (src/statePublisher.js), then fires the
// scene events of what moved — states first, so a scene started by an event
// reads the value the event talks about.
// -----------------------------------------------------------------------------

/** Per SDK instance: the pass running, and the one queued behind it. */
const flights = new WeakMap();

/** Per SDK instance: the last full cycle, `{ key, at, ok }`. */
const lastCycles = new WeakMap();

function flightsOf(gladys) {
  let entry = flights.get(gladys);
  if (!entry) {
    entry = { running: null, queued: null };
    flights.set(gladys, entry);
  }
  return entry;
}

/**
 * One pass over a list of locations. Never rejects: every location gets an
 * outcome, `stage` saying where a failure happened — `read` (the provider) or
 * `publish` (the Gladys host API), which call for different fixes.
 * @returns {Promise<Map<string, { location: object, reading?: object, error?: Error, stage?: 'read'|'publish' }>>}
 */
async function runPass(gladys, locations, language) {
  const outcomes = new Map();
  try {
    logger.info(`Reading the pollen risk of ${locations.length} location(s)...`);
    const reads = await readPollenRisks(locations);

    const groups = [];
    const publishable = [];
    for (const { location, reading, error } of reads) {
      if (error) {
        logger.error(`Pollen read failed for ${location.name}`, error);
        outcomes.set(location.id, { location, error, stage: 'read' });
        continue;
      }
      const ids = deviceExternalIds(gladys, location);
      const states = buildStates(ids, reading, language);
      if (states.length === 0) {
        logger.warn(`No pollen data for ${location.name}, nothing published`);
        outcomes.set(location.id, { location, reading });
        continue;
      }
      // The logs stay English whatever the devices are named: they are read in
      // the container output, next to the SDK's own.
      const overall = RISK_LEVEL_LABELS[reading.overall.level]?.en ?? 'unknown';
      logger.info(
        `${location.name}: overall risk ${reading.overall.level} (${overall})` +
          `${reading.overall.taxon ? `, dominant ${taxonName(reading.overall.taxon, 'en')}` : ''}`,
      );
      groups.push(states);
      publishable.push({ location, reading, ids });
    }

    // Batched (100 a request, a device never split), paced under the host
    // API's 300 a minute, retried once on a 429.
    const published = await publishStateGroups(gladys, groups);

    await Promise.all(
      publishable.map(async ({ location, reading, ids }, index) => {
        const error = published[index];
        if (error) {
          logger.error(`Gladys did not take the states of ${location.name}`, error);
          outcomes.set(location.id, { location, reading, error, stage: 'publish' });
          return;
        }
        outcomes.set(location.id, { location, reading });
        // States first, events after: a scene started by the event reads the
        // features, and it must find the value the event talks about. Nothing
        // is fired unless a level actually MOVED — see src/scenes/riskEvents.js.
        await publishRiskEvents(gladys, {
          location,
          deviceExternalId: ids.device,
          reading,
          language,
        });
      }),
    );
  } catch (err) {
    // Nothing above is expected to throw; if it does, every location not
    // answered yet says so rather than the pass taking a timer down with it.
    logger.error('Pollen refresh pass failed', err);
    for (const location of locations) {
      if (!outcomes.has(location.id)) {
        outcomes.set(location.id, { location, error: err, stage: 'read' });
      }
    }
  }
  return outcomes;
}

/**
 * Refresh some locations, single-flight (see above).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('./locations.js').Location[]} locations
 * @param {string} language language of the published TEXT states
 * @returns {Promise<Map<string, object>>} the outcome of every location of the
 *   pass that served this request — a superset of `locations`
 */
export function refreshOutcomes(gladys, locations, language = DEFAULT_LANGUAGE) {
  const entry = flightsOf(gladys);
  const { running } = entry;

  // 1) The running pass already covers it: join, nothing more to read.
  if (
    running &&
    !entry.queued &&
    running.language === language &&
    locations.every((location) => running.ids.has(location.id))
  ) {
    return running.promise;
  }

  // 2) Something runs: merge into the ONE pass queued behind it.
  if (running || entry.queued) {
    if (!entry.queued) {
      const queued = { byId: new Map(), language };
      queued.promise = running.promise.then(() => {
        entry.queued = null;
        return start(gladys, entry, [...queued.byId.values()], queued.language);
      });
      entry.queued = queued;
    }
    for (const location of locations) {
      entry.queued.byId.set(location.id, location);
    }
    // The most recent request knows the current language best.
    entry.queued.language = language;
    return entry.queued.promise;
  }

  // 3) Nothing runs: start.
  return start(gladys, entry, locations, language);
}

function start(gladys, entry, locations, language) {
  const flight = {
    ids: new Set(locations.map((location) => location.id)),
    language,
  };
  flight.promise = runPass(gladys, locations, language).finally(() => {
    if (entry.running === flight) {
      entry.running = null;
    }
  });
  entry.running = flight;
  return flight.promise;
}

/**
 * Read one location and publish its states.
 * Throws on an unreadable answer or a refused publication — `refresh` is what
 * never throws.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('./locations.js').Location} location
 * @param {string} [language] language of the published TEXT states
 */
export async function poll(gladys, location, language = DEFAULT_LANGUAGE) {
  const outcome = (await refreshOutcomes(gladys, [location], language)).get(location.id);
  if (outcome?.error) {
    throw outcome.error;
  }
  return outcome?.reading;
}

/**
 * Read a list of locations and publish what they answer, counting the failures
 * instead of propagating them.
 *
 * Shared by everything that refreshes ON DEMAND — the scene action, the widget
 * buttons, a device just created — because they all owe their caller a count
 * rather than a stack trace, and one place failing must never cost the others
 * their refresh. The scheduled cycle has its own reporting (see `refresh`).
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {import('./locations.js').Location[]} locations
 * @param {string} [language] language of the published TEXT states
 * @returns {Promise<{ refreshed: number, failed: number }>}
 */
export async function refreshLocations(gladys, locations, language = DEFAULT_LANGUAGE) {
  if (locations.length === 0) {
    return { refreshed: 0, failed: 0 };
  }
  const outcomes = await refreshOutcomes(gladys, locations, language);
  const failed = locations.filter((location) => outcomes.get(location.id)?.error).length;
  return { refreshed: locations.length - failed, failed };
}

/** What identifies a full cycle: the same places, in the same language. */
function cycleKey(locations, language) {
  return `${language}|${locations
    .map((location) => location.id)
    .sort()
    .join(',')}`;
}

/**
 * Why a location could not be refreshed, WITHOUT naming it (the line already
 * does).
 *
 * WHO failed is the first thing the reader needs: a pollen provider that does
 * not answer and a Gladys that refuses the states are two different problems,
 * and blaming Open-Meteo for a rate limit of the host API sends the user
 * looking in the wrong place. Exported for the `test_provider` button
 * (src/providerCheck.js), whose lines must give the same reason in the same
 * words as the connection status.
 * @param {unknown} err
 * @param {'read'|'publish'} [stage]
 */
export function failureDetail(err, stage = 'read') {
  const reason = String(err?.message ?? err).slice(0, 120);
  if (stage === 'publish' || isHostApiError(err)) {
    if (isRateLimited(err)) {
      return {
        en: 'Gladys rate limit reached (HTTP 429), the states will be published at the next refresh',
        fr: 'limite de débit de Gladys atteinte (HTTP 429), les états seront publiés au prochain rafraîchissement',
      };
    }
    return {
      en: `Gladys did not accept the states: ${reason}`,
      fr: `Gladys n'a pas accepté les états : ${reason}`,
    };
  }
  return {
    en: `pollen forecast unavailable: ${reason}`,
    fr: `prévision pollinique indisponible : ${reason}`,
  };
}

/** The same reason, named, for the one-line connection status. */
function failureMessage(err, locationName, stage) {
  const detail = failureDetail(err, stage);
  return {
    en: `${locationName}: ${detail.en}`,
    fr: `${locationName} : ${detail.fr}`,
  };
}

/**
 * Drive the refresh ourselves.
 *
 * Gladys' own polling is not usable here: `poll_frequency` is a fixed enum of
 * intervals in milliseconds whose slowest value is one minute, while the CAMS
 * forecast is interpolated hourly. So the devices declare no poll_frequency
 * and we run our own timer at the configured interval.
 *
 * The first cycle runs straight away — waiting a full hour for the first
 * value would leave a freshly added device empty on the dashboard — UNLESS
 * the last cycle covered the very same places in the same language and is
 * younger than the interval: a reconnection or a saved form then RESUMES the
 * cadence instead of re-reading and re-publishing what is already fresh.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('./locations.js').Location[], language: string, poll_frequency: number }} config
 * @param {object} [options]
 * @param {(connected: boolean, message?: object) => Promise<unknown>} [options.reportStatus]
 *   how a cycle reports its outcome; `gladys.setConnectionStatus` by default
 * @returns {() => void} cleanup, to stop the timer on disconnection
 */
export function startPolling(gladys, config, { reportStatus } = {}) {
  const intervalMs = Math.max(MIN_REFRESH_SECONDS, config.poll_frequency) * 1000;
  const locations = watchedLocations(config);
  const tick = () => refreshCycle(gladys, config, { reportStatus });

  const last = lastCycles.get(gladys);
  const age =
    last?.ok && last.key === cycleKey(locations, config.language)
      ? Date.now() - last.at
      : Number.POSITIVE_INFINITY;
  const firstDelay = age < intervalMs ? intervalMs - age : 0;
  logger.info(
    `Refreshing ${locations.length} location(s) every ${Math.round(intervalMs / 1000)} s` +
      (firstDelay > 0 ? `, next in ${Math.round(firstDelay / 1000)} s (fresh data)` : ''),
  );

  let interval = null;
  let first = null;
  if (firstDelay === 0) {
    tick();
    interval = setInterval(tick, intervalMs);
  } else {
    // Nothing re-read, so nothing re-reported either: say again what the
    // last cycle found, which was a healthy one.
    (reportStatus ?? gladys.setConnectionStatus.bind(gladys))(true)?.catch?.(() => {});
    first = setTimeout(() => {
      tick();
      interval = setInterval(tick, intervalMs);
    }, firstDelay);
  }
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

/**
 * One refresh cycle over every location, which NEVER throws: a rejection
 * inside a timer callback would become an unhandled rejection and take the
 * container down. Outages are reported through `setConnectionStatus` instead,
 * and the next cycle simply tries again.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('./locations.js').Location[], language: string }} config
 * @param {object} [options]
 * @param {(connected: boolean, message?: object) => Promise<unknown>} [options.reportStatus]
 */
export async function refreshCycle(gladys, config, { reportStatus } = {}) {
  const report = reportStatus ?? ((...args) => gladys.setConnectionStatus(...args).catch(() => {}));
  try {
    const locations = watchedLocations(config);
    if (locations.length === 0) {
      // Nothing to read, and nothing to report either: the status already
      // says "add a location", and a healthy one would hide it.
      return;
    }
    const outcomes = await refreshOutcomes(gladys, locations, config.language);
    const failures = locations
      .map((location) => outcomes.get(location.id))
      .filter((outcome) => outcome?.error)
      .map((outcome) => failureMessage(outcome.error, outcome.location.name, outcome.stage));
    lastCycles.set(gladys, {
      key: cycleKey(locations, config.language),
      at: Date.now(),
      ok: failures.length === 0,
    });

    // The device-bound tiles of the widgets follow the published states on
    // their own; their status rows and their forecast curve do not, so one
    // nudge per cycle tells the open dashboards to re-pull them.
    nudgeWidgets(gladys);

    if (failures.length === 0) {
      await report(true);
      return;
    }
    // Only the first reason is spelled out: the status line is one line, and
    // two stack traces in it help nobody.
    const [firstFailure] = failures;
    const others =
      failures.length > 1
        ? {
            en: ` (+${failures.length - 1} other location(s) failing)`,
            fr: ` (+${failures.length - 1} autre(s) lieu(x) en échec)`,
          }
        : { en: '', fr: '' };
    await report(false, {
      en: `${firstFailure.en}${others.en}`,
      fr: `${firstFailure.fr}${others.fr}`,
    });
  } catch (err) {
    logger.error('Refresh cycle failed', err);
  }
}

/**
 * Refresh ONE device, on a poll request Gladys sends for it. The devices
 * declare no poll_frequency, so this normally never fires; it stays because a
 * device created by an older version may still carry one.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('./locations.js').Location[], language: string }} config
 * @param {string} externalId external_id of the device to refresh
 */
export async function pollDevice(gladys, config, externalId) {
  const location = findLocationByDeviceId(gladys, config, externalId);
  if (!location) {
    throw new Error(`No location watches the device ${externalId}`);
  }
  await poll(gladys, location, config.language);
}

/**
 * The user just created a device from the Discovery screen: until that
 * moment the core SILENTLY DROPS every state published for it, so it would
 * sit on "no recent value" until the next cycle. Refresh THAT location only —
 * the others already hold their values — and say nothing about a device that
 * is not ours.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {{ locations: import('./locations.js').Location[], language: string }} config
 * @param {string} externalId external_id of the created device
 * @returns {Promise<boolean>} whether a location was refreshed
 */
export async function refreshCreatedDevice(gladys, config, externalId) {
  const location = findLocationByDeviceId(gladys, config, externalId);
  if (!location) {
    return false;
  }
  await refreshLocations(gladys, [location], config.language);
  return true;
}

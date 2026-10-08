// -----------------------------------------------------------------------------
// Pollen provider: Open-Meteo Air Quality API.
//
// Why this source rather than Atmo France:
//   - Atmo France exposes the French pollen risk, but its API requires an
//     account and an authentication token, which every user would have to
//     create and paste before the integration works at all;
//   - Open-Meteo republishes the CAMS European air quality forecast (Copernicus
//     Atmosphere Monitoring Service, the EU reference model, ~11 km grid) as
//     open data, with NO account and NO API key.
//
// So the data is official (Copernicus/ECMWF) and the setup is empty. Coverage
// is the CAMS European domain, which is why `supports()` filters on it: a
// future provider covering another region can be registered next to this one
// without touching the device code.
//
// Node 20+ provides `fetch` natively: no dependency needed.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { withUtcOffset } from '../dateTime.js';
import { fetchWithRetry } from '../http.js';

const logger = createLogger({ name: 'open-meteo' });

const BASE_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The six allergenic taxa forecast by the CAMS European ensemble. The keys are
 * the ones used everywhere in this integration; the values are the Open-Meteo
 * variable names.
 */
export const OPEN_METEO_VARIABLES = {
  alder: 'alder_pollen',
  birch: 'birch_pollen',
  grass: 'grass_pollen',
  mugwort: 'mugwort_pollen',
  olive: 'olive_pollen',
  ragweed: 'ragweed_pollen',
};

/** Taxa exposed by this provider, in a stable order (feature order in Gladys). */
export const POLLEN_TAXA = Object.keys(OPEN_METEO_VARIABLES);

// Bounding box of the CAMS European domain. Outside of it the API answers with
// nulls for every pollen variable, so it is better to say "unsupported" up
// front than to publish a device that will never hold a value.
const CAMS_EUROPE_BBOX = { minLat: 30, maxLat: 72, minLon: -25, maxLon: 45 };

// ONE request answers everything this integration asks about a point: the
// `hourly` block of today and tomorrow. The current hour is one of its rows, so
// the reading of the devices and the curve of the widget come from the same
// answer — a station card used to cost two requests, a `current` and an
// `hourly` one, for the same point.
//
// Today and tomorrow, hour by hour: the two days a pollen bulletin talks about,
// and 48 points — well under the 300 the chart component accepts per series.
const FORECAST_DAYS = 2;

// The CAMS forecast is published once a day and interpolated hourly, and what
// is cached is the whole two-day curve: the CURRENT hour is picked from it at
// read time, so a cached answer still moves to the right hour. The TTL is
// therefore not what keeps the reading accurate — it is what keeps the public
// API quiet — and it is deliberately LONGER than the widget ttl (900 s, see
// src/widgets/content.js): a card re-pulled on expiry finds the answer the
// refresh cycle or the previous pull already read, instead of costing a request
// per place every quarter of an hour.
export const CACHE_TTL_MS = 30 * 60 * 1000;

// Points per request. Open-Meteo takes a comma-separated list of coordinates
// and answers an array; MAX_LOCATIONS (20) fits in one request, the chunking is
// what keeps a longer list from building an URL nobody should send.
export const MAX_POINTS_PER_REQUEST = 25;

/** Parsed answers per point: `{ at, value: { hours, offset } }`. */
const cache = new Map();

/** Requests in flight per point, shared by every concurrent reader. */
const inFlight = new Map();

let now = () => Date.now();

/** Pin the clock the current hour is picked with (the tests only). */
export function setPollenClock(fn) {
  now = fn;
}

/** Cache key of a point: a location and a widget on the same point share it. */
function pointKey({ latitude, longitude }) {
  return `${latitude},${longitude}`;
}

/** A concentration, or null for "no data" — never a zero standing in for it. */
function toConcentration(raw) {
  return raw === null || raw === undefined ? null : Number(raw);
}

/**
 * One point of an answer, parsed: the hours as complete instants.
 *
 * The hours come back on the local clock of the point (`timezone=auto`) and the
 * offset in a field of its own; they are glued together HERE, at the provider
 * boundary, so nothing downstream reads an hour in the container's timezone.
 */
function parsePoint(body) {
  const hourly = body?.hourly ?? {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const hours = times.map((time, index) => {
    const concentrations = {};
    for (const [taxon, variable] of Object.entries(OPEN_METEO_VARIABLES)) {
      concentrations[taxon] = toConcentration(
        Array.isArray(hourly[variable]) ? hourly[variable][index] : null,
      );
    }
    return { t: withUtcOffset(time, body?.utc_offset_seconds), concentrations };
  });
  return { hours };
}

/**
 * The row of the curve that is valid NOW: the last hour that has started.
 *
 * What the `current` block of the API would have answered — its interval is
 * one hour for the CAMS variables — but read off the curve we already hold.
 * Before the first row (a clock behind the server's) the first one is the
 * closest there is.
 * @param {Array<{ t: string|null, concentrations: object }>} hours
 * @returns {{ concentrations: Record<string, number|null>, measuredAt: string|null }}
 */
export function currentHour(hours, nowMs = now()) {
  let picked = null;
  for (const hour of hours) {
    const at = Date.parse(hour.t ?? '');
    if (picked === null || (Number.isFinite(at) && at <= nowMs)) {
      picked = hour;
    }
  }
  if (!picked) {
    // An answer with no hour at all: no value, and no date to pin on nothing.
    return {
      concentrations: Object.fromEntries(POLLEN_TAXA.map((taxon) => [taxon, null])),
      measuredAt: null,
    };
  }
  return { concentrations: { ...picked.concentrations }, measuredAt: picked.t };
}

/** Request a list of uncached points in one go, and cache what comes back. */
async function requestPoints(points) {
  const list = (key) => points.map((point) => encodeURIComponent(point[key])).join(',');
  const url =
    `${BASE_URL}?latitude=${list('latitude')}` +
    `&longitude=${list('longitude')}` +
    `&hourly=${Object.values(OPEN_METEO_VARIABLES).join(',')}` +
    `&forecast_days=${FORECAST_DAYS}` +
    `&timezone=auto`;

  // The URL carries the coordinates of the user's places — their home, often.
  // A count is all a log needs.
  logger.debug(`Open-Meteo request for ${points.length} point(s)`);

  const response = await fetchWithRetry(url, {
    timeoutMs: REQUEST_TIMEOUT_MS,
    label: 'Open-Meteo',
  });
  if (!response.ok) {
    // Propagate: the caller decides whether to keep the previous values or to
    // report the integration as disconnected.
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }

  const body = await response.json();
  if (body?.error) {
    throw new Error(`Open-Meteo error: ${body.reason ?? 'unknown reason'}`);
  }

  // One point is answered with an object, several with an array in the order
  // of the request.
  const answers = Array.isArray(body) ? body : [body];
  if (answers.length !== points.length) {
    throw new Error(
      `Open-Meteo answered ${answers.length} point(s) for ${points.length} requested`,
    );
  }
  const at = now();
  return answers.map((answer, index) => {
    const value = parsePoint(answer);
    cache.set(pointKey(points[index]), { at, value });
    return value;
  });
}

/**
 * The parsed answer of every point, one promise each, in order.
 *
 * A point is served from the cache, else from a request already in flight for
 * it (two widgets and a refresh cycle pulling side by side cost ONE request),
 * else from ONE request shared by all the remaining points of this call.
 * @param {Array<{ latitude: number, longitude: number }>} points
 * @returns {Array<Promise<{ hours: Array<object> }>>}
 */
function loadPoints(points) {
  const results = new Array(points.length);
  const missing = new Map();

  points.forEach((point, index) => {
    const key = pointKey(point);
    const cached = cache.get(key);
    if (cached && now() - cached.at < CACHE_TTL_MS) {
      results[index] = Promise.resolve(cached.value);
    } else if (inFlight.has(key)) {
      results[index] = inFlight.get(key);
    } else if (!missing.has(key)) {
      missing.set(key, { point, indexes: [index] });
    } else {
      missing.get(key).indexes.push(index);
    }
  });

  const pending = [...missing.entries()];
  for (let start = 0; start < pending.length; start += MAX_POINTS_PER_REQUEST) {
    const chunk = pending.slice(start, start + MAX_POINTS_PER_REQUEST);
    const request = requestPoints(chunk.map(([, entry]) => entry.point));
    chunk.forEach(([key, entry], position) => {
      const promise = request.then((values) => values[position]);
      // A failure is the caller's to handle; the shared copy must not be an
      // unhandled rejection when every reader has already given up on it.
      promise.catch(() => {});
      inFlight.set(key, promise);
      promise
        .finally(() => {
          if (inFlight.get(key) === promise) {
            inFlight.delete(key);
          }
        })
        .catch(() => {});
      for (const index of entry.indexes) {
        results[index] = promise;
      }
    });
  }
  return results;
}

export const openMeteoProvider = {
  key: 'open-meteo-cams',

  name: {
    en: 'Open-Meteo (CAMS Europe, Copernicus)',
    fr: 'Open-Meteo (CAMS Europe, Copernicus)',
  },

  /** Taxa this provider can report. */
  taxa: POLLEN_TAXA,

  /**
   * Whether this provider has data for a location.
   * @param {{ latitude: number, longitude: number }} location
   */
  supports({ latitude, longitude }) {
    return (
      latitude >= CAMS_EUROPE_BBOX.minLat &&
      latitude <= CAMS_EUROPE_BBOX.maxLat &&
      longitude >= CAMS_EUROPE_BBOX.minLon &&
      longitude <= CAMS_EUROPE_BBOX.maxLon
    );
  },

  /**
   * Read the current pollen concentrations of a position.
   * @param {{ latitude: number, longitude: number }} location
   * @returns {Promise<{ concentrations: Record<string, number|null>, measuredAt: string|null }>}
   *   concentrations in grains/m³, keyed by taxon; a taxon with no value is
   *   null (the caller turns that into "no state published"). `measuredAt` is
   *   the hour those concentrations are valid at, as a complete ISO 8601
   *   instant in the LOCAL time of the position (see src/dateTime.js). It is
   *   NOT the moment of the request: the CAMS forecast is published once a day
   *   and interpolated hourly, so this is what "up to date at..." means.
   */
  async fetchPollen(location) {
    const [answer] = loadPoints([location]);
    return currentHour((await answer).hours);
  },

  /**
   * Read the current concentrations of SEVERAL positions, in one request.
   *
   * Optional batch capability: `readPollenRisks` uses it when a provider has
   * it, and calls `fetchPollen` per location otherwise. One settled result per
   * location, in order, so one point failing never hides the others.
   * @param {Array<{ latitude: number, longitude: number }>} locations
   * @returns {Promise<PromiseSettledResult<{ concentrations: object, measuredAt: string|null }>[]>}
   */
  async fetchPollenMany(locations) {
    return Promise.allSettled(
      loadPoints(locations).map(async (answer) => currentHour((await answer).hours)),
    );
  },

  /**
   * Read the hour-by-hour concentrations of today and tomorrow.
   *
   * This is what a `chart` widget component is for: a forecast is data Gladys
   * keeps no history of — it has not happened yet — so it travels as inline
   * series rather than as the history of a device feature. It is the very
   * answer `fetchPollen` reads its hour from, so a card asking for both costs
   * one request.
   *
   * Optional capability: a provider without it simply publishes no curve (see
   * `readPollenForecast`), so a future national source can be registered
   * without implementing this.
   * @param {{ latitude: number, longitude: number }} location
   * @returns {Promise<{ hours: Array<{ t: string, concentrations: Record<string, number|null> }> }>}
   *   `t` is a complete ISO 8601 instant, as `fetchPollen` dates its answer.
   */
  async fetchForecast(location) {
    const [answer] = loadPoints([location]);
    const { hours } = await answer;
    return {
      hours: hours.map((hour) => ({ ...hour, concentrations: { ...hour.concentrations } })),
    };
  },
};

/** Drop the cached responses and put the real clock back (used by the tests). */
export function clearPollenCache() {
  cache.clear();
  inFlight.clear();
  now = () => Date.now();
}

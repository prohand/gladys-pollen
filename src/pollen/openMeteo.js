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

const logger = createLogger({ name: 'open-meteo' });

const BASE_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

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

// The CAMS forecast is refreshed once a day and interpolated hourly: polling
// the same coordinates more often than this returns the same numbers. The cache
// keeps the public API quiet when several devices share a position and when the
// user hammers the "Test" button.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

// The hourly forecast is a SECOND request, kept apart from the hourly `current`
// one on purpose: the refresh cycle of every device only needs the current
// hour, and it runs whether or not a dashboard widget is open. Only the widgets
// ask for the curve, and they have their own cache entry for it.
const forecastCache = new Map();

// Today and tomorrow, hour by hour: the two days a pollen bulletin talks about,
// and 48 points — well under the 300 the chart component accepts per series.
const FORECAST_DAYS = 2;

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
   *   instant in the LOCAL time of the position (see src/dateTime.js).
   */
  async fetchPollen({ latitude, longitude }) {
    const cacheKey = `${latitude},${longitude}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      logger.debug(`Cache hit for ${cacheKey}`);
      return cached.value;
    }

    const url =
      `${BASE_URL}?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` +
      `&current=${Object.values(OPEN_METEO_VARIABLES).join(',')}` +
      `&timezone=auto`;

    logger.debug('Open-Meteo request ->', url);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      // Propagate: the caller decides whether to keep the previous values or to
      // report the integration as disconnected.
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
      throw new Error(`Open-Meteo error: ${body.reason ?? 'unknown reason'}`);
    }

    const current = body.current ?? {};
    const concentrations = {};
    for (const [taxon, variable] of Object.entries(OPEN_METEO_VARIABLES)) {
      const raw = current[variable];
      concentrations[taxon] = raw === null || raw === undefined ? null : Number(raw);
    }

    // The hour the model gives those values for. It is NOT the moment of this
    // request: the CAMS forecast is published once a day and interpolated
    // hourly, so this is what "the data is up to date at..." actually means.
    // `timezone=auto` makes it the local clock of the position, and the offset
    // that pins it down comes back in a field of its own.
    const value = {
      concentrations,
      measuredAt: withUtcOffset(current.time, body.utc_offset_seconds),
    };
    cache.set(cacheKey, { at: Date.now(), value });
    return value;
  },

  /**
   * Read the hour-by-hour concentrations of today and tomorrow.
   *
   * This is what a `chart` widget component is for: a forecast is data Gladys
   * keeps no history of — it has not happened yet — so it travels as inline
   * series rather than as the history of a device feature.
   *
   * Optional capability: a provider without it simply publishes no curve (see
   * `readPollenForecast`), so a future national source can be registered
   * without implementing this.
   * @param {{ latitude: number, longitude: number }} location
   * @returns {Promise<{ hours: Array<{ t: string, concentrations: Record<string, number|null> }> }>}
   *   `t` is a complete ISO 8601 instant, as `fetchPollen` dates its answer.
   */
  async fetchForecast({ latitude, longitude }) {
    const cacheKey = `${latitude},${longitude}`;
    const cached = forecastCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      logger.debug(`Forecast cache hit for ${cacheKey}`);
      return cached.value;
    }

    const url =
      `${BASE_URL}?latitude=${encodeURIComponent(latitude)}` +
      `&longitude=${encodeURIComponent(longitude)}` +
      `&hourly=${Object.values(OPEN_METEO_VARIABLES).join(',')}` +
      `&forecast_days=${FORECAST_DAYS}` +
      `&timezone=auto`;

    logger.debug('Open-Meteo forecast request ->', url);

    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      throw new Error(`Open-Meteo HTTP ${response.status}`);
    }

    const body = await response.json();
    if (body.error) {
      throw new Error(`Open-Meteo error: ${body.reason ?? 'unknown reason'}`);
    }

    const hourly = body.hourly ?? {};
    const times = Array.isArray(hourly.time) ? hourly.time : [];
    const hours = times.map((time, index) => {
      const concentrations = {};
      for (const [taxon, variable] of Object.entries(OPEN_METEO_VARIABLES)) {
        const raw = Array.isArray(hourly[variable]) ? hourly[variable][index] : null;
        concentrations[taxon] = raw === null || raw === undefined ? null : Number(raw);
      }
      // Same rule as the current reading: the hours come back on the local
      // clock of the point and the offset in a field of its own, so they are
      // glued together here rather than anywhere downstream.
      return { t: withUtcOffset(time, body.utc_offset_seconds), concentrations };
    });

    const value = { hours };
    forecastCache.set(cacheKey, { at: Date.now(), value });
    return value;
  },
};

/** Drop the cached responses (used by the tests). */
export function clearPollenCache() {
  cache.clear();
  forecastCache.clear();
}

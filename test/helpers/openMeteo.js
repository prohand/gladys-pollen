// -----------------------------------------------------------------------------
// Open-Meteo answers, as the provider asks for them, for the stubbed `fetch`.
//
// The provider asks for the `hourly` block only — the current hour is one of
// its rows — and asks for every point of a cycle in ONE request: Open-Meteo
// then answers an ARRAY, one entry per point, where a single point gets a bare
// object. `stubOpenMeteo` reproduces that, so a test stubbing "the" answer of a
// place works whether the code asked for one point or ten.
// -----------------------------------------------------------------------------

import { OPEN_METEO_VARIABLES } from '../../src/pollen/openMeteo.js';

/**
 * An answer holding ONE hour of concentrations — what the old `current` block
 * said, in the shape the provider reads now.
 * @param {Record<string, number|null>} values keyed by taxon (`birch`, ...)
 * @param {{ time?: string|null, offset?: number|null }} [options]
 */
export function hourAnswer(values = {}, { time = '2026-04-12T13:00', offset = 7200 } = {}) {
  const hourly = { time: time === null ? [] : [time] };
  for (const [taxon, value] of Object.entries(values)) {
    hourly[OPEN_METEO_VARIABLES[taxon]] = [value];
  }
  return { ...(offset === null ? {} : { utc_offset_seconds: offset }), hourly };
}

/** How many points a request asks for (1 for anything that is not a list). */
export function pointCount(url) {
  try {
    const latitude = new URL(url).searchParams.get('latitude');
    return latitude ? latitude.split(',').length : 1;
  } catch {
    return 1;
  }
}

/** The body Open-Meteo answers to `url`: one entry per point when several. */
export function answerFor(url, body) {
  const count = pointCount(url);
  return count > 1 && !Array.isArray(body) ? Array.from({ length: count }, () => body) : body;
}

/**
 * Stub `fetch` with an Open-Meteo answer, recording the URLs called.
 * @param {object|((url: string) => object)} body the answer of ONE point, or a
 *   function of the URL
 * @param {{ ok?: boolean, status?: number }} [options]
 * @returns {string[]} the URLs requested, in order
 */
export function stubOpenMeteo(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const payload = typeof body === 'function' ? body(String(url)) : body;
    return {
      ok,
      status: ok ? 200 : status === 200 ? 503 : status,
      headers: new Headers(),
      json: async () => answerFor(String(url), payload),
    };
  };
  return calls;
}

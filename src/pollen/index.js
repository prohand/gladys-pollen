// -----------------------------------------------------------------------------
// Pollen provider registry.
//
// A provider knows how to read pollen concentrations for a position. Today a
// single one is registered (Open-Meteo / CAMS Europe), but the lookup goes
// through `findProvider()` so adding a source for another region is a one-line
// change here plus a new file next to `openMeteo.js` — the device code never
// names a provider.
//
// To add one:
//   1. create `src/pollen/<yourProvider>.js` exposing { key, name, taxa,
//      supports(location), fetchPollen(location) }, plus the OPTIONAL
//      fetchForecast(location) the dashboard widgets draw their curve from,
//      and the OPTIONAL fetchPollenMany(locations) — one request for a whole
//      refresh cycle, answering one settled result per location, in order;
//   2. append it to PROVIDERS below, BEFORE the more generic ones (the first
//      provider that supports the location wins, so a national source can
//      override the continental fallback for its own country).
// -----------------------------------------------------------------------------

import { openMeteoProvider } from './openMeteo.js';
import {
  concentrationToEanLevel,
  concentrationToRiskLevel,
  foldEanLevel,
  overallRisk,
} from './risk.js';

export const PROVIDERS = [openMeteoProvider];

/**
 * Pick the provider that covers a location.
 * @param {{ latitude: number, longitude: number }} location
 * @returns {object|undefined} the provider, or undefined when none covers it
 */
export function findProvider(location) {
  return PROVIDERS.find((provider) => provider.supports(location));
}

/**
 * Every taxon any registered provider can report, in a stable order. The device
 * features are built from this list so a device keeps the same shape whichever
 * provider ends up serving it.
 */
export function allTaxa() {
  const taxa = [];
  for (const provider of PROVIDERS) {
    for (const taxon of provider.taxa) {
      if (!taxa.includes(taxon)) {
        taxa.push(taxon);
      }
    }
  }
  return taxa;
}

/**
 * Read a location and convert the concentrations into risk levels.
 * @param {{ latitude: number, longitude: number }} location
 * @returns {Promise<{
 *   provider: string,
 *   concentrations: Record<string, number|null>,
 *   risks: Record<string, number|null>,
 *   eanRisks: Record<string, number|null>,
 *   overall: { level: number|null, eanLevel: number|null, taxon: string|null },
 *   measuredAt: string|null,
 * }>} `risks` are on the core's 0-3 scale — what every feature, widget and
 *   scene works on. `eanRisks` are the same readings on the six EAN bands,
 *   0-5, which only the TEXT features of a station display (see
 *   `src/pollen/risk.js`). `measuredAt` is the ISO 8601 instant the reading is
 *   valid at, in the local time of the location — null when the provider does
 *   not date its answer.
 */
export async function readPollenRisk(location) {
  const provider = requireProvider(location);
  return gradeReading(provider, await provider.fetchPollen(location));
}

/**
 * The provider of a location, or an error that does NOT print its point: the
 * message ends up in the logs and in the Supervision screen, and a location is
 * often somebody's home.
 */
function requireProvider(location) {
  const provider = findProvider(location);
  if (!provider) {
    throw noProviderError(location);
  }
  return provider;
}

function noProviderError(location) {
  return new Error(
    `No pollen provider covers ${location?.name ? `"${location.name}"` : 'this location'} ` +
      '(pollen forecasts are currently limited to the CAMS European domain)',
  );
}

/**
 * Read SEVERAL locations at once, one outcome per location, never a rejection.
 *
 * What a refresh cycle and the "all places" card call: a provider with the
 * optional `fetchPollenMany` answers every location of a cycle in ONE request
 * instead of one each; the others are read location by location. Either way a
 * location that fails is an `error` in its own slot, and never hides the
 * answer of the others.
 * @param {Array<object>} locations
 * @returns {Promise<Array<{ location: object, reading?: object, error?: Error }>>}
 *   in the order of `locations`
 */
export async function readPollenRisks(locations) {
  const outcomes = new Array(locations.length);
  const byProvider = new Map();
  locations.forEach((location, index) => {
    const provider = findProvider(location);
    if (!provider) {
      outcomes[index] = { location, error: noProviderError(location) };
      return;
    }
    if (!byProvider.has(provider)) {
      byProvider.set(provider, []);
    }
    byProvider.get(provider).push(index);
  });

  await Promise.all(
    [...byProvider.entries()].map(async ([provider, indexes]) => {
      const group = indexes.map((index) => locations[index]);
      const settled =
        typeof provider.fetchPollenMany === 'function'
          ? await provider
              .fetchPollenMany(group)
              .catch((reason) => group.map(() => ({ status: 'rejected', reason })))
          : await Promise.allSettled(group.map((location) => provider.fetchPollen(location)));
      indexes.forEach((index, position) => {
        const result = settled[position];
        const location = locations[index];
        if (result?.status === 'fulfilled') {
          outcomes[index] = { location, reading: gradeReading(provider, result.value) };
        } else {
          outcomes[index] = {
            location,
            error: result?.reason ?? new Error('The pollen provider gave no answer'),
          };
        }
      });
    }),
  );
  return outcomes;
}

/** Grade a provider answer: concentrations in, risk levels out. */
function gradeReading(provider, { concentrations, measuredAt }) {
  const risks = {};
  const eanRisks = {};
  for (const [taxon, concentration] of Object.entries(concentrations)) {
    const band = concentrationToEanLevel(taxon, concentration);
    eanRisks[taxon] = band;
    risks[taxon] = foldEanLevel(band);
  }

  // The worst taxon is picked on the MEASURED bands, then folded: the fold is
  // monotonic, so the published 0-3 level is the same either way, but two taxa
  // both reading 3 are no longer a tie — the one actually higher in the air is
  // the dominant one.
  const worst = overallRisk(eanRisks);

  return {
    provider: provider.key,
    concentrations,
    risks,
    eanRisks,
    overall: { level: foldEanLevel(worst.level), eanLevel: worst.level, taxon: worst.taxon },
    measuredAt,
  };
}

/**
 * Read the hour-by-hour forecast of a location and grade it, like
 * `readPollenRisk` does for the current hour.
 *
 * The curve is what the dashboard `chart` component draws. It is OPTIONAL on
 * purpose: a provider that only knows the current hour answers an empty list
 * of hours rather than failing, and the widget simply drops its chart — a
 * missing forecast must never cost the card the risk it does know.
 * @param {{ latitude: number, longitude: number }} location
 * @returns {Promise<{ provider: string, hours: Array<{
 *   t: string,
 *   concentrations: Record<string, number|null>,
 *   risks: Record<string, number|null>,
 * }> }>}
 */
export async function readPollenForecast(location) {
  const provider = requireProvider(location);
  if (typeof provider.fetchForecast !== 'function') {
    return { provider: provider.key, hours: [] };
  }

  const { hours } = await provider.fetchForecast(location);
  return {
    provider: provider.key,
    hours: (hours ?? []).map((hour) => {
      const risks = {};
      for (const [taxon, concentration] of Object.entries(hour.concentrations ?? {})) {
        risks[taxon] = concentrationToRiskLevel(taxon, concentration);
      }
      return { t: hour.t, concentrations: hour.concentrations ?? {}, risks };
    }),
  };
}

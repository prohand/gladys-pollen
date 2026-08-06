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
//      supports(location), fetchPollen(location) };
//   2. append it to PROVIDERS below, BEFORE the more generic ones (the first
//      provider that supports the location wins, so a national source can
//      override the continental fallback for its own country).
// -----------------------------------------------------------------------------

import { openMeteoProvider } from './openMeteo.js';
import { concentrationToRiskLevel, overallRisk } from './risk.js';

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
 *   overall: { level: number|null, taxon: string|null },
 *   measuredAt: string|null,
 * }>}
 */
export async function readPollenRisk(location) {
  const provider = findProvider(location);
  if (!provider) {
    throw new Error(
      `No pollen provider covers ${location.latitude},${location.longitude} ` +
        '(pollen forecasts are currently limited to the CAMS European domain)',
    );
  }

  const { concentrations, measuredAt } = await provider.fetchPollen(location);

  const risks = {};
  for (const [taxon, concentration] of Object.entries(concentrations)) {
    risks[taxon] = concentrationToRiskLevel(taxon, concentration);
  }

  return {
    provider: provider.key,
    concentrations,
    risks,
    overall: overallRisk(risks),
    measuredAt,
  };
}

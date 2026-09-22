// -----------------------------------------------------------------------------
// Dashboard widget: ONE place.
//
// What it adds over the core's "device in a room" box, which already shows the
// features of a pollen station:
//   - it only shows the species that ARE in the air, biggest first, instead of
//     seven rows of which five say zero;
//   - it can be narrowed to the pollens the reader actually reacts to;
//   - it draws the two days AHEAD, which no device feature can: a forecast has
//     not happened yet, so the core keeps no history of it. That is exactly
//     what the `chart` component's inline series are for.
//
// The card is built for ONE reader, in the language the core says they read —
// unlike a device name, which is stored once and read by everyone.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { formatDateTime } from '../dateTime.js';
import { inLanguage } from '../language.js';
import {
  deviceExternalIds,
  FEATURE,
  findLocationByDeviceId,
  refreshLocations,
} from '../devices/pollenStation.js';
import { allTaxa, readPollenForecast, readPollenRisk } from '../pollen/index.js';
import { overallRisk, RISK_LEVEL_MAX, RISK_LEVELS } from '../pollen/risk.js';
import { taxonName } from '../pollen/taxa.js';
import { levelText } from '../riskText.js';
import {
  clip,
  CONTENT_TTL_SECONDS,
  emptyState,
  levelColor,
  refreshButton,
  widgetLanguage,
} from './content.js';
import { WIDGET_KEYS } from './keys.js';

const logger = createLogger({ name: WIDGET_KEYS.STATION });

/** A `chart` component takes at most four series; beyond that, one is clearer. */
const MAX_CHART_SERIES = 4;

const NO_LOCATION = {
  en: 'Pick a place in the widget settings.',
  fr: 'Choisissez un lieu dans les réglages du widget.',
};
const NO_DATA = {
  en: 'No pollen data for this place right now.',
  fr: 'Aucune donnée pollinique pour ce lieu actuellement.',
};
const NOTHING_IN_THE_AIR = {
  en: 'No pollen in the air',
  fr: 'Aucun pollen dans l’air',
};
const OVERALL_LABEL = { en: 'Overall risk', fr: 'Risque global' };
const FILTERED_LABEL = { en: 'Your risk', fr: 'Votre risque' };
const CHART_TITLE = { en: 'Today and tomorrow', fr: 'Aujourd’hui et demain' };

/**
 * The taxa a widget instance follows: the ticked ones, or all of them.
 *
 * A `multi_select` stores an array of option values; nothing ticked is the
 * wildcard, and an option the code no longer knows is dropped rather than
 * carried into a lookup that would answer undefined.
 * @param {unknown} setting
 * @returns {string[]}
 */
export function selectedTaxa(setting) {
  const every = allTaxa();
  const picked = (Array.isArray(setting) ? setting : [])
    .map(String)
    .filter((taxon) => every.includes(taxon));
  return picked.length > 0 ? picked : every;
}

/** Risks restricted to the taxa this instance follows. */
function filterRisks(risks, taxa) {
  return Object.fromEntries(taxa.map((taxon) => [taxon, risks?.[taxon] ?? null]));
}

/**
 * The gauge: the level, on the scale every pollen bulletin uses.
 *
 * When the reader follows EVERY species, the tile is bound to the device
 * feature instead of carrying a number: a device-bound tile follows the
 * published states in real time and needs no refresh at all. A filtered
 * instance cannot — no feature holds "the worst of the three pollens you
 * ticked" — so it carries the value this content computed.
 */
function riskGauge(ids, level, taxa, language) {
  const everyTaxon = taxa.length === allTaxa().length;
  const common = {
    type: 'gauge',
    label: inLanguage(everyTaxon ? OVERALL_LABEL : FILTERED_LABEL, language),
    color: levelColor(level),
  };
  return everyTaxon
    ? { ...common, device_feature: ids.feature(FEATURE.OVERALL_RISK) }
    : { ...common, value: level, min: 0, max: RISK_LEVEL_MAX };
}

/** One row per species IN THE AIR, worst first. */
function speciesStatus(risks, taxa, language) {
  const items = taxa
    .filter((taxon) => (risks[taxon] ?? 0) > RISK_LEVELS.NONE)
    .sort((a, b) => risks[b] - risks[a])
    .map((taxon) => ({
      label: clip(taxonName(taxon, language), 40),
      value: clip(levelText(risks[taxon], language), 40),
      color: levelColor(risks[taxon]),
    }));

  // A `status` needs at least one item, and "nothing at all" is an answer the
  // reader wants: an empty card would look like a failed request.
  return {
    type: 'status',
    items:
      items.length > 0
        ? items
        : [
            {
              label: inLanguage(NOTHING_IN_THE_AIR, language),
              value: levelText(RISK_LEVELS.NONE, language),
              color: levelColor(RISK_LEVELS.NONE),
            },
          ],
  };
}

/**
 * The forecast curve: one series per followed species, or a single "worst of
 * them" series when there are too many to read.
 * @returns {object|null} the chart component, or null when there is nothing to draw
 */
export function forecastChart(hours, taxa, language) {
  const points = (values) => values.filter((point) => Number.isFinite(point.v));

  const series =
    taxa.length <= MAX_CHART_SERIES
      ? taxa.map((taxon) => ({
          name: clip(taxonName(taxon, language), 24),
          points: points(hours.map((hour) => ({ t: hour.t, v: hour.risks?.[taxon] }))),
        }))
      : [
          {
            name: clip(inLanguage(OVERALL_LABEL, language), 24),
            points: points(
              hours.map((hour) => ({
                t: hour.t,
                v: overallRisk(filterRisks(hour.risks, taxa)).level,
              })),
            ),
          },
        ];

  const drawable = series.filter((one) => one.points.length > 0);
  if (drawable.length === 0) {
    return null;
  }
  return {
    type: 'chart',
    // A risk level holds until the next hour: a step is what it looks like, a
    // smooth line would suggest a value between 3 and 4 that does not exist.
    chart_type: 'stepline',
    title: inLanguage(CHART_TITLE, language),
    series: drawable,
    now_marker: true,
  };
}

export const stationWidget = {
  key: WIDGET_KEYS.STATION,

  /**
   * Build the card of one instance.
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
   * @param {object} config the integration configuration
   * @param {{ settings: Record<string, unknown>, language?: string }} options
   */
  async getContent(gladys, config, { settings, language }) {
    const lang = widgetLanguage(language, config);
    const location = findLocationByDeviceId(gladys, config, settings?.location);
    if (!location) {
      // Either nothing is picked yet, or the device the instance points at is
      // gone: the same sentence fixes both.
      return emptyState(NO_LOCATION);
    }

    const taxa = selectedTaxa(settings?.taxa);
    let reading;
    try {
      reading = await readPollenRisk(location);
    } catch (err) {
      // A provider outage costs the card its numbers, never the dashboard its
      // layout: the widget says so and the next pull tries again.
      logger.error(`Widget content failed for ${location.name}`, err);
      return emptyState(NO_DATA);
    }

    const risks = filterRisks(reading.risks, taxa);
    const { level } = overallRisk(risks);
    if (level === null) {
      return emptyState(NO_DATA);
    }

    const ids = deviceExternalIds(gladys, location);
    const components = [
      // First, because the core drops what overflows the budget in content
      // order — and because several instances of this widget look alike.
      { type: 'text', variant: 'heading', text: clip(location.name, 40) },
      riskGauge(ids, level, taxa, lang),
      speciesStatus(risks, taxa, lang),
    ];

    if (settings?.forecast !== false && settings?.forecast !== 'false') {
      const chart = await stationWidget.buildForecast(location, taxa, lang);
      if (chart) {
        components.push(chart);
      }
    }

    const measuredAt = formatDateTime(reading.measuredAt, lang);
    components.push(
      {
        type: 'text',
        variant: 'caption',
        text: clip(measuredAt ? `CAMS · ${measuredAt}` : 'CAMS', 80),
      },
      refreshButton(),
    );

    return { ttl_seconds: CONTENT_TTL_SECONDS, components };
  },

  /** The curve, or nothing: a missing forecast never costs the card its risk. */
  async buildForecast(location, taxa, language) {
    try {
      const { hours } = await readPollenForecast(location);
      return forecastChart(hours, taxa, language);
    } catch (err) {
      logger.warn(`Forecast unavailable for ${location.name}`, err);
      return null;
    }
  },

  /**
   * The `refresh` pill: re-read this instance's place and republish its states.
   * @returns {Promise<{ en: string, fr: string }>} the toast shown to the user
   */
  async onAction(gladys, config, actionKey, params, { settings }) {
    const location = findLocationByDeviceId(gladys, config, settings?.location);
    if (!location) {
      return { en: 'No place to refresh.', fr: 'Aucun lieu à rafraîchir.' };
    }
    const { failed } = await refreshLocations(gladys, [location], config.language);
    return failed === 0
      ? { en: `${location.name} refreshed.`, fr: `${location.name} rafraîchi.` }
      : {
          en: `Could not refresh ${location.name}.`,
          fr: `Impossible de rafraîchir ${location.name}.`,
        };
  },
};

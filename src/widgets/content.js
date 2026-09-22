// -----------------------------------------------------------------------------
// The bits of widget-content vocabulary both cards share.
//
// The vocabulary is declarative and the core renders it: no HTML, no CSS, no
// colour codes — a `color` is a semantic name the theme resolves, so the card
// follows the user's dark mode without this integration knowing about it.
//
// The content budget the core enforces is worth keeping in mind while reading
// the two builders: 8 components, 1 focal (chart / card-list / image), 6 tiles
// (value / gauge), 2 texts (1 body), 1 status, 4 buttons. Beyond a cap the core
// DROPS components in content order, so what matters comes first.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { LANGUAGES, normalizeLanguage } from '../language.js';
import { RISK_LEVELS } from '../pollen/risk.js';

/**
 * How fast the data moves, in seconds: the CAMS forecast is published once a
 * day and interpolated hourly, so a quarter of an hour is already generous.
 * The core re-pulls on expiry, and `nudgeWidgets` short-circuits it when a
 * refresh cycle has just published something new.
 */
export const CONTENT_TTL_SECONDS = 900;

/**
 * The colour of a risk level. Six levels, six semantic colours — the scale
 * reads at a glance and stays legible in both themes.
 */
const LEVEL_COLORS = {
  [RISK_LEVELS.NONE]: WIDGET_COLORS.NEUTRAL,
  [RISK_LEVELS.VERY_LOW]: WIDGET_COLORS.SUCCESS,
  [RISK_LEVELS.LOW]: WIDGET_COLORS.SUCCESS,
  [RISK_LEVELS.MODERATE]: WIDGET_COLORS.WARNING,
  [RISK_LEVELS.HIGH]: WIDGET_COLORS.DANGER,
  [RISK_LEVELS.VERY_HIGH]: WIDGET_COLORS.DANGER,
};

/** Colour of a level, `neutral` for a level there is no value for. */
export function levelColor(level) {
  return LEVEL_COLORS[level] ?? WIDGET_COLORS.NEUTRAL;
}

/**
 * The language a widget is written in.
 *
 * Unlike a device name, a widget content is built for ONE reader and the core
 * says which language they read: that is the language to answer in. A reader
 * whose language this integration does not speak falls back to the configured
 * one rather than to the default, so an English install stays English for a
 * German visitor.
 * @param {string|undefined} requested the `language` of the widget.get options
 * @param {{ language?: string }} config
 */
export function widgetLanguage(requested, config) {
  const code = String(requested ?? '')
    .trim()
    .slice(0, 2)
    .toLowerCase();
  return LANGUAGES.includes(code) ? code : normalizeLanguage(config?.language);
}

/** Keep a text inside the budget the core would truncate it to anyway. */
export function clip(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * A card that says why it has nothing to show.
 *
 * An empty `components` array is a valid empty state, but a blank card looks
 * broken: one caption is what tells the user whether to configure the widget
 * or to wait for the provider.
 * @param {{ en: string, fr: string }} message
 */
export function emptyState(message) {
  return {
    ttl_seconds: CONTENT_TTL_SECONDS,
    components: [{ type: 'text', variant: 'caption', text: message }],
  };
}

/** The "re-read it now" pill both cards carry, wired to their `refresh` action. */
export function refreshButton() {
  return {
    type: 'button',
    label: { en: 'Refresh', fr: 'Rafraîchir' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: 'refresh' },
  };
}

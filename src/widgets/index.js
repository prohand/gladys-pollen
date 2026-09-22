// -----------------------------------------------------------------------------
// Dashboard widget registry.
//
// Same shape as the device registry next door: the manifest declares the
// identity of each widget (key, label, icon, per-instance settings) and the
// code answers two questions per key — "what does the card show?"
// (`getContent`, pulled by the core) and "the user tapped a button"
// (`onAction`). A test ties the two lists together.
//
// What the core guarantees, and what it does NOT: it renders the vocabulary,
// caps it and themes it, but it never fetches anything on our behalf. Every
// number in a card comes from a provider call made here, which is why both
// builders are written to degrade — an outage costs a card its numbers, never
// the dashboard its layout.
// -----------------------------------------------------------------------------

import { locationsWidget } from './locationsWidget.js';
import { stationWidget } from './stationWidget.js';

export { nudgeWidgets, WIDGET_KEYS } from './keys.js';

export const WIDGETS = [stationWidget, locationsWidget];

/** The widget a key designates, or undefined. */
export function findWidget(key) {
  return WIDGETS.find((widget) => widget.key === key);
}

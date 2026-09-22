# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration**: a Node container that connects to a
Gladys host over WebSocket + HTTP through `@gladysassistant/integration-sdk`. It
is not a library and there is no local Gladys to run against — correctness is
established by the unit tests and by the manifest/code consistency checks.

It exposes the pollen risk of user-chosen locations. Data comes from two open,
key-free Open-Meteo APIs: the air-quality one (CAMS European forecast) for
pollen, and the geocoding one (GeoNames) for turning a town into a point. See
`README.md` for why Atmo France was set aside.

## Commands

```bash
npm test                                     # node --test, network-free
node --test test/risk.test.js                # one file
node --test --test-name-pattern="dominant"   # one test by name
npm run lint                                 # eslint
npm run format:check                         # prettier, CI gate
npm run format                               # prettier --write
```

CI runs `format:check`, then `lint`, then `test`, on Node 24 (the Dockerfile's
runtime). Run all three before pushing — a formatting diff fails the build.

## Architecture

### Devices are a projection of the configuration

The upstream template (`integration-template-js`) uses a **static** array of
device blueprints. This integration inverts that: there is one device _type_
(`src/devices/pollenStation.js`) and a variable number of devices, one per entry
in `config.locations`. Copying template device patterns will therefore mislead
you — the blueprint's `buildDevices`/`deviceExternalIds` map over
`watchedLocations(config)`.

A device's identity is `<type>:<location id>`, and the location id is generated
once, when the user adds the location. Renaming a location or moving its point
keeps the device, its history and its place in rooms and scenes.

### The location list is the single source of truth

`src/locations.js` owns the data, `src/locationEditor.js` the three actions that
change it. Consequences worth internalising:

- **`locations` is deliberately absent from `config_schema`.** No static form can
  hold a list built at runtime. It is written through `gladys.setConfig()` — the
  documented way to store integration-owned state outside the schema. A test
  asserts it stays out of the schema.
- **`setConfig` does not come back through `onConfigUpdated`.** A self-initiated
  write must update the in-memory `config` by hand. The `setConfig` dependency
  injected into the editor in `index.js` is the only place allowed to do this.
- **Coordinates travel as TEXT** (`src/coordinates.js`), in the form and in the
  stored list. `Number('')` is 0 — a valid latitude — and a `number` field is an
  `<input type="number">` the browser sanitizes in its own locale, so a French
  one silently drops `48.8566`.
- **Positions, not names, are what a user can pick.** A manifest `select` has
  static options, so the delete dropdown offers `1..MAX_LOCATIONS` and the
  listing action is what maps a number to a location. `MAX_LOCATIONS` and the
  option list are kept in sync by `test/manifest.test.js`.

`publishDiscoveredDevices()` **replaces** the previously published list. That is
the deletion mechanism: removing a location and re-publishing is what makes it
leave the Discovery tab. Creating/deleting the actual Gladys device stays the
user's action — an integration cannot delete one, which is why the delete action
names the device it leaves behind.

### Action messages are returned, never thrown

The SDK acks a thrown handler error as a plain `error: e.message` string, which
loses the multi-language message. Every expected, user-facing outcome — a
refused coordinate, an ambiguous town, a location outside the coverage — is
**returned** as an `{ en, fr }` object; only unexpected failures throw. That
message is also the only thing the Configuration screen displays of what this
integration has to say, hence the listing being an action too.

### Names are the only text this integration has to translate itself

Everything displayed — action results, connection status — is returned as
`{ en, fr }` and rendered by the core in the reader's language. Device and
feature **names** cannot work that way: they are plain strings stored in
`t_device_feature.name` when the user creates the device, and the host API
exposes no user language at all (the only one it ever returns is a messaging
contact's, `getContacts()` / contract B.15 — this integration has no contacts).

Hence `src/language.js`: `config.language`, a manifest `select`, **`fr` by
default**. It is threaded through `buildDevice`/`buildStates`/`poll` as an
argument rather than read from a module-level variable, so the mapping stays
testable in both languages. The TEXT states follow it too — a stored state
is a string like a name, translated by nobody downstream — including the date
written by `src/dateTime.js` (`06/08/2026 13:00` in French, `2026-08-06 13:00` in
English). Anything else that speaks
to the user stays `{ en, fr }`; `taxonName(taxon, 'en' | 'fr')` is what the
bilingual action messages call.

Re-publishing does NOT rename an existing device: the core upserts the params of
the devices already created, never their name. A language switch therefore
applies to the devices still to be created, which the manifest description and
`docs/` both say.

### There is no country anywhere

Everything downstream of the geocoder works on a latitude and a longitude. The
country only ever existed as the registry that knew how to read a national
postal code, which made the integration French while its data is European. It
was replaced by one worldwide geocoder (`src/geocoding.js`): no country field,
no registry to extend, no manifest option list to keep in sync. Ambiguity is
resolved by the user, with a comma — `Montauban, Tarn-et-Garonne` — never by
picking the first answer.

### The Gladys houses are read, not synced

`src/houses.js` reads `GET /api/integration/v1/house` — the houses the user
placed on the map in Gladys — and `import_houses` turns each one into an ordinary
location. Three things it is easy to get wrong:

- **`"location": true` in the manifest is an authorization contract**, shown on
  the install screen and enforced server-side. Without it the core answers 403,
  which no retry fixes — only re-installing does, so that status carries
  `HOUSE_ACCESS_DENIED` and gets its own message. The endpoint opened in Gladys
  4.85.0, below the `>=4.86.0` the manifest requires anyway.
- **The SDK does not wrap the endpoint** (0.14.0), hence the hand-made `fetch`
  with `GLADYS_HOST_API_URL` / `GLADYS_INTEGRATION_TOKEN`.
- **The import is one `setConfig` and one re-publish**, computed against a single
  list. A house with no coordinates, one outside the CAMS domain, a duplicate or
  one over `MAX_LOCATIONS` is named in the answer rather than dropped silently,
  and nothing is written when nothing is added.

### Three surfaces opened by Gladys 5.1

`widgets`, `scene_triggers` and `scene_actions` are manifest CAPABILITY fields.
Declaring any of them pins `gladys_version` to `>=5.1.0` — an older core
validates manifests against a strict field allowlist and rejects the whole
integration over the unknown field — and both the store validator and
`test/manifest.test.js` enforce that coupling, exactly as `categories` pins
4.86.0.

They are registered in `index.js` by key, like the manifest `actions`, and the
same test ties every declaration to its handler in both directions.

- **`src/widgets/`** — a card is a DECLARATIVE payload, never HTML: the core
  renders, themes and caps it (8 components, 1 focal, 6 tiles, 2 texts, 1
  status, 4 buttons) and drops what overflows **in content order**, so what
  matters goes first. The SDK exports the core's own checks
  (`validateWidgetContent`), and `test/widgets.test.js` asserts `[]` for every
  card built here — anything else means the core would alter it.
  `src/widgets/keys.js` exists only to break a cycle: the refresh cycle nudges
  the widgets, the widgets read the devices, so the keys and `nudgeWidgets` live
  in a module that imports nothing of ours.
- **`src/scenes/riskEvents.js`** — an event is a TRANSITION, never a state. Every
  level is already a device feature; what a trigger adds is the move, fired
  once, with the wording a scene needs. Nothing fires on the first reading after
  a start ("unknown → 4" is not a change), a taxon with no value fires nothing (a
  missing measurement is not a fall to zero), and a refused event never takes the
  refresh cycle down. The levels travel as STRINGS: a filter is a
  `multi_select`, a manifest can only declare string option values, and the core
  compares them with the event value.
- **`src/scenes/sceneActions.js`** — a scene action is NEVER a condition:
  throwing fails that action alone and the scene carries on, so "no data" is an
  output (`level: null`) the scene author can branch on. Only a broken call — an
  unknown device — throws.

A `source: "devices"` field (widget setting, trigger filter, action field) stores
a device `external_id`; `findLocationByDeviceId()` is the single place that maps
it back to a location.

Unlike a device name, a widget content is built for ONE reader and the core says
which language they read — `widgetLanguage()` uses it, falling back to
`config.language` for a language this integration does not speak.

`src/riskText.js` is where a risk is put into WORDS, shared by the overall-risk
TEXT feature, the events, the action outputs and the widget rows so
"risque 3/3 (élevé)" reads identically everywhere. The words are the core's own
(`RISK_LEVEL_LABELS`), so a card never contradicts the badge next to it — and
`levelColor()` maps each level to the colour the core paints for that same
value (the widget palette has no `orange`, so 1 and 2 share `warning`).

### One extension registry

**`src/pollen/`** — providers expose `{ key, name, taxa, supports(location),
fetchPollen(location) }` plus the OPTIONAL `fetchForecast(location)`, first
match wins, so callers never name an implementation. Order matters: a national
source registered before `openMeteoProvider` overrides it for its own area.

`fetchForecast` is what the widget curve is drawn from, and it is a SECOND
request with a cache of its own: the refresh cycle of every device only needs
the current hour, and it runs whether or not a dashboard is open. A provider
without it makes `readPollenForecast` answer no hours, and the card drops its
chart rather than failing.

### The manifest is a contract checked by tests

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code:
every action has a handler _and_ every handler has a button, `DEFAULT_CONFIG`
matches the manifest defaults, the delete dropdown offers exactly
`MAX_LOCATIONS` positions, coordinates stay in `string` fields, `section` fields
stay valueless. When you change one side, the test tells you about the other.

Config/action field types: `string` (not `text`), `number`, `boolean`, `select`,
`multi_select`, `secret`, `oauth2`, `section`.

The same test file covers the 5.1 fields: widget keys, 3-30 character labels,
settings restricted to the non-sensitive types, trigger filters that are never
`boolean` and never carry a `default` (an empty filter is the wildcard), scalar
`variables`/`outputs`, and the option lists — levels and taxa — kept in sync with
`RISK_LEVEL_LABELS` and `allTaxa()`.

`categories` is the catalog shelf, `["environment"]` here — 1 to 3 keys of the
store vocabulary (`climate`, `lighting`, `energy`, `security`, `multimedia`,
`appliances`, `environment`, `protocols`, `network`, `notifications`,
`assistants`, `services`). Declaring it is what pins `gladys_version` to
`>=4.86.0`: an older core rejects any unknown top-level manifest field, and both
the store validator and a test enforce that coupling. The store's admission
checks run locally with `npx github:GladysAssistant/integration-store .`.

Do not hand-edit `version` or `docker_image` in the manifest — the release
workflow rewrites both.

## Gladys core constraints that are not obvious

Each of these caused a real bug; the first two left the Discovery tab silently
empty. The core sources are worth cloning when in doubt
(`GladysAssistant/Gladys`, public, read-only clone is enough).

- **`poll_frequency` is an ENUM in MILLISECONDS capped at one minute.** Anything
  else is rejected and the **whole batch** is refused. Hence the self-driven
  timer: the devices declare no `poll_frequency`, `startPolling` refreshes
  immediately then every `poll_frequency` seconds, floored at
  `MIN_REFRESH_SECONDS`.
- **Every feature needs an explicit numeric `min` and `max`** —
  `t_device_feature.min/max` are `NOT NULL` with no default, text features
  included. Publishing passes, then the user's "add device" click fails.
- **A refused batch is invisible unless you say so**: the error only reaches the
  SDK acknowledgement. `publishDevices()` logs the payload at debug level and
  reports the reason through `setConnectionStatus`.
- **The core silently drops states for a feature that does not exist yet.**
  States published before the user adds the device go nowhere, which is why
  `index.js` listens to `onDeviceCreated` and refreshes immediately.
- **A `risk`/`integer` value is rendered through the core's OWN label set** in
  the "device in a room" box (`BadgeNumberDeviceValue`), which knows exactly
  four: `0 no-risk / 1 low-risk / 2 medium-risk / 3 high-risk`, anything else
  "Inconnu". THAT is the published scale (`RISK_LEVELS`), and `RISK_LEVEL_LABELS`
  are the core's own words. 1.x-2.0 published the six EAN bands instead, and the
  box called a 3 "Élevé" where it meant "moyen" and a 4 "Inconnu". Nothing here
  may ever grade above `RISK_LEVEL_MAX`; a test asserts it per taxon.
- **Adding or redefining a feature needs the user's "Update" click.** A
  re-publish upserts only the PARAMS of a device already created
  (`setDiscoveredDevices`); a changed feature signature (external_id, category,
  type, unit, min, max, step) raises `structure_changed`, and the Discovery tab
  then offers an Update button that runs `device.create` again — features are
  matched by `external_id`, so the history survives. Nothing at all happens
  until the user clicks it.
- **A newline does not survive the Configuration screen** (`white-space: normal`
  on a plain `<div class="alert">`), and markup is escaped. Hence
  `LOCATION_LINE_MARKER` opening every entry of a list, and the Unicode bold of
  `src/richText.js` for the label that opens it.

## Invariants

- **Missing data is `null`, never `0`.** A taxon the model has no value for
  publishes no state at all. This runs from `concentrationToRiskLevel()` through
  `buildStates()`; a zero would pollute the history and could fire a "risk back
  to none" scene. `overallRisk()` likewise reports no dominant taxon at level 0.
- **Risk thresholds are per species** (`src/pollen/risk.js`). 30 grains/m³ is
  quiet for birch and heavy for ragweed. Don't unify the bands.
- **The scale is the core's, and the fold onto it lives in one place.** The EAN
  publishes six bands, the core names four, so `THRESHOLDS` carries the folded
  bounds (two per taxon) rather than the six and a mapping somewhere else.
  Widening the scale means teaching the CORE new labels first, not publishing a
  level it cannot name.
- **A timestamp never travels as a bare wall clock.** `timezone=auto` makes
  Open-Meteo date its answer on the local clock of the point, with the offset in
  a field of its own; `withUtcOffset()` glues them back together at the provider
  boundary, so `measuredAt` is always a complete ISO instant. Displaying it goes
  the other way: `formatDateTime()` reads the fields out of the string and drops
  the offset — a forecast is read against the clock of the town it covers, and
  going through `Date` would print the CONTAINER's timezone instead. That
  per-location hour is why the date is a feature of every station rather than of
  one device global to the integration.
- **A location id is never reused and never derived from what the user can
  edit** — it becomes the device `external_id`, so a reused id would hand a
  deleted location's device history to the next one created. The ids written by
  1.0.0 (`fr-75001-paris`) are read back as they are, which is what keeps those
  installs' devices alive.
- **Provider coverage is checked before use** (`supports()`): outside the CAMS
  European domain the API answers nulls, so a point there is refused when the
  location is added, and `watchedLocations()` filters any stored one.
- **A refresh cycle never throws.** A rejection inside a timer callback would
  take the container down; one location failing must not silence the others.
  That now covers the scene events it fires (a 404 on an undeclared key, a 429
  past the rate limit) and the widget nudge it sends.
- **A scene event fires on a MOVE, once.** The CAMS forecast is republished once
  a day and re-read hourly: firing on every reading would fire twenty-four
  identical events a day. See `src/scenes/riskEvents.js` for the three cases
  that must stay silent (first reading, unchanged level, no value).

## Testing

Tests never touch the network: `globalThis.fetch` is stubbed per-file and
restored in `afterEach`. `src/pollen/openMeteo.js` keeps a module-level TTL
cache, so tests that count requests must call `clearPollenCache()` in
`beforeEach` — otherwise state leaks between tests.

`src/scenes/riskEvents.js` keeps the last known levels in a module-level Map, so
a test that fires a transition must call `resetRiskMemory()` in `beforeEach` —
the same leak as the provider cache.

`test/helpers/fakeGladys.js` is the in-memory SDK stand-in; extend it when you
use a new SDK method rather than mocking the SDK itself. The location editor
takes its outside world by injection (`getConfig`, `setConfig`, `resolvePlace`,
`isCovered`, `findCreatedDevice`), so `test/locationEditor.test.js` exercises the
buttons with no Gladys and no network at all.

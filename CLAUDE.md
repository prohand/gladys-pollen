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
testable in both languages. The two TEXT states follow it too — a stored state is
a string like a name, translated by nobody downstream. Anything else that speaks
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
  `HOUSE_ACCESS_DENIED` and gets its own message. It is also why
  `gladys_version` is `>=4.85.0`.
- **The SDK does not wrap the endpoint** (0.11.0), hence the hand-made `fetch`
  with `GLADYS_HOST_API_URL` / `GLADYS_INTEGRATION_TOKEN`.
- **The import is one `setConfig` and one re-publish**, computed against a single
  list. A house with no coordinates, one outside the CAMS domain, a duplicate or
  one over `MAX_LOCATIONS` is named in the answer rather than dropped silently,
  and nothing is written when nothing is added.

### One extension registry

**`src/pollen/`** — providers expose `{ key, name, taxa, supports(location),
fetchPollen(location) }`, first match wins, so callers never name an
implementation. Order matters: a national source registered before
`openMeteoProvider` overrides it for its own area.

### The manifest is a contract checked by tests

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code:
every action has a handler _and_ every handler has a button, `DEFAULT_CONFIG`
matches the manifest defaults, the delete dropdown offers exactly
`MAX_LOCATIONS` positions, coordinates stay in `string` fields, `section` fields
stay valueless. When you change one side, the test tells you about the other.

Config/action field types: `string` (not `text`), `number`, `boolean`, `select`,
`multi_select`, `secret`, `oauth2`, `section`.

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
  the "device in a room" box, which stops at 3; levels 4 and 5 read "Inconnu"
  there. The 0-5 scale is kept — it is the scale every pollen bulletin uses — and
  the overall-risk TEXT feature carries the exact wording for dashboards.
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

## Testing

Tests never touch the network: `globalThis.fetch` is stubbed per-file and
restored in `afterEach`. `src/pollen/openMeteo.js` keeps a module-level TTL
cache, so tests that count requests must call `clearPollenCache()` in
`beforeEach` — otherwise state leaks between tests.

`test/helpers/fakeGladys.js` is the in-memory SDK stand-in; extend it when you
use a new SDK method rather than mocking the SDK itself. The location editor
takes its outside world by injection (`getConfig`, `setConfig`, `resolvePlace`,
`isCovered`, `findCreatedDevice`), so `test/locationEditor.test.js` exercises the
buttons with no Gladys and no network at all.

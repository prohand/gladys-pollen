# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Gladys Assistant **external integration**: a Node container that connects to a
Gladys host over WebSocket + HTTP through `@gladysassistant/integration-sdk`. It
is not a library and there is no local Gladys to run against — correctness is
established by the unit tests and by the manifest/code consistency checks.

It exposes the pollen risk of user-chosen locations. Data comes from two open,
key-free APIs: Open-Meteo (CAMS European forecast) for pollen, and
geo.api.gouv.fr for French postal codes. See `README.md` for why Atmo France was
set aside.

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
in `config.locations`. `src/devices/index.js` is a projection, not a registry.

Copying template device patterns will therefore mislead you — every device
function takes the `location` it operates on.

### The location list is the single source of truth

`src/locations.js` owns it. Two consequences worth internalising:

- **`locations` is deliberately absent from `config_schema`.** It is written by
  the integration through `gladys.setConfig({ locations })` — the SDK-documented
  way to store integration-owned state outside the schema (the same mechanism
  OAuth tokens use). A test asserts it stays out of the schema.
- **`setConfig` does not come back through `onConfigUpdated`.** A self-initiated
  write must update the in-memory `config` by hand. `saveLocations()` in
  `index.js` is the only place allowed to do this: persist, update memory,
  re-publish. Never call `gladys.setConfig` for locations anywhere else.

`publishDiscoveredDevices()` **replaces** the previously published list. That is
the deletion mechanism: removing a location and re-publishing is what makes it
leave the Discovery tab. Creating/deleting the actual Gladys device stays the
user's action.

### Action errors must be returned, not thrown

The SDK acks a thrown handler error as a plain `error: e.message` string, which
loses the multi-language message. So **expected, user-facing failures are
returned** as `{ en, fr }` objects; only unexpected ones throw. `LocationError`
carries `multiLanguageMessage` and the `runAction()` wrapper in `index.js`
converts it. Preserve this split when adding an action.

### Two extension registries

Both are "first match wins" lookups so callers never name an implementation:

- **`src/countries/`** — postal code → coordinates, one module per country.
  This is the only country-specific step; the pollen source is continental.
- **`src/pollen/`** — providers expose `{ key, name, taxa, supports(location),
fetchPollen(location) }`. Order matters: a national source registered before
  `openMeteoProvider` overrides it for its own area.

Adding a country means touching the registry **and** the manifest (`country`
option on `add_location`, plus `default_country`). `test/manifest.test.js` fails
CI when those drift apart — that is the step people forget.

### The manifest is a contract checked by tests

`test/manifest.test.js` ties `gladys-assistant-integration.json` to the code:
every action has a handler, `DEFAULT_CONFIG` matches the manifest defaults, the
country options match the registry, `section` fields stay valueless. When you
change one side, the test tells you about the other.

Config/action field types are the SDK's: `string` (not `text`), `number`,
`select`, `multi_select`, `secret`, `section`.

Do not hand-edit `version` or `docker_image` in the manifest — the release
workflow rewrites both.

## Invariants

- **Missing data is `null`, never `0`.** A taxon the model has no value for
  publishes no state at all. This runs from `concentrationToRiskLevel()` through
  `buildStates()`; a zero would pollute the history and could fire a "risk back
  to none" scene. `overallRisk()` likewise reports no dominant taxon at level 0.
- **Risk thresholds are per species** (`src/pollen/risk.js`). 30 grains/m³ is
  quiet for birch and heavy for ragweed. Don't unify the bands.
- **Location ids are stable and slugified** — they become device `external_id`s,
  so changing `makeLocationId()` orphans users' existing devices.
- **Provider coverage is checked before use** (`supports()`): outside the CAMS
  European domain the API answers nulls, so claiming coverage would create a
  device that never holds a value.

## Testing

Tests never touch the network: `globalThis.fetch` is stubbed per-file and
restored in `afterEach`. `src/pollen/openMeteo.js` keeps a module-level TTL
cache, so tests that count requests must call `clearPollenCache()` in
`beforeEach` — otherwise state leaks between tests.

`test/helpers/fakeGladys.js` is the in-memory SDK stand-in; extend it when you
use a new SDK method rather than mocking the SDK itself.

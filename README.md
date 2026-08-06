# Pollens — Gladys Assistant integration

![Pollens](./cover.png)

External integration for [Gladys Assistant](https://gladysassistant.com)
exposing the **pollen risk** of the locations you choose: one device per
location, with a 0-to-5 risk level per pollen species.

Built from the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js).

**No account, no API key.** The user types a town and gets a device.

- 🇫🇷 [User documentation (français)](./docs/fr.md)
- 🇬🇧 [User documentation (English)](./docs/en.md)

## Data sources

| Need                  | Source                                                                                                                                   | Auth |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Pollen concentrations | [CAMS European air quality forecast](https://atmosphere.copernicus.eu/) via [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api) | none |
| Town → position       | [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api) (GeoNames)                                                      | none |

CAMS is the atmospheric service of the EU Copernicus programme, operated by
ECMWF: an official source, on a ~11 km grid, forecasting the six main allergenic
taxa (alder, birch, grass, mugwort, olive, ragweed) in grains/m³.

### Why not Atmo France

[Atmo France](https://www.atmo-france.org/) publishes a French pollen index, but
its API requires an account and an authentication token. Every user would have
to create one before the integration did anything at all. CAMS gives official
data with zero setup, so it wins. Should Atmo France open an unauthenticated
endpoint later, it slots in as an extra provider (see below) without touching
the device code.

## How it works

Locations are **not** `config_schema` fields — a list the user builds at runtime
cannot be one: the Configuration screen is generated from a static manifest, and
every field it renders that is not a `section` is an `<input>`. They are managed
by four buttons and stored by the integration itself through
`gladys.setConfig({ locations })`, the documented way to keep integration-owned
state outside the schema.

| Action                       | What it does                                                          |
| ---------------------------- | --------------------------------------------------------------------- |
| **Add a location**           | Geocodes a town (or takes a point), stores it, re-publishes Discovery |
| **Show my locations**        | The numbered listing — those numbers are what the delete picker takes |
| **Test the pollen provider** | Live call to the source, for _every_ location                         |
| **Remove a location**        | Drops the location it names, so it leaves the Discovery tab           |

`publishDiscoveredDevices()` replaces the previously published list, so adding a
location makes it appear in the **Discovery** tab and removing one makes it
disappear. Creating and deleting the actual Gladys device stays the user's call,
as for every integration.

Most place names are shared: `Montauban` exists twice in France alone. Rather
than guessing, `add_location` lists the candidates and asks for a comma and the
region, the country or the postal code — `Montauban, Tarn-et-Garonne`.

### Two Gladys core constraints this integration is shaped by

Both were learned the hard way, and both silently emptied the Discovery tab:

- **`poll_frequency` is an enum in milliseconds capped at one minute.** Any other
  value has the _whole_ device batch refused. A pollen forecast changes once a
  day, so the devices declare none and the integration runs its own
  `setInterval` (`startPolling`), floored at `MIN_REFRESH_SECONDS`.
- **Every feature needs an explicit numeric `min` and `max`** —
  `t_device_feature.min/max` are `NOT NULL` with no default, text features
  included.

A refused batch is now logged, and reported in the Supervision screen through
`setConnectionStatus`, instead of leaving an empty tab with no explanation.

## Device features

Eight features per location, all read-only and historized:

- **Overall pollen risk** (0-5) — the worst of the six taxa;
- **Dominant pollen** (text) — which taxon drives that risk;
- one risk (0-5) per taxon: alder, birch, grass, mugwort, olive, ragweed.

Concentrations are graded with **per-species thresholds** (`src/pollen/risk.js`):
30 grains/m³ is a quiet day for birch and a heavy one for ragweed. A taxon the
model has no value for publishes nothing at all — a missing measurement is not a
zero risk.

## Project structure

```
.
├─ index.js                          # SDK bootstrap + event wiring (no pollen logic)
├─ src/
│  ├─ config.js                      # config defaults + normalization
│  ├─ locations.js                   # the location list: normalize / upsert / remove / print
│  ├─ locationEditor.js              # the three location actions of the Configuration screen
│  ├─ geocoding.js                   # ← town -> coordinates (Open-Meteo geocoding)
│  ├─ coordinates.js                 #   parsing a WGS-84 coordinate typed by a human
│  ├─ richText.js                    #   the only emphasis an action message can carry
│  ├─ pollen/                        # ← the pollen data sources
│  │  ├─ index.js                    #   provider registry + grading
│  │  ├─ openMeteo.js                #   Open-Meteo / CAMS Europe driver
│  │  └─ risk.js                     #   grains/m³ -> 0-5 risk, per species
│  └─ devices/
│     ├─ index.js                    #   devices = a projection of the locations
│     └─ pollenStation.js            #   the device type (features, poll, states)
├─ docs/{en,fr}.md                   # user documentation, re-hosted by Gladys
├─ test/                             # node --test, no network
├─ gladys-assistant-integration.json # manifest
└─ cover.png                         # catalog cover, 800×534
```

## There is no country to configure

Everything downstream of the geocoder — the provider, the devices, the features
— works on a latitude and a longitude. The country only ever existed as the
registry that knew how to read a national postal code, which made the
integration French while its data is European. One worldwide geocoder removed
that step: no country field, no registry to extend, no manifest option list to
keep in sync. Coverage is decided by the provider instead — `supports()` — and a
point outside it is refused when the location is added, rather than published as
a device that never holds a value.

## Adding a pollen source

1. create `src/pollen/<yourProvider>.js` exposing `{ key, name, taxa,
supports(location), fetchPollen(location) }`;
2. append it to `PROVIDERS` (`src/pollen/index.js`), **before** the more generic
   ones — the first provider that supports the location wins, so a national
   source overrides the continental fallback for its own country.

The device code never names a provider: it asks the registry.

## Development

```bash
npm install
npm test          # node --test, network-free (fetch is stubbed)
npm run lint
npm run format
```

## Releasing

The workflows come from the official template and are repo-generic:

1. add the GitHub topic `gladys-assistant-integration` to the repository;
2. run the **Release** workflow — it bumps the version, tags it, and builds the
   multi-arch image to `ghcr.io/prohand/gladys-pollen`.

## Licence

Apache-2.0.

Pollen data © Copernicus Atmosphere Monitoring Service (CAMS), served by
Open-Meteo. Place names © GeoNames, served by Open-Meteo.

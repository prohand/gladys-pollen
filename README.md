# Pollens — Gladys Assistant integration

![Pollens](./cover.png)

External integration for [Gladys Assistant](https://gladysassistant.com)
exposing the **pollen risk** of the locations you choose: one device per town,
with a 0-to-5 risk level per pollen species.

Built from the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js).

**No account, no API key.** The user types a postal code and gets a device.

- 🇫🇷 [User documentation (français)](./docs/fr.md)
- 🇬🇧 [User documentation (English)](./docs/en.md)

## Data sources

| Need                        | Source                                                                                                                                   | Auth |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Pollen concentrations       | [CAMS European air quality forecast](https://atmosphere.copernicus.eu/) via [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api) | none |
| Postal code → position (FR) | [API Découpage administratif](https://geo.api.gouv.fr/decoupage-administratif/communes) (data.gouv.fr / Etalab)                          | none |

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

Locations are **not** a `config_schema` field — nobody should hand-write a JSON
array in a form. They are managed by four buttons in the Configuration screen
and stored by the integration itself through `gladys.setConfig({ locations })`,
the documented way to keep integration-owned state outside the schema.

| Action                       | What it does                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| **Add a location**           | Geocodes a postal code, stores the town, re-publishes Discovery |
| **List my locations**        | Shows what is configured                                        |
| **Remove a location**        | Drops it from the config, so it leaves the Discovery tab        |
| **Test the pollen provider** | Live call to the source on the first location                   |

`publishDiscoveredDevices()` replaces the previously published list, so adding a
location makes it appear in the **Discovery** tab and removing one makes it
disappear. Creating and deleting the actual Gladys device stays the user's call,
as for every integration.

A postal code is not a town: `05100` covers four communes. Rather than guessing,
`add_location` lists the candidates and asks the user to re-run with the town
name.

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
│  ├─ locations.js                   # the location list: parse / add / remove / match
│  ├─ countries/                     # ← postal code -> coordinates, per country
│  │  ├─ index.js                    #   registry
│  │  └─ fr.js                       #   France (API Géo, data.gouv.fr)
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

## Adding a country

The pollen source is already continental, so a new country only needs its
"postal code → coordinates" step:

1. create `src/countries/<code>.js` exposing `{ code, label, postalCodePattern,
postalCodeExample, postalCodeHint, searchPostalCode(postalCode) }`, backed by
   an open, key-free geocoder;
2. register it in `COUNTRIES` (`src/countries/index.js`);
3. add its option to the `country` field of `add_location` **and** to
   `default_country` in `gladys-assistant-integration.json`.

Step 3 is the one that is easy to forget, so `test/manifest.test.js` fails CI if
the manifest options and the implemented countries drift apart.

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
Open-Meteo. French administrative data © data.gouv.fr / Etalab.

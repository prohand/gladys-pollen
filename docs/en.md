# Pollens

This integration exposes the **pollen risk** of the locations you choose as
Gladys devices: one device per town, with a 0-to-5 risk level for each pollen
type.

No account to create, no API key to paste.

## Where the data comes from

Pollen concentrations come from the **CAMS European air quality forecast**
(Copernicus Atmosphere Monitoring Service, the atmospheric service of the EU
Copernicus programme, operated by ECMWF). It is the reference model in Europe,
on a ~11 km grid.

It is queried through [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api),
which republishes CAMS as open data **with no account and no API key**.

French postal codes are turned into coordinates by the **API Découpage
administratif** ("API Géo") of data.gouv.fr / Etalab, also open and
unauthenticated.

> **What about Atmo France?** Atmo France does publish a pollen index for
> France, but its API requires an account and an authentication token that every
> user would have to create before the integration works at all. CAMS was chosen
> because it is official _and_ usable with zero setup.

## Adding a location

1. Open the integration's **Configuration** tab.
2. Click **Add a location**.
3. Pick the country (France for now) and type the **postal code**, e.g. `75001`.
   Leave the "Town" field empty.
4. Submit.

If a single town matches the postal code, it is added straight away. If several
towns share it (common in rural areas), the integration lists them: run the
action again with the **Town** field filled in.

The location then shows up in the **Discovery** tab, named
`Pollen <Town> (<postal code>)`. Click it to create the device in Gladys — that
is when it becomes usable in dashboards and scenes.

You can add up to 20 locations.

## Removing a location

1. Click **List my locations** to see what is configured.
2. Click **Remove a location** and type the **postal code** or the **town name**.

The location disappears from the Discovery tab immediately.

> If you had already added the device to Gladys, delete it from the device page
> too: Gladys never deletes a device you created on its own. Conversely, if you
> delete the device without removing the location, it comes back in the
> Discovery tab, ready to be added again.

## What the device measures

Each device exposes eight measurements:

| Measurement         | Description                                 |
| ------------------- | ------------------------------------------- |
| Overall pollen risk | The highest of the six risks below (0 to 5) |
| Dominant pollen     | The name of the pollen driving that risk    |
| Alder               | Risk from 0 to 5                            |
| Birch               | Risk from 0 to 5                            |
| Grass               | Risk from 0 to 5                            |
| Mugwort             | Risk from 0 to 5                            |
| Olive               | Risk from 0 to 5                            |
| Ragweed             | Risk from 0 to 5                            |

The risk scale is:

| Level | Meaning   |
| ----- | --------- |
| 0     | None      |
| 1     | Very low  |
| 2     | Low       |
| 3     | Moderate  |
| 4     | High      |
| 5     | Very high |

The level is derived from the concentration in pollen grains per cubic metre of
air, using **per-species thresholds**: 30 grains/m³ is a quiet day for birch but
a heavy one for ragweed, whose allergenic power is far stronger. The thresholds
follow the bands published by the European Aeroallergen Network (EAN) and reused
by the CAMS pollen products.

Every measurement keeps its history, so you can chart the pollen season of your
town.

When the model has no value for a species at that position, **nothing is
published** for that species — a missing measurement is not a zero risk.

## Using the risk in a scene

The overall risk is a "risk" category measurement: it behaves like any numeric
sensor in a scene. A few ideas:

- close the shutters or stop the ventilation when the overall risk goes above 3;
- send a notification in the morning if the "Grass" risk is ≥ 4;
- turn the air purifier on when the dominant pollen is the one you react to.

## Refresh interval

Each location is refreshed hourly by default. The CAMS forecast is recomputed
once a day and interpolated hourly, so going below one hour gains nothing. The
interval is configurable between 15 minutes and 24 hours in the Configuration
tab.

## Geographic coverage

The CAMS forecast covers the **European domain**. A location outside that area
is rejected when you add it, rather than creating a device that would never hold
a value.

More countries can be added in future versions: only the "postal code →
coordinates" step is country-specific, the pollen source is already continental.

## Troubleshooting

- **"Test the pollen provider" button**: it queries the source live on your
  first location and shows the result. The quickest way to tell a network
  problem from a configuration one.
- **The logs**: read the integration logs from the Gladys UI, or with
  `docker logs`. Set `LOG_LEVEL` to `debug` to see the URLs being queried.
- **A device stays empty**: check that its location is still listed by "List my
  locations". A device whose location was removed is no longer refreshed.

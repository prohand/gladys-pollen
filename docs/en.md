# Pollens

This integration exposes the **pollen risk** of the locations you choose as
Gladys devices: one device per location, with a 0-to-5 risk level for each pollen
type. You add your **Gladys houses in one click**, or a location by typing its
**town**.

No account to create, no API key to paste.

## Where the data comes from

Pollen concentrations come from the **CAMS European air quality forecast**
(Copernicus Atmosphere Monitoring Service, the atmospheric service of the EU
Copernicus programme, operated by ECMWF). It is the reference model in Europe,
on a ~11 km grid.

It is queried through [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api),
which republishes CAMS as open data **with no account and no API key**.

The towns you type are turned into coordinates by the
[Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), backed
by the GeoNames database — also open and unauthenticated, and worldwide, so
there is no country to pick anywhere in this integration.

> **What about Atmo France?** Atmo France does publish a pollen index for
> France, but its API requires an account and an authentication token that every
> user would have to create before the integration works at all. CAMS was chosen
> because it is official _and_ usable with zero setup.

## Adding your Gladys houses, in one click

You have already told Gladys where you live: that is the map in **Settings >
Houses**. The **"Add my Gladys houses"** button reads those houses and creates a
location for each one that is not watched yet — no town to type.

Four things worth knowing:

- **The access is a permission.** Where you live is personal data: Gladys only
  shares it if you accepted the request on the integration's install screen. If
  the button answers that the access is refused, remove and re-install the
  integration, accepting the request shown there.
- **A house you never placed on the map has no coordinates.** It is named in the
  answer; locate it in Settings > Houses and click the button again.
- **A house outside the CAMS European domain** is named too, and left out: no
  pollen forecast covers it (see "Geographic coverage" below).
- **This is not a sync.** The houses are read at the moment you click. What comes
  out is an ordinary location, which you rename and remove like any other, and a
  house moved in Gladys afterwards does not move its location.

Clicking again is safe: a house already watched is reported, not added twice.

Reading the houses requires **Gladys 4.85.0 or newer**.

## Adding a location

1. Open the integration's **Configuration** tab.
2. Click **Add a location**.
3. Type the **town**, e.g. `Montauban`. Naming the location is optional: the
   town's name is used when you leave the field empty.
4. Submit.

Most place names are shared by several towns — there are two Montauban in France
alone, and a dozen Paris in the world. When that happens the integration lists
the candidates instead of guessing: run the action again with a comma and the
region, the country or the postal code, e.g. `Montauban, Tarn-et-Garonne` or
`Paris, France`.

You can also add a point directly: fill in the **latitude** and the
**longitude** (WGS-84 decimal degrees, both of them — one alone is not a point).
They are read with either decimal separator, so `48,8566` works as well as
`48.8566`. Coordinates win over the town, which is then only kept as the label
of the location.

The location then shows up in the **Discovery** tab, named
`Pollens — <name>`. Click it to create the device in Gladys — that is when it
becomes usable in dashboards and scenes.

You can add up to 20 locations.

## Seeing and removing your locations

**Show my locations** prints them, numbered:

```
• 1. Home — Montauban, Tarn-et-Garonne, France (44.01810, 1.35490)
• 2. Office — Toulouse, Haute-Garonne, France (43.60426, 1.44367)
```

Those numbers are what the deletion dropdown offers, because a dropdown declared
in a manifest can only hold fixed options — never your location names.

To remove one: click **Remove a location**, pick its number, tick **I confirm**
and submit. Running it without the checkbox tells you which location _would_ be
removed. The location disappears from the Discovery tab immediately, and the
locations below it move up a rank — so print the list again before deleting a
second one.

> If you had already added the device to Gladys, delete it from the device page
> too: an integration is not allowed to delete a device you created. Conversely,
> if you delete the device without removing the location, it comes back in the
> Discovery tab, ready to be added again.

## What the device measures

Each device exposes nine measurements:

| Measurement                | Description                                 |
| -------------------------- | ------------------------------------------- |
| Overall pollen risk        | The highest of the six risks below (0 to 5) |
| Overall pollen risk (text) | The same level, spelled out                 |
| Dominant pollen            | The name of the pollen driving that risk    |
| Alder pollen risk          | Risk from 0 to 5                            |
| Birch pollen risk          | Risk from 0 to 5                            |
| Grass pollen risk          | Risk from 0 to 5                            |
| Mugwort pollen risk        | Risk from 0 to 5                            |
| Olive pollen risk          | Risk from 0 to 5                            |
| Ragweed pollen risk        | Risk from 0 to 5                            |

> These are the names with the **Language of the device names** setting on
> English. It defaults to **French** (`Risque pollinique — Bouleau`) — see
> [The language of the names](#the-language-of-the-names) below.

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

The numeric measurements keep their history, so you can chart the pollen season
of your town.

When the model has no value for a species at that position, **nothing is
published** for that species — a missing measurement is not a zero risk.

> On a dashboard, the "device in a room" box labels a risk value with the names
> Gladys knows, which stop at 3: levels 4 and 5 show up as "Unknown" there. The
> text measurement carries the exact wording, which is what to display next to
> it.

## The language of the names

Device and feature names are written in **French by default**: the measurements
read `Risque pollinique global`, `Risque pollinique — Bouleau`, and the dominant
pollen shows up as `Bouleau`. Set **Language of the device names** to English in
the Configuration tab to get the names in the table above.

Why a setting rather than your account language? Everything the integration
_displays_ — the message under a button, the status in the Supervision screen —
is sent to Gladys in both languages, and Gladys picks the one of the person
reading. A device name is not a message: it is a plain text stored as it is the
day you create the device, and nothing in the integration API says which language
you read. So it is chosen once, here.

One consequence: changing the setting renames the features of the devices **yet
to be created**. A device already added to Gladys keeps the names it was created
with — delete it and add it again from the Discovery tab to rename it (its
history goes with the deleted device).

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
tab. A device you have just created is refreshed straight away, without waiting
for the next cycle.

## Geographic coverage

The CAMS forecast covers the **European domain**. A location outside that area
is refused when you add it, rather than creating a device that would never hold
a value.

## Troubleshooting

- **"Test the pollen provider" button**: it queries the source live for _every_
  location and prints one line per location, numbered like the listing. The
  quickest way to tell a network problem from a configuration one.
- **The logs**: read the integration logs from the Gladys UI, or with
  `docker logs`. Set `LOG_LEVEL` to `debug` to see the URLs being queried and
  the exact device payload sent to Gladys.
- **Nothing appears in the Discovery tab**: check the integration's status in
  the Supervision screen — when Gladys refuses a device, the reason is reported
  there.
- **A device stays empty**: check that its location is still listed by "Show my
  locations". A device whose location was removed is no longer refreshed.

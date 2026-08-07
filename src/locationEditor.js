// -----------------------------------------------------------------------------
// The location manager of the Configuration screen.
//
// WHAT THE USER SEES: four buttons and nothing else. Locations are added with
// "Ajouter un lieu" or, in one click, with "Ajouter mes maisons Gladys", listed
// by "Afficher mes lieux" and removed with "Supprimer un lieu". The
// Configuration screen holds NO field about them.
//
// WHY EVERYTHING HAPPENS UNDER A BUTTON. The screen is generated from the
// manifest, which is a static file, and every field it renders that is not a
// `section` is an `<input>`: no read-only widget, no repeatable one. A list
// built at runtime is not something that screen can show as fields. An ACTION's
// result message, on the other hand, is displayed under its button, live, and is
// the ONLY thing the screen shows of what an integration has to say — so the
// listing is an action too.
//
// WHY A LOCATION IS NOT EDITABLE. Designating one entry of the list needs a
// dropdown, and a `select` in a manifest has STATIC options: they can only ever
// be POSITIONS, never the location names. Adding and deleting need no selection
// at all, and they are enough: a location is a point, and a point that moved is
// another location.
//
// Everything the outside world provides is injected (`getConfig`, `setConfig`,
// `resolvePlace`, `isCovered`, `listHouses`), so the whole set is testable
// without a Gladys server nor a network: see `test/locationEditor.test.js`.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { toCoordinate, formatPoint } from './coordinates.js';
import {
  describePlace,
  MAX_LISTED_CANDIDATES,
  placeContext,
  resolvePlace as geocodePlace,
} from './geocoding.js';
import { fetchHouses, HOUSE_ACCESS_DENIED } from './houses.js';
import {
  describeLocation,
  describeLocations,
  findLocationAtPoint,
  findLocationById,
  hasCoordinates,
  LOCATION_LINE_MARKER,
  LOCATION_LINE_SEPARATOR,
  LOCATIONS_KEY,
  locationAtPosition,
  locationDetail,
  locationLine,
  MAX_LOCATIONS,
  newLocationId,
  positionOf,
  removeLocation,
  serializeLocations,
  upsertLocation,
} from './locations.js';

const logger = createLogger({ name: 'locations' });

/**
 * Build the location manager.
 * @param {object} deps
 * @param {() => object} deps.getConfig the current normalized configuration
 * @param {(patch: Record<string, unknown>) => Promise<void>} deps.setConfig
 *   persist a partial configuration and refresh the in-memory one
 * @param {() => Promise<void>} deps.onLocationsChanged re-publish the devices and
 *   restart the refresh timer on the new list
 * @param {(location: object) => Promise<object|null>} [deps.findCreatedDevice]
 *   the Gladys device a location has already been given, if any
 * @param {(point: object) => boolean} [deps.isCovered] whether a pollen provider
 *   has data for a point
 * @param {typeof geocodePlace} [deps.resolvePlace] injected in tests
 * @param {typeof fetchHouses} [deps.listHouses] injected in tests
 */
export function createLocationEditor({
  getConfig,
  setConfig,
  onLocationsChanged,
  findCreatedDevice = async () => null,
  isCovered = () => true,
  resolvePlace = geocodePlace,
  listHouses = fetchHouses,
}) {
  /**
   * Persist a new list, then re-publish the devices on it.
   * @param {Array<object>} locations the new list
   */
  async function commit(locations) {
    await setConfig({ [LOCATIONS_KEY]: serializeLocations(locations) });
    await onLocationsChanged();
  }

  /**
   * The point typed by hand in the add form, when there is one.
   *
   * Both coordinates or neither: a lone latitude is not a point, and taking it
   * with a longitude of 0 would silently watch the Gulf of Guinea. They are
   * `string` fields — see src/coordinates.js for why — so `toCoordinate` is what
   * parses them, comma included, and what rejects a latitude of 300.
   * @param {object} fields
   * @returns {{ point?: object, problem?: { en: string, fr: string } }} both
   *   absent when the user typed no coordinate at all
   */
  function typedPoint(fields) {
    const rawLatitude = String(fields.latitude ?? '').trim();
    const rawLongitude = String(fields.longitude ?? '').trim();
    if (rawLatitude === '' && rawLongitude === '') {
      return {};
    }
    const latitude = toCoordinate(rawLatitude, 'latitude');
    const longitude = toCoordinate(rawLongitude, 'longitude');
    if (latitude === null || longitude === null) {
      return {
        problem: {
          en: `Latitude and longitude go together, in WGS-84 decimal degrees (latitude -90 to 90, longitude -180 to 180): "48.8566" and "2.3522". Received "${rawLatitude}" and "${rawLongitude}".`,
          fr: `La latitude et la longitude vont ensemble, en degrés décimaux WGS-84 (latitude de -90 à 90, longitude de -180 à 180) : « 48,8566 » et « 2,3522 ». Reçu « ${rawLatitude} » et « ${rawLongitude} ».`,
        },
      };
    }
    return { point: { latitude, longitude } };
  }

  /**
   * Turn a place name into a point, or say why it could not be one.
   * @param {string} query
   * @returns {Promise<{ point?: object, place?: object, problem?: object }>}
   */
  async function geocode(query) {
    const { match, candidates } = await resolvePlace(query);
    if (candidates.length === 0) {
      return {
        problem: {
          en: `No place found for "${query}". Check the spelling, or narrow it down with a comma: "Montauban, Tarn-et-Garonne".`,
          fr: `Aucun lieu trouvé pour « ${query} ». Vérifiez l'orthographe, ou précisez après une virgule : « Montauban, Tarn-et-Garonne ».`,
        },
      };
    }
    if (!match) {
      // Too many places share that name — picking one here would silently report
      // another town's pollen.
      const list = candidates.slice(0, MAX_LISTED_CANDIDATES).map(describePlace).join(' | ');
      return {
        problem: {
          en: `Several places are named "${query}". Add a comma and the region, the country or the postal code: ${list}`,
          fr: `Plusieurs lieux s'appellent « ${query} ». Ajoutez une virgule puis la région, le pays ou le code postal : ${list}`,
        },
      };
    }
    return {
      point: { latitude: match.latitude, longitude: match.longitude },
      place: match,
    };
  }

  /**
   * The houses of a report, quoted the way each language quotes.
   *
   * A house is named by the user in Gladys, so the name is the only thing that
   * tells "Maison" from "Bureau" in a sentence about three of them.
   * @param {Array<{ name: string }>} houses
   * @param {'en' | 'fr'} language
   */
  function quoteNames(houses, language) {
    return houses
      .map((house) => (language === 'fr' ? `« ${house.name} »` : `"${house.name}"`))
      .join(', ');
  }

  /**
   * The device a location has already been given, or null.
   *
   * Never fatal: failing to read the device list must not stop a deletion the
   * user asked for — at worst the message is the vaguer of the two.
   */
  async function createdDeviceOf(location) {
    try {
      return await findCreatedDevice(location);
    } catch (err) {
      logger.warn('Could not tell whether the location had a device', err);
      return null;
    }
  }

  return {
    // --- Manifest actions ---------------------------------------------------
    actions: {
      /**
       * Add a location, from a place name or straight from a point.
       *
       * The place name is the normal way in — nobody knows their town's
       * coordinates by heart. The two coordinate fields are the way out of the
       * cases the geocoder cannot serve: a hamlet it does not know, or a point
       * read off a map. Given both, they WIN over the name, which is then only
       * kept as the label of the location.
       */
      async add_location(fields = {}) {
        const query = String(fields.place ?? '').trim();
        logger.info(
          `Action add_location <- ${fields.name ?? ''} / ${query} / ` +
            `${fields.latitude ?? ''},${fields.longitude ?? ''}`,
        );

        const typed = typedPoint(fields);
        if (typed.problem) {
          return typed.problem;
        }
        if (!typed.point && query === '') {
          return {
            en: 'Type the town of the location to add, or its latitude and its longitude.',
            fr: 'Saisissez la commune du lieu à ajouter, ou sa latitude et sa longitude.',
          };
        }

        const { locations } = getConfig();
        if (locations.length >= MAX_LOCATIONS) {
          return {
            en: `Maximum ${MAX_LOCATIONS} locations. Delete one first.`,
            fr: `Maximum ${MAX_LOCATIONS} lieux. Supprimez-en un d'abord.`,
          };
        }

        // A typed point is used as it is: the user gave the answer the geocoder
        // would only have guessed at.
        const geocoded = typed.point ? null : await geocode(query);
        if (geocoded?.problem) {
          return geocoded.problem;
        }
        const point = typed.point ?? geocoded.point;

        // Refused HERE rather than published as a device that never holds a
        // value: outside the CAMS European domain the forecast answers nulls for
        // every taxon, so the device would sit forever on "no recent value".
        if (!isCovered(point)) {
          return {
            en: `No pollen forecast covers ${formatPoint(point)}: the CAMS European model stops at the edge of Europe. This location was not added.`,
            fr: `Aucune prévision pollinique ne couvre ${formatPoint(point)} : le modèle européen CAMS s'arrête aux limites de l'Europe. Ce lieu n'a pas été ajouté.`,
          };
        }

        // The forecast is read on a ~11 km grid: two devices on the same point
        // would report the same numbers under two names.
        const duplicate = findLocationAtPoint(locations, point);
        if (duplicate) {
          return {
            en: `That point is already watched by location ${positionOf(locations, duplicate.id)} "${duplicate.name}".`,
            fr: `Ce point est déjà surveillé par le lieu ${positionOf(locations, duplicate.id)} « ${duplicate.name} ».`,
          };
        }

        // A location the user did not name is named after the place it is in —
        // "Pollens — Montauban" beats two decimals. A typed point with no name
        // at all falls back to its coordinates.
        const name =
          String(fields.name ?? '').trim() || geocoded?.place?.name || query || formatPoint(point);
        // What the listing shows after the name: where the point actually is.
        // A geocoded place carries its region and country; a typed point keeps
        // whatever the user wrote in the place field, and nothing when they
        // wrote nothing (the geocoder has no reverse endpoint to ask).
        const addressLabel = geocoded?.place
          ? [geocoded.place.name, placeContext(geocoded.place)].filter(Boolean).join(', ')
          : query;

        const id = newLocationId(locations);
        await commit(
          upsertLocation(locations, { id, name, address_label: addressLabel, ...point }),
        );

        const saved = findLocationById(getConfig().locations, id);
        const position = positionOf(getConfig().locations, id);
        return {
          en: `Location ${position} "${name}" added: ${describeLocation(saved)}. Add its device from the Discovery tab; "Show my locations" lists them all.`,
          fr: `Lieu ${position} « ${name} » ajouté : ${describeLocation(saved)}. Ajoutez son appareil depuis l'onglet Découverte ; « Afficher mes lieux » les liste tous.`,
        };
      },

      /**
       * Add every house configured in Gladys that is not watched yet, in one
       * click.
       *
       * WHY IT EXISTS. The user has already placed their home on a map, in
       * Gladys. Making them type their own town again, in another form, to
       * watch the pollen above that same roof is asking twice for something the
       * core will hand over — see `src/houses.js` for the permission that makes
       * it readable.
       *
       * WHAT IT IS NOT. It is not a sync: the houses are READ once, when the
       * button is clicked, and what comes out is ordinary locations the user
       * renames and deletes like any other. A house moved in Gladys afterwards
       * leaves its location where it was — the same rule as everywhere else
       * here, a point that moved is another location.
       *
       * Nothing is written unless something is actually added, and everything
       * skipped is named: a button that answers "0 added" without saying why is
       * a button the user clicks again.
       */
      async import_houses() {
        logger.info('Action import_houses');

        let houses;
        try {
          houses = await listHouses();
        } catch (err) {
          if (err?.code === HOUSE_ACCESS_DENIED) {
            // Not an outage: the INSTALLED manifest never asked for the
            // permission, and only re-installing the integration grants it.
            logger.warn('The house coordinates are not granted to this integration');
            return {
              en: 'Gladys refuses to share the coordinates of your houses with this integration. That access is granted when the integration is installed: update it to a version that asks for it, or remove and re-install it, and accept the request shown on the install screen. Meanwhile "Add a location" works the same way with the name of a town.',
              fr: "Gladys refuse de partager les coordonnées de vos maisons avec cette intégration. Cet accès s'accorde à l'installation : mettez l'intégration à jour vers une version qui le demande, ou supprimez-la et réinstallez-la en acceptant la demande affichée sur l'écran d'installation. En attendant, « Ajouter un lieu » fait la même chose avec le nom d'une commune.",
            };
          }
          logger.warn('Could not read the houses configured in Gladys', err);
          const reason = String(err?.message ?? err).slice(0, 150);
          return {
            en: `Could not read the houses configured in Gladys: ${reason}. Add the location by the name of its town instead.`,
            fr: `Impossible de lire les maisons configurées dans Gladys : ${reason}. Ajoutez plutôt le lieu par le nom de sa commune.`,
          };
        }

        if (houses.length === 0) {
          return {
            en: 'Gladys has no house configured. Create one in Settings > Houses, place it on the map, then click this button again.',
            fr: 'Gladys ne contient aucune maison. Créez-en une dans Réglages > Maisons, placez-la sur la carte, puis relancez cette action.',
          };
        }

        // The whole import is computed against ONE list and written ONCE: a
        // setConfig per house would re-publish the Discovery tab as many times,
        // and a failure halfway would leave half an import behind.
        const { locations } = getConfig();
        let updated = locations;
        const addedIds = [];
        const duplicates = [];
        const unlocated = [];
        const uncovered = [];
        const overflow = [];

        for (const house of houses) {
          // A house the user never placed on the map: `latitude` is null, and a
          // null taken as 0 would watch the Gulf of Guinea.
          if (!hasCoordinates(house)) {
            unlocated.push(house);
            continue;
          }
          // Same rule as the add form: outside the CAMS European domain the
          // forecast answers nulls for every taxon, so the device would sit
          // forever on "no recent value". A house abroad is skipped by name
          // rather than turned into a sensor that never holds anything.
          if (!isCovered(house)) {
            uncovered.push(house);
            continue;
          }
          const duplicate = findLocationAtPoint(updated, house);
          if (duplicate) {
            duplicates.push({ house, location: duplicate });
            continue;
          }
          if (updated.length >= MAX_LOCATIONS) {
            overflow.push(house);
            continue;
          }
          const id = newLocationId(updated);
          updated = upsertLocation(updated, {
            id,
            name: house.name,
            // A house is a point, not an address: the geocoder has no reverse
            // endpoint to name the town it sits in, and inventing one would be
            // worse than the coordinates the listing already prints.
            address_label: '',
            latitude: house.latitude,
            longitude: house.longitude,
          });
          addedIds.push(id);
        }

        if (addedIds.length > 0) {
          await commit(updated);
        }

        const current = getConfig().locations;
        const lines = addedIds
          .map((id) => findLocationById(current, id))
          .map((location) =>
            locationLine(positionOf(current, location.id), location.name, locationDetail(location)),
          )
          .join(LOCATION_LINE_SEPARATOR);

        // Every house that did NOT become a location gets a sentence naming it.
        const notes = { en: '', fr: '' };
        if (duplicates.length > 0) {
          const en = duplicates
            .map(
              ({ house, location }) =>
                `"${house.name}" (already location ${positionOf(current, location.id)} "${location.name}")`,
            )
            .join(', ');
          const fr = duplicates
            .map(
              ({ house, location }) =>
                `« ${house.name} » (déjà le lieu ${positionOf(current, location.id)} « ${location.name} »)`,
            )
            .join(', ');
          notes.en += ` Already watched: ${en}.`;
          notes.fr += ` Déjà surveillé(s) : ${fr}.`;
        }
        if (unlocated.length > 0) {
          notes.en += ` Not placed on the map in Gladys, so there is no point to watch: ${quoteNames(unlocated, 'en')}. Set their location in Settings > Houses and click again.`;
          notes.fr += ` Sans position sur la carte dans Gladys, donc sans point à surveiller : ${quoteNames(unlocated, 'fr')}. Renseignez leur emplacement dans Réglages > Maisons puis relancez l'action.`;
        }
        if (uncovered.length > 0) {
          notes.en += ` Outside the CAMS European model, which no pollen forecast covers: ${quoteNames(uncovered, 'en')}.`;
          notes.fr += ` Hors du modèle européen CAMS, donc sans prévision pollinique : ${quoteNames(uncovered, 'fr')}.`;
        }
        if (overflow.length > 0) {
          notes.en += ` Maximum ${MAX_LOCATIONS} locations reached, left out: ${quoteNames(overflow, 'en')}.`;
          notes.fr += ` Maximum de ${MAX_LOCATIONS} lieux atteint, laissée(s) de côté : ${quoteNames(overflow, 'fr')}.`;
        }

        if (addedIds.length === 0) {
          return {
            en: `No house to add: your ${houses.length} Gladys house(s) are already watched or cannot be.${notes.en}`,
            fr: `Aucune maison à ajouter : vos ${houses.length} maison(s) Gladys sont déjà surveillées ou ne peuvent pas l'être.${notes.fr}`,
          };
        }
        return {
          en: `${addedIds.length} Gladys house(s) added. Add their devices from the Discovery tab:${LOCATION_LINE_SEPARATOR}${lines}${notes.en}`,
          fr: `${addedIds.length} maison(s) Gladys ajoutée(s). Ajoutez leurs appareils depuis l'onglet Découverte :${LOCATION_LINE_SEPARATOR}${lines}${notes.fr}`,
        };
      },

      /**
       * List the configured locations, numbered.
       *
       * This is the whole "display" side of the integration: the Configuration
       * screen shows nothing else of what it holds, and these numbers are the
       * ones the delete dropdown offers.
       */
      async list_locations() {
        const { locations } = getConfig();
        logger.info(`Action list_locations -> ${locations.length} location(s)`);
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: "Aucun lieu pour l'instant. Ajoutez-en un avec « Ajouter un lieu ».",
          };
        }
        const listing = describeLocations(locations);
        return {
          en: `${locations.length}/${MAX_LOCATIONS} location(s), as "${LOCATION_LINE_MARKER}number. name — place (latitude, longitude)":${LOCATION_LINE_SEPARATOR}${listing}`,
          fr: `${locations.length}/${MAX_LOCATIONS} lieu(x), au format « ${LOCATION_LINE_MARKER}numéro. nom — lieu (latitude, longitude) » :${LOCATION_LINE_SEPARATOR}${listing}`,
        };
      },

      /**
       * Remove the location this action's dropdown names — by its POSITION in
       * the list, which is all a static `select` can offer.
       */
      async remove_location(fields = {}) {
        logger.info(
          `Action remove_location <- ${fields.location ?? ''} confirmation=${fields.confirmation ?? false}`,
        );
        const { locations } = getConfig();
        if (locations.length === 0) {
          return {
            en: 'No location yet. Add one with "Add a location".',
            fr: "Aucun lieu pour l'instant. Ajoutez-en un avec « Ajouter un lieu ».",
          };
        }

        const location = locationAtPosition(locations, fields.location);
        if (!location) {
          return {
            en: `There is no location ${fields.location}. Configured: ${describeLocations(locations)}`,
            fr: `Il n'y a pas de lieu ${fields.location}. Configurés : ${describeLocations(locations)}`,
          };
        }
        if (fields.confirmation !== true) {
          // One click away from losing a location, in a screen full of buttons:
          // the checkbox is what makes it deliberate.
          return {
            en: `Tick "I confirm" to delete location ${fields.location} "${location.name}" (${describeLocation(location)}).`,
            fr: `Cochez « Je confirme » pour supprimer le lieu ${fields.location} « ${location.name} » (${describeLocation(location)}).`,
          };
        }

        // Asked BEFORE the re-publish, while the location still has an
        // external_id to look for: a device the user has already created is the
        // one case an integration cannot clean up, and it must say so precisely
        // rather than leave a sensor that never updates again.
        const created = await createdDeviceOf(location);
        await commit(removeLocation(locations, location.id));

        // Deleting the third of four locations moves the fourth up a rank, and
        // those numbers are what this very dropdown offers.
        const renumbered =
          positionOf(locations, location.id) < locations.length
            ? {
                en: ' The locations after it moved up one rank: run "Show my locations" before deleting another one.',
                fr: " Les lieux suivants remontent d'un rang : lancez « Afficher mes lieux » avant d'en supprimer un autre.",
              }
            : { en: '', fr: '' };

        if (!created) {
          // Never created: re-publishing the list without it is enough, the
          // Discovery screen stops offering it on the spot.
          return {
            en: `Location "${location.name}" removed, and it is no longer offered in the Discovery tab.${renumbered.en}`,
            fr: `Lieu « ${location.name} » supprimé, et il n'est plus proposé dans l'onglet Découverte.${renumbered.fr}`,
          };
        }
        // An integration can only stop OFFERING a device; deleting one the user
        // created is not something the host API lets it do, at any version.
        return {
          en: `Location "${location.name}" removed. Its device "${created.name}" still exists in Gladys and will stop updating: delete it yourself from the integration's Devices tab — an integration is not allowed to delete a device.${renumbered.en}`,
          fr: `Lieu « ${location.name} » supprimé. Son appareil « ${created.name} » existe toujours dans Gladys et ne se mettra plus à jour : supprimez-le vous-même depuis l'onglet Appareils de l'intégration — une intégration n'a pas le droit de supprimer un appareil.${renumbered.fr}`,
        };
      },
    },
  };
}

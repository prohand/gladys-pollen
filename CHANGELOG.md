# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

## [2.2.1] - 2026-10-08

### Fixed

- Saving the Configuration form no longer empties the location list in memory (which stopped every refresh until the next restart).
- Two location buttons clicked together no longer lose one of the two locations.
- A transient Gladys error at connection no longer stops the refresh until the next reconnection: the timer is armed first, and the initialization is retried a minute later.
- A Gladys rate limit (HTTP 429) is no longer reported as a pollen source failure.

### Changed

- All places are read from Open-Meteo in a single request, the current hour and the two-day curve in the same one, cached 30 minutes (longer than the widget refresh).
- Measurements are sent to Gladys in batches paced under its 300 values a minute, with one retry on a 429.
- Open-Meteo and the geocoder are asked once more on a 429, a 5xx or a network error.
- One refresh at a time: buttons, scenes, timer, reconnection and saved form share it; a created device refreshes its own place only, and a reconnection right after a refresh does not re-read everything.
- The coordinates of the places no longer appear in the logs.
- Docker image: base image pinned by digest, `npm ci` only, `/data` owned by the `node` user.

## [2.2.0] - 2026-10-07

- Maintenance release, no functional change.

## [2.1.0] - 2026-10-06

### Added

- `SECURITY.md`: how to report a vulnerability.
- `CHANGELOG.md`, rebuilt from the release history.

### Changed

- Development dependencies updated to their latest versions (ESLint 10.12, Prettier 3.9.9, globals 17.13).

## [2.0.4] - 2026-10-03

### Changed

- Widget « un lieu » : requêtes en parallèle et échecs journalisés (#11)
- Une ligne de log par demande, avec sa durée (#11)

## [2.0.3] - 2026-09-22

### Changed

- Afficher le palier mesuré (0-5) sur les mesures texte

## [2.0.2] - 2026-09-22

### Added

- Name the dominant pollen and spell the risks out

## [2.0.1] - 2026-09-22

### Changed

- Doubler chaque risque d'une mesure texte lisible
- Publier le risque sur l'échelle de Gladys (0-3)

## [2.0.0] - 2026-09-22

### Changed

- Ajouter les widgets, déclencheurs et actions de scène de Gladys 5.1

## [1.0.4] - 2026-08-15

### Changed

- Passer à Gladys 4.86 : SDK 0.12.0 et catégorie du catalogue

## [1.0.3] - 2026-08-08

### Changed

- Afficher la date des données sur chaque appareil

## [1.0.2] - 2026-08-07

### Changed

- Ajouter les maisons Gladys en un clic

## [1.0.1] - 2026-08-06

First public release.

### Added

- Add the Pollens integration
- Add CLAUDE.md

### Changed

- Manage locations like the VigiEau integration, and fix the empty Discovery tab
- Nommer les pollens en français, avec l'anglais en option

### Fixed

- Fix the manifest rejected at install time

[Unreleased]: https://github.com/prohand/gladys-pollen/compare/v2.2.1...HEAD
[2.2.1]: https://github.com/prohand/gladys-pollen/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/prohand/gladys-pollen/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/prohand/gladys-pollen/compare/v2.0.4...v2.1.0
[2.0.4]: https://github.com/prohand/gladys-pollen/compare/v2.0.3...v2.0.4
[2.0.3]: https://github.com/prohand/gladys-pollen/compare/v2.0.2...v2.0.3
[2.0.2]: https://github.com/prohand/gladys-pollen/compare/v2.0.1...v2.0.2
[2.0.1]: https://github.com/prohand/gladys-pollen/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/prohand/gladys-pollen/compare/v1.0.4...v2.0.0
[1.0.4]: https://github.com/prohand/gladys-pollen/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-pollen/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-pollen/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-pollen/releases/tag/v1.0.1

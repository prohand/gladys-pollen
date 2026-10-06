# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

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

[Unreleased]: https://github.com/prohand/gladys-pollen/compare/v2.1.0...HEAD
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

# Pollens

Cette intégration expose le **risque pollinique** des lieux de votre choix sous
forme d'appareils Gladys : un appareil par commune, avec un niveau de risque de
0 à 5 pour chaque type de pollen.

Aucun compte à créer, aucune clé d'API à saisir.

## D'où viennent les données ?

Les concentrations de pollens proviennent de la **prévision européenne de
qualité de l'air CAMS** (Copernicus Atmosphere Monitoring Service, le service
atmosphérique du programme européen Copernicus, opéré par le CEPMMT). C'est le
modèle de référence en Europe, sur une grille d'environ 11 km.

Elles sont interrogées via [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api),
qui rediffuse CAMS en open data **sans compte ni clé d'API**.

Les codes postaux français sont convertis en coordonnées par l'**API Découpage
administratif** (« API Géo ») de data.gouv.fr / Etalab, elle aussi ouverte et
sans authentification.

> **Et Atmo France ?** Atmo France publie bien un indice pollinique pour la
> France, mais son API demande un compte et un jeton d'authentification que
> chaque utilisateur devrait créer avant même que l'intégration fonctionne. La
> source CAMS a été retenue parce qu'elle est officielle _et_ utilisable sans
> aucune démarche.

## Ajouter un lieu

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Cliquez sur **Ajouter un lieu**.
3. Choisissez le pays (France pour l'instant), saisissez le **code postal**, par
   exemple `75001`. Laissez le champ « Commune » vide.
4. Validez.

Si une seule commune correspond au code postal, elle est ajoutée directement. Si
plusieurs communes le partagent (c'est fréquent en zone rurale), l'intégration
vous les liste : relancez alors l'action en renseignant le champ **Commune**.

Le lieu apparaît ensuite dans l'onglet **Découverte**, sous le nom
`Pollen <Commune> (<code postal>)`. Cliquez dessus pour créer l'appareil dans
Gladys : c'est à ce moment-là qu'il devient utilisable dans les tableaux de bord
et les scènes.

Vous pouvez ajouter jusqu'à 20 lieux.

## Supprimer un lieu

1. Cliquez sur **Lister mes lieux** pour voir ce qui est configuré.
2. Cliquez sur **Supprimer un lieu** et saisissez le **code postal** ou le **nom
   de la commune**.

Le lieu disparaît immédiatement de l'onglet Découverte.

> Si vous aviez déjà ajouté l'appareil dans Gladys, supprimez-le aussi depuis la
> page des appareils : Gladys ne supprime jamais tout seul un appareil que vous
> avez créé. Inversement, si vous supprimez l'appareil sans supprimer le lieu,
> celui-ci réapparaîtra dans l'onglet Découverte, prêt à être réajouté.

## Ce que mesure l'appareil

Chaque appareil expose huit mesures :

| Mesure                | Description                                      |
| --------------------- | ------------------------------------------------ |
| Risque global         | Le plus élevé des six risques ci-dessous (0 à 5) |
| Pollen dominant       | Le nom du pollen responsable du risque global    |
| Aulne (_alder_)       | Risque de 0 à 5                                  |
| Bouleau (_birch_)     | Risque de 0 à 5                                  |
| Graminées (_grass_)   | Risque de 0 à 5                                  |
| Armoise (_mugwort_)   | Risque de 0 à 5                                  |
| Olivier (_olive_)     | Risque de 0 à 5                                  |
| Ambroisie (_ragweed_) | Risque de 0 à 5                                  |

L'échelle de risque est la suivante :

| Niveau | Signification |
| ------ | ------------- |
| 0      | Nul           |
| 1      | Très faible   |
| 2      | Faible        |
| 3      | Moyen         |
| 4      | Élevé         |
| 5      | Très élevé    |

Le niveau est calculé à partir de la concentration en grains de pollen par mètre
cube d'air, avec des **seuils propres à chaque espèce** : 30 grains/m³, c'est une
journée calme pour le bouleau mais une journée chargée pour l'ambroisie, dont le
pouvoir allergisant est bien plus fort. Ces seuils suivent les paliers publiés
par le Réseau européen d'aérobiologie (EAN) et repris par les produits
polliniques CAMS.

Toutes les mesures sont historisées : vous pouvez tracer la saison pollinique de
votre commune sur un graphique.

Lorsque le modèle n'a pas de valeur pour une espèce à cet endroit, **aucune
valeur n'est publiée** pour cette espèce — une absence de mesure n'est pas un
risque nul.

## Utiliser le risque dans une scène

Le risque global est une mesure de catégorie « risque » : il s'utilise comme
n'importe quel capteur numérique dans une scène. Quelques idées :

- fermer les volets ou couper la VMC quand le risque global dépasse 3 ;
- envoyer une notification le matin si le risque « Graminées » est ≥ 4 ;
- allumer le purificateur d'air quand le pollen dominant est celui auquel vous
  êtes allergique.

## Rafraîchissement

Par défaut chaque lieu est rafraîchi toutes les heures. La prévision CAMS n'est
recalculée qu'une fois par jour puis interpolée à l'heure : descendre en dessous
d'une heure ne rapporte rien. L'intervalle est réglable entre 15 minutes et
24 heures dans l'onglet Configuration.

## Couverture géographique

La prévision CAMS couvre le **domaine européen**. Un lieu hors de cette zone est
refusé au moment de l'ajout plutôt que de créer un appareil qui n'aurait jamais
de valeur.

D'autres pays pourront être ajoutés dans de futures versions : seule la
conversion « code postal → coordonnées » est spécifique à un pays, la source
pollinique est déjà continentale.

## En cas de problème

- **Bouton « Tester le fournisseur de pollens »** : il interroge la source en
  direct sur votre premier lieu et affiche le résultat. C'est le test le plus
  rapide pour savoir si le problème vient du réseau ou de la configuration.
- **Les journaux** : consultez les logs de l'intégration depuis l'interface
  Gladys, ou avec `docker logs`. Passez `LOG_LEVEL` à `debug` pour voir les URL
  interrogées.
- **Un appareil reste sans valeur** : vérifiez que le lieu est toujours listé par
  « Lister mes lieux ». Un appareil dont le lieu a été supprimé n'est plus
  rafraîchi.

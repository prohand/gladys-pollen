# Pollens

Cette intégration expose le **risque pollinique** des lieux de votre choix sous
forme d'appareils Gladys : un appareil par lieu, avec un niveau de risque de
0 à 5 pour chaque type de pollen.

Aucun compte à créer, aucune clé d'API à saisir.

## D'où viennent les données ?

Les concentrations de pollens proviennent de la **prévision européenne de
qualité de l'air CAMS** (Copernicus Atmosphere Monitoring Service, le service
atmosphérique du programme européen Copernicus, opéré par le CEPMMT). C'est le
modèle de référence en Europe, sur une grille d'environ 11 km.

Elles sont interrogées via [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api),
qui rediffuse CAMS en open data **sans compte ni clé d'API**.

Les communes que vous saisissez sont converties en coordonnées par
l'[API de géocodage Open-Meteo](https://open-meteo.com/en/docs/geocoding-api),
adossée à la base GeoNames — elle aussi ouverte, sans authentification, et
mondiale : il n'y a donc aucun pays à choisir nulle part dans l'intégration.

> **Et Atmo France ?** Atmo France publie bien un indice pollinique pour la
> France, mais son API demande un compte et un jeton d'authentification que
> chaque utilisateur devrait créer avant même que l'intégration fonctionne. La
> source CAMS a été retenue parce qu'elle est officielle _et_ utilisable sans
> aucune démarche.

## Ajouter un lieu

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Cliquez sur **Ajouter un lieu**.
3. Saisissez la **commune**, par exemple `Montauban`. Nommer le lieu est
   facultatif : le nom de la commune est utilisé si vous laissez le champ vide.
4. Validez.

La plupart des noms de lieux sont partagés par plusieurs communes — il y a deux
Montauban rien qu'en France, et une dizaine de Paris dans le monde. Dans ce cas
l'intégration vous liste les candidats plutôt que de deviner : relancez l'action
avec une virgule puis la région, le pays ou le code postal, par exemple
`Montauban, Tarn-et-Garonne` ou `Paris, France`.

Vous pouvez aussi ajouter un point directement : renseignez la **latitude** et
la **longitude** (degrés décimaux WGS-84, les deux — une seule ne fait pas un
point). Les deux séparateurs décimaux sont acceptés, `48,8566` comme `48.8566`.
Les coordonnées l'emportent alors sur la commune, qui ne sert plus que de
libellé du lieu.

Le lieu apparaît ensuite dans l'onglet **Découverte**, sous le nom
`Pollens — <nom>`. Cliquez dessus pour créer l'appareil dans Gladys : c'est à ce
moment-là qu'il devient utilisable dans les tableaux de bord et les scènes.

Vous pouvez ajouter jusqu'à 20 lieux.

## Voir et supprimer vos lieux

**Afficher mes lieux** les liste, numérotés :

```
• 1. Maison — Montauban, Tarn-et-Garonne, France (44.01810, 1.35490)
• 2. Bureau — Toulouse, Haute-Garonne, France (43.60426, 1.44367)
```

Ces numéros sont ceux que propose la liste déroulante de la suppression : une
liste déroulante déclarée dans un manifeste ne peut contenir que des options
figées, jamais le nom de vos lieux.

Pour en supprimer un : cliquez sur **Supprimer un lieu**, choisissez son numéro,
cochez **Je confirme** et validez. Lancer l'action sans cocher vous indique quel
lieu _serait_ supprimé. Le lieu disparaît immédiatement de l'onglet Découverte,
et les lieux suivants remontent d'un rang — réaffichez donc la liste avant d'en
supprimer un deuxième.

> Si vous aviez déjà ajouté l'appareil dans Gladys, supprimez-le aussi depuis la
> page des appareils : une intégration n'a pas le droit de supprimer un appareil
> que vous avez créé. Inversement, si vous supprimez l'appareil sans supprimer le
> lieu, celui-ci réapparaîtra dans l'onglet Découverte, prêt à être réajouté.

## Ce que mesure l'appareil

Chaque appareil expose neuf mesures :

| Mesure                | Description                                      |
| --------------------- | ------------------------------------------------ |
| Risque global         | Le plus élevé des six risques ci-dessous (0 à 5) |
| Risque global (texte) | Le même niveau, écrit en toutes lettres          |
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

Les mesures numériques sont historisées : vous pouvez tracer la saison
pollinique de votre commune sur un graphique.

Lorsque le modèle n'a pas de valeur pour une espèce à cet endroit, **aucune
valeur n'est publiée** pour cette espèce — une absence de mesure n'est pas un
risque nul.

> Sur un tableau de bord, la tuile « appareil dans une pièce » traduit une valeur
> de risque avec les libellés que Gladys connaît, qui s'arrêtent à 3 : les
> niveaux 4 et 5 s'y affichent donc « Inconnu ». La mesure texte porte le libellé
> exact, c'est elle qu'il faut afficher à côté.

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
24 heures dans l'onglet Configuration. Un appareil que vous venez de créer est
rafraîchi immédiatement, sans attendre le cycle suivant.

## Couverture géographique

La prévision CAMS couvre le **domaine européen**. Un lieu hors de cette zone est
refusé au moment de l'ajout plutôt que de créer un appareil qui n'aurait jamais
de valeur.

## En cas de problème

- **Bouton « Tester le fournisseur de pollens »** : il interroge la source en
  direct pour _tous_ vos lieux et affiche une ligne par lieu, numérotée comme la
  liste. C'est le test le plus rapide pour savoir si le problème vient du réseau
  ou de la configuration.
- **Les journaux** : consultez les logs de l'intégration depuis l'interface
  Gladys, ou avec `docker logs`. Passez `LOG_LEVEL` à `debug` pour voir les URL
  interrogées et le contenu exact envoyé à Gladys.
- **Rien n'apparaît dans l'onglet Découverte** : regardez l'état de
  l'intégration dans l'écran Supervision — quand Gladys refuse un appareil, la
  raison y est indiquée.
- **Un appareil reste sans valeur** : vérifiez que le lieu est toujours listé par
  « Afficher mes lieux ». Un appareil dont le lieu a été supprimé n'est plus
  rafraîchi.

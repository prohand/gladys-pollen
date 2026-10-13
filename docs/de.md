# Pollens

Diese Integration stellt das **Pollenrisiko** der Orte Ihrer Wahl als
Gladys-Geräte bereit: ein Gerät pro Ort, mit einem Risikoniveau von 0 bis 3 — der
Skala von Gladys selbst — für jede Pollenart. Sie fügen Ihre **Gladys-Häuser mit
einem Klick** hinzu, oder einen Ort, indem Sie seine **Gemeinde** eingeben.

Kein Konto anzulegen, kein API-Schlüssel einzufügen.

Das Risiko erscheint auch auf Ihrem **Dashboard** (zwei Widgets) und steuert Ihre
**Szenen** (zwei Auslöser, zwei Aktionen).

> Diese Version erfordert **Gladys 5.2** oder neuer: Die Liste Ihrer Gladys-Häuser
> in „Meine Gladys-Häuser hinzufügen“ gibt es vorher nicht, ebenso wenig (vor 5.1)
> die Dashboard-Widgets und Szenenkarten einer Integration.

## Woher die Daten stammen

Die Pollenkonzentrationen stammen aus der **europäischen CAMS-Luftqualitätsvorhersage**
(Copernicus Atmosphere Monitoring Service, der Atmosphärendienst des
EU-Programms Copernicus, betrieben vom EZMW). Sie ist das Referenzmodell in
Europa, auf einem Raster von ~11 km.

Sie wird über [Open-Meteo](https://open-meteo.com/en/docs/air-quality-api)
abgefragt, das CAMS als Open Data **ohne Konto und ohne API-Schlüssel**
weiterverbreitet.

Die eingegebenen Gemeinden werden von der
[Geokodierungs-API von Open-Meteo](https://open-meteo.com/en/docs/geocoding-api)
in Koordinaten umgewandelt, gestützt auf die Datenbank GeoNames — ebenfalls offen,
ohne Authentifizierung und weltweit, daher muss in dieser Integration nirgends
ein Land gewählt werden.

> **Und Atmo France?** Atmo France veröffentlicht zwar einen Pollenindex für
> Frankreich, aber seine API erfordert ein Konto und ein Authentifizierungstoken,
> das jeder Benutzer anlegen müsste, bevor die Integration überhaupt funktioniert.
> CAMS wurde gewählt, weil es offiziell _und_ ohne jede Einrichtung nutzbar ist.

## Ihre Gladys-Häuser mit einem Klick hinzufügen

Sie haben Gladys bereits gesagt, wo Sie wohnen: Das ist die Karte unter
**Einstellungen > Zuhause**. Die Schaltfläche **„Meine Gladys-Häuser hinzufügen“**
liest diese Häuser und legt für jedes noch nicht überwachte Haus einen Ort an —
ohne eine Gemeinde einzugeben. Um nur eines davon hinzuzufügen, wählen Sie es in
der Liste **Haus** der Schaltfläche; lassen Sie die Liste leer, um alle
hinzuzufügen.

Vier Dinge sind gut zu wissen:

- **Der Zugriff ist eine Berechtigung.** Wo Sie wohnen, sind personenbezogene
  Daten: Gladys teilt sie nur, wenn Sie die Anfrage auf dem Installationsbildschirm
  der Integration akzeptiert haben. Antwortet die Schaltfläche, dass der Zugriff
  verweigert wird, entfernen Sie die Integration und installieren Sie sie neu,
  indem Sie die dort angezeigte Anfrage akzeptieren.
- **Ein Haus, das Sie nie auf der Karte platziert haben, hat keine Koordinaten.**
  Es wird in der Antwort genannt; verorten Sie es unter Einstellungen > Zuhause
  und klicken Sie erneut auf die Schaltfläche.
- **Ein Haus außerhalb des europäischen CAMS-Gebiets** wird ebenfalls genannt und
  ausgelassen: Keine Pollenvorhersage deckt es ab (siehe „Geografische Abdeckung“
  unten).
- **Es ist keine Synchronisierung.** Die Häuser werden im Moment des Klicks
  gelesen. Heraus kommt ein gewöhnlicher Ort, den Sie wie jeden anderen umbenennen
  und entfernen, und ein später in Gladys verschobenes Haus verschiebt seinen Ort
  nicht.

Erneutes Klicken ist unbedenklich: Ein bereits überwachtes Haus wird gemeldet,
nicht doppelt hinzugefügt.

Das Lesen der Häuser benötigt die Hauskoordinaten, die Gladys mit 4.85.0
freigegeben hat, und die Liste **Haus** benötigt Gladys 5.2.0 — die Version, die
diese Integration voraussetzt.

## Einen Ort hinzufügen

1. Öffnen Sie den Tab **Konfiguration** der Integration.
2. Klicken Sie auf **Ort hinzufügen**.
3. Geben Sie die **Gemeinde** ein, z. B. `Montauban`. Den Ort zu benennen ist
   optional: Bleibt das Feld leer, wird der Name der Gemeinde verwendet.
4. Bestätigen Sie.

Die meisten Ortsnamen teilen sich mehrere Gemeinden — allein in Frankreich gibt
es zwei Montauban und weltweit ein Dutzend Paris. In diesem Fall listet die
Integration die Kandidaten auf, statt zu raten: Führen Sie die Aktion erneut aus,
mit einem Komma und der Region, dem Land oder der Postleitzahl, z. B.
`Montauban, Tarn-et-Garonne` oder `Paris, France`.

Sie können auch direkt einen Punkt hinzufügen: Geben Sie den **Breitengrad** und
den **Längengrad** ein (Dezimalgrad WGS-84, beide — einer allein ergibt keinen
Punkt). Beide Dezimaltrennzeichen werden gelesen, `48,8566` funktioniert also
ebenso wie `48.8566`. Die Koordinaten haben Vorrang vor der Gemeinde, die dann nur
noch als Bezeichnung des Ortes dient.

Der Ort erscheint dann im Tab **Entdecken** unter dem Namen
`Pollens — <Name>`. Klicken Sie darauf, um das Gerät in Gladys anzulegen — erst
dann ist es in Dashboards und Szenen nutzbar.

Sie können bis zu 20 Orte hinzufügen.

## Ihre Orte anzeigen und entfernen

**Meine Orte anzeigen** gibt sie nummeriert aus:

```
• 1. Zuhause — Montauban, Tarn-et-Garonne, France (44.01810, 1.35490)
• 2. Büro — Toulouse, Haute-Garonne, France (43.60426, 1.44367)
```

Diese Nummern bietet die Auswahlliste zum Entfernen an, denn eine in einem
Manifest deklarierte Auswahlliste kann nur feste Optionen enthalten — nie die
Namen Ihrer Orte.

Um einen Ort zu entfernen: Klicken Sie auf **Ort entfernen**, wählen Sie seine
Nummer, haken Sie **Ich bestätige** an und bestätigen Sie. Ohne den Haken sagt
Ihnen die Aktion, welcher Ort entfernt _würde_. Der Ort verschwindet sofort aus
dem Tab „Entdecken“, und die Orte darunter rücken um einen Rang nach oben —
lassen Sie die Liste also erneut anzeigen, bevor Sie einen zweiten entfernen.

> Wenn Sie das Gerät bereits zu Gladys hinzugefügt hatten, löschen Sie es auch auf
> der Geräteseite: Eine Integration darf kein Gerät löschen, das Sie angelegt
> haben. Umgekehrt: Löschen Sie das Gerät, ohne den Ort zu entfernen, erscheint es
> wieder im Tab „Entdecken“, bereit, erneut hinzugefügt zu werden.

## Was das Gerät misst

Jedes Gerät stellt sechzehn Messwerte bereit: ein Gesamtrisiko, seine Formulierung,
den Hauptpollen, das Datum der Daten, dann für jede der sechs Pollenarten einen
Risikoindex und dasselbe Risiko in Worten.

| Messwert                       | Beschreibung                                       |
| ------------------------------ | -------------------------------------------------- |
| Pollenrisiko gesamt            | Das höchste der sechs Risiken unten (0 bis 3)      |
| Pollenrisiko gesamt (Text)     | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Hauptpollen                    | Der Name der Pollenart, die dieses Risiko bestimmt |
| Letzte Datenaktualisierung     | Datum und Uhrzeit, für die die Vorhersage gilt     |
| Pollenrisiko — Erle            | Risiko von 0 bis 3                                 |
| Pollenrisiko — Erle (Text)     | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Pollenrisiko — Birke           | Risiko von 0 bis 3                                 |
| Pollenrisiko — Birke (Text)    | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Pollenrisiko — Gräser          | Risiko von 0 bis 3                                 |
| Pollenrisiko — Gräser (Text)   | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Pollenrisiko — Beifuß          | Risiko von 0 bis 3                                 |
| Pollenrisiko — Beifuß (Text)   | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Pollenrisiko — Olive           | Risiko von 0 bis 3                                 |
| Pollenrisiko — Olive (Text)    | Das gemessene Risiko in Worten: „4/5 (hoch)“       |
| Pollenrisiko — Ambrosia        | Risiko von 0 bis 3                                 |
| Pollenrisiko — Ambrosia (Text) | Das gemessene Risiko in Worten: „4/5 (hoch)“       |

Die „(Text)“-Messwerte sind das, was eine Benachrichtigung, ein Textfeld im
Dashboard oder ein Sprachassistent vorliest: Eine Szene, die den Index liest,
erhält eine `3`, und `3` ist dann das, was in ihrer Nachricht steht. Für eine
Pollenart, für die das Modell keinen Wert hat, wird gar nichts veröffentlicht,
weder Index noch Formulierung.

**Index und Formulierung stehen absichtlich nicht auf derselben Skala.** Der Index
steht auf der Skala von Gladys, 0 bis 3 — der einzigen, die der Kern benennen
kann. Die Formulierung ist ein einfacher Text, den nachgelagert niemand neu
interpretiert, daher trägt sie den **Messwert selbst, 0 bis 5**, die europäischen
Stufen, denen die CAMS-Daten folgen. Ein „hoher“ und ein „sehr hoher“ Tag zeigen
beide `3` im Index, aber „4/5 (hoch)“ und „5/5 (sehr hoch)“ im Text.

> Das sind die Namen bei der Einstellung **Sprache der Gerätenamen** auf Deutsch.
> Standardmäßig ist sie auf **Französisch** gestellt (`Risque pollinique — Bouleau`)
> — siehe [Die Sprache der Namen](#die-sprache-der-namen) unten.

Die numerischen Messwerte behalten ihren Verlauf, sodass Sie die Pollensaison
Ihrer Gemeinde als Diagramm darstellen können.

Hat das Modell für eine Art an dieser Position keinen Wert, wird **nichts
veröffentlicht** — ein fehlender Messwert ist kein Risiko von null.

### Wie alt sind diese Zahlen?

Das beantwortet der Messwert **Letzte Datenaktualisierung**. Er zeigt Datum und
Uhrzeit, für die die angezeigte Vorhersage gilt, im Format `06.08.2026 13:00`.

Es ist das Datum der **Daten**, nicht der letzten Anfrage: CAMS veröffentlicht
seine Vorhersage einmal täglich und Open-Meteo interpoliert sie Stunde für Stunde,
daher liest eine erfolgreiche Aktualisierung meist genau dieselben Zahlen erneut.
Was Sie wissen wollen, ist, wie alt diese Zahlen sind, nicht wann sie zuletzt
abgerufen wurden.

Die angezeigte Uhrzeit ist die **des Ortes selbst**: Eine Vorhersage liest man
nach der Uhr der Gemeinde, die sie abdeckt. Für einen Ort in Ihrer Zeitzone ist
das einfach Ihre Uhrzeit; für einen weiter entfernten ist es die dortige
Ortszeit. Deshalb sitzt dieser Messwert auch **auf jedem Gerät** und nicht auf
einem einzigen, das die ganze Integration teilt: Zwei Orte tragen nicht unbedingt
dieselbe.

Bleibt das Datum in der Vergangenheit hängen, schlägt die Aktualisierung fehl:
Die Schaltfläche **Pollenanbieter testen** zeigt für jeden Ort dasselbe Datum und
sagt, was schiefläuft, falls etwas schiefläuft.

## Die Risikoskala

**Es ist die Skala von Gladys, keine eigene.** Gladys kann vier Risikoniveaus
benennen, und Gladys schreibt die Bezeichnung neben den Messwert in der Box
„Geräte im Raum“:

| Niveau | Was Gladys anzeigt | Farbe  |
| ------ | ------------------ | ------ |
| 0      | Kein Risiko        | Grün   |
| 1      | Niedrig            | Gelb   |
| 2      | Mittel             | Orange |
| 3      | Hoch               | Rot    |

Die Integration veröffentlicht genau diese vier Niveaus und nichts anderes. So
sagen die Gerätebox, die Widgets, die Szenenauslöser und die Benachrichtigungen
alle dasselbe über dieselbe Zahl. Die Textmesswerte und die Widgets fügen dem Wort
die Skala hinzu — „2/3 (mittel)“ —, sodass Sie ein Niveau einordnen können, ohne
die Skala auswendig zu kennen.

Die CAMS-Daten folgen den Stufen des European Aeroallergen Network (EAN), das
sechs davon hat. Sie werden auf die vier Niveaus von Gladys gefaltet:

| EAN-Stufe (Textmesswert) | Veröffentlichter Index | Name in Gladys |
| ------------------------ | ---------------------- | -------------- |
| 0/5 (keine)              | 0                      | Kein Risiko    |
| 1/5 (sehr niedrig)       | 1                      | Niedrig        |
| 2/5 (niedrig)            | 1                      | Niedrig        |
| 3/5 (mittel)             | 2                      | Mittel         |
| 4/5 (hoch)               | 3                      | Hoch           |
| 5/5 (sehr hoch)          | 3                      | Hoch           |

Bei der Faltung geht nichts Wichtiges verloren: Die beiden ruhigen Stufen
bedeuten beide „es gibt kaum welche“, und die beiden starken bedeuten beide
„bleiben Sie drinnen, wenn Sie darauf reagieren“.

**Die gemessene Stufe bleibt lesbar**: Die „(Text)“-Messwerte des Geräts zeigen sie
unverändert, von 0 bis 5. Das ist der einzige Ort, an dem sie erhalten bleibt,
denn ein Text wird genau so angezeigt, wie er gespeichert wurde, während Gladys
eine Zahl mit seinen eigenen Worten neu beschriftet.

Das Niveau wird aus der Konzentration in Pollenkörnern pro Kubikmeter Luft
abgeleitet, mit **Schwellenwerten pro Art**: 30 Körner/m³ sind ein ruhiger Tag
für die Birke (Niveau 2), aber ein starker für Ambrosia (Niveau 3), deren
allergene Wirkung weit stärker ist.

## Sie kommen von einer Version mit 0-5?

Die ersten Versionen veröffentlichten die sechs EAN-Stufen unverändert, von 0 bis 5. Das funktionierte nicht: Gladys kann nur vier Niveaus benennen, daher erschien
ein Niveau 3 als „Hoch“, obwohl es „mittel“ bedeutete, und die Niveaus 4 und 5
erschienen als „Unbekannt“. Die veröffentlichte Skala ist jetzt die von Gladys.

Zwei Dinge sollten Sie nach dem Update prüfen:

- **Das Gerät.** Es erscheint im Tab **Entdecken** mit einer Schaltfläche
  **Aktualisieren**: Ein Klick genügt. Verlauf, Räume und Szenen bleiben erhalten.
- **Ihre Szenen.** Ein Auslöser oder eine Bedingung für Niveau 4 oder 5 trifft
  nichts mehr: Zielen Sie stattdessen auf Niveau 3 („hoch“). Ein Niveau 3, das
  „mittel“ bedeutete, wird zu einer 2.

Der bereits aufgezeichnete Verlauf behält seine alten Werte: In einem Diagramm über
den Wechsel hinweg liegen die Punkte davor auf der Skala 0-5 und die danach auf
der Skala 0-3. Es bleibt lesbar, aber ein Vergleich über diesen Zeitraum ist nicht
fair.

Die gemessene Stufe 0-5 ist aber nicht verschwunden: Sie ist das, was die
„(Text)“-Messwerte des Geräts neben dem Index anzeigen. Nur die Zahlen, die eine
Szene oder ein Diagramm liest, stehen auf der Skala 0-3.

## Die Sprache der Namen

Geräte- und Funktionsnamen werden **standardmäßig auf Französisch** geschrieben:
Die Messwerte heißen `Risque pollinique global`, `Risque pollinique — Bouleau`, und
der Hauptpollen erscheint als `Bouleau`. Stellen Sie **Sprache der Gerätenamen** im
Tab „Konfiguration“ auf Deutsch, um die Namen aus der Tabelle oben zu erhalten
(Englisch und Spanisch werden ebenfalls angeboten).

Warum eine Einstellung statt der Sprache Ihres Kontos? Alles, was die Integration
_anzeigt_ — die Nachricht unter einer Schaltfläche, der Status im Bildschirm
„Überwachung“ —, wird Gladys auf Englisch, Französisch, Deutsch und Spanisch
gesendet, und Gladys wählt die Sprache der lesenden Person. Ein Gerätename ist
keine Nachricht: Er ist ein einfacher Text, der so gespeichert wird, wie er am Tag
der Geräteerstellung ist, und nichts in der Integrations-API sagt, welche Sprache
Sie lesen. Daher wird er einmal hier gewählt.

Eine Folge: Eine Änderung der Einstellung benennt die Funktionen der **noch
anzulegenden** Geräte um. Ein bereits zu Gladys hinzugefügtes Gerät behält die
Namen, mit denen es angelegt wurde — löschen Sie es und fügen Sie es über den Tab
„Entdecken“ erneut hinzu, um es umzubenennen (sein Verlauf geht mit dem gelöschten
Gerät).

## Auf Ihrem Dashboard

Zwei Widgets werden mit der Integration geliefert. Fügen Sie sie von einem
Gladys-Dashboard aus hinzu: **Bearbeiten**, **Hinzufügen**, dann wählen Sie sie
aus der Liste.

### Pollen — ein Ort

Die Karte eines Ortes: das Gesamtniveau auf einer Messanzeige, eine Kachel
**Hauptpollen**, die die Art nennt, von der dieses Niveau stammt, das Risiko in
Worten — „3/3 (hoch)“ —, dann die tatsächlich in der Luft befindlichen Pollen, die
Kurve für heute und morgen und eine Schaltfläche **Aktualisieren**. Eine Art auf
null belegt keine Zeile: Eine Karte, die nichts zeigt, bedeutet, dass nichts in
der Luft ist, und sie sagt es — ohne Pollen in der Luft gibt es keinen Hauptpollen,
und die Kachel verschwindet.

Ist die Karte auf einige Arten beschränkt, beziehen sich der Hauptpollen und das
Risiko in Worten auf diese Arten, wie die Messanzeige.

Drei Einstellungen pro Karte:

| Einstellung                       | Wirkung                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ort**                           | Das anzuzeigende Gerät. Angeboten werden nur die Geräte, die Sie bereits über den Tab „Entdecken“ hinzugefügt haben.                       |
| **Verfolgte Pollenarten**         | Haken Sie die Arten an, auf die Sie reagieren: Messanzeige, Liste und Kurve berücksichtigen dann nur diese. Nichts angehakt bedeutet alle. |
| **Zwei-Tage-Vorhersage anzeigen** | Die stündliche Kurve. Entfernen Sie den Haken für eine kompakte Karte.                                                                     |

Die Kurve zeigt **heute und morgen**, Stunde für Stunde, mit einer Markierung zur
aktuellen Uhrzeit. Es ist eine Vorhersage: Gladys speichert keinen Verlauf davon,
daher wird sie zusammen mit dem aktuellen Niveau an der Quelle gelesen — in
derselben Anfrage —, und eine weniger als 30 Minuten alte Antwort wird
wiederverwendet, statt erneut angefragt zu werden. Bei vier oder weniger
verfolgten Arten erhält jede ihre eigene Kurve; darüber zeigt eine einzige Kurve
die schlimmste davon.

Wenn Sie alle Arten verfolgen, ist die Messanzeige an den Messwert des Geräts
selbst gebunden und folgt den veröffentlichten Werten in Echtzeit. Bei einer
Auswahl von Arten entspricht ihr kein Messwert — die Messanzeige zeigt dann die
von der Karte berechnete Zahl.

### Pollen — alle Orte

Eine Zeile pro konfiguriertem Ort, mit seinem Niveau und seinem Hauptpollen, und
eine Schaltfläche **Aktualisieren**, die alle erneut liest. Keine Einstellungen:
Die Karte zeigt die Liste, die der Tab „Konfiguration“ verwaltet. Sie endet nach
zehn Zeilen und sagt es.

Beide Karten werden in **der Sprache der Person geschrieben, die sie ansieht**:
Anders als bei einem Gerätenamen teilt Gladys uns hier mit, welche Sprache Sie
lesen.

## Das Risiko in einer Szene verwenden

Drei Wege, vom einfachsten zum feinsten.

### 1. Die Messwerte, wie jeder Sensor

Das Gesamtrisiko ist ein Messwert der Kategorie „Risiko“: Er verhält sich wie
jeder numerische Sensor. Einige Ideen:

- die Rollläden schließen oder die Lüftung abschalten, wenn das Gesamtrisiko
  über 3 steigt;
- morgens eine Benachrichtigung senden, wenn das Risiko „Gräser“ ≥ 4 ist;
- den Luftreiniger einschalten, wenn der Hauptpollen der ist, auf den Sie
  reagieren.

### 2. Die Auslöser

Im Szeneneditor, in der Kategorie **Integrationen**:

| Auslöser                                     | Wann er auslöst                                                    |
| -------------------------------------------- | ------------------------------------------------------------------ |
| **Gesamtes Pollenrisiko hat sich geändert**  | Das Gesamtniveau eines Ortes wechselt von einem Niveau zum anderen |
| **Pollenrisiko einer Art hat sich geändert** | Das Niveau einer Pollenart ändert sich an einem Ort                |

Beide lösen **nur bei einer Änderung** aus, nie bei jeder Aktualisierung: Die
CAMS-Vorhersage wird einmal täglich neu veröffentlicht, eine Szene, die bei jedem
Lesen auslöst, würde also vierundzwanzigmal für denselben Wert auslösen.

Jeder Auslöser lässt sich filtern: der **Ort** (leer bedeutet jeder), die
**Niveaus**, die Sie interessieren (haken Sie 3 an, um nur auf Spitzen zu
reagieren), die **Richtung** (steigend, um die Fenster zu schließen, fallend, um
sie wieder zu öffnen), und beim zweiten die **Arten**.

Die Szene erhält dann, was sie zum Schreiben ihrer Nachricht braucht:
`{{triggerEvent.data.summary}}` enthält den fertigen Satz „Pollen in Montauban:
Risiko 3/3 (hoch), vorherrschend Birke.“, und `location_name`, `level`,
`level_label`, `previous_level`, `direction`, `taxon`, `taxon_name` und
`measured_at` stehen einzeln zur Verfügung.

Zwei Details:

- **beim Start löst nichts aus**: Das vorherige Niveau ist dann unbekannt, und
  „unbekannt → 3“ ist keine Änderung. Die erste echte Änderung löst normal aus;
- **eine Art ohne Wert löst nichts aus**: Ein fehlender Messwert ist kein Rückfall
  auf null, und das letzte bekannte Niveau bleibt erhalten.

### 3. Die Aktionen

Ebenfalls im Szeneneditor, unter **Integrationen**:

| Aktion                        | Wirkung                                                                                                        |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Pollenrisiko lesen**        | Liest einen Ort sofort und übergibt das Niveau, den Hauptpollen und den fertigen Satz an die nächsten Aktionen |
| **Pollendaten aktualisieren** | Liest die Vorhersage erneut und veröffentlicht die Messwerte neu; lassen Sie den Ort leer für alle Orte        |

„Pollenrisiko lesen“ macht aus „jeden Morgen um 7 Uhr“ ein „jeden Morgen um 7 Uhr,
sag mir das Risiko“: Wählen Sie den Ort, lassen Sie **Gesamtrisiko** (oder wählen
Sie eine Art) und senden Sie dann eine Nachricht mit der Ausgabe `summary`. Die
Ausgaben `level` (0 bis 3), `level_label`, `taxon`, `taxon_name`, `concentration`,
`location_name` und `measured_at` stehen bereit, wenn Sie lieber Ihren eigenen
Satz schreiben.

> Wenn die Quelle nichts antwortet, schlägt die Aktion nicht fehl: Sie gibt ein
> leeres `level` und eine `summary` zurück, die sagt, dass die Daten nicht
> verfügbar sind. Was damit geschieht, entscheidet die Szene.

## Aktualisierungsintervall

Jeder Ort wird standardmäßig stündlich aktualisiert. Die CAMS-Vorhersage wird
einmal täglich neu berechnet und stündlich interpoliert, unter einer Stunde
bringt es also nichts. Das Intervall lässt sich im Tab „Konfiguration“ zwischen
15 Minuten und 24 Stunden einstellen. Ein gerade angelegtes Gerät wird sofort
aktualisiert — nur sein Ort —, ohne auf den nächsten Zyklus zu warten.

Einige Dinge sorgen dafür, dass die Integration beide Dienste schont:

- **Alle Ihre Orte werden in einer einzigen Anfrage** an Open-Meteo gelesen, und
  eine weniger als 30 Minuten alte Antwort wird von den Dashboard-Karten und den
  Szenenaktionen wiederverwendet, statt erneut angefragt zu werden.
- **Eine Aktualisierung nach der anderen**: Eine Schaltfläche, die während einer
  laufenden Aktualisierung gedrückt wird, wartet auf diese oder schließt sich ihr
  an, statt eine zweite zu starten.
- **Eine Wiederverbindung oder ein gespeichertes Formular liest nicht alles neu**,
  wenn die letzte Aktualisierung kurz zurückliegt: Der Zyklus läuft einfach in
  seinem gewohnten Takt weiter.
- **Die Messwerte werden Gladys in seinem eigenen Takt gesendet**: Gladys nimmt 300
  Werte pro Minute und Integration an, und jeder Ort veröffentlicht 16. Zwanzig
  Orte werden daher über zwei Minuten gesendet statt auf einmal, und eine Antwort
  „zu viele Anfragen“ von Gladys wird einmal wiederholt.
- **Eine Quelle, die stockt** (ausgelastet, Neustart), wird einige Sekunden später
  noch einmal gefragt, bevor die Aktualisierung als fehlgeschlagen gilt.

## Geografische Abdeckung

Die CAMS-Vorhersage deckt das **europäische Gebiet** ab. Ein Ort außerhalb dieses
Gebiets wird beim Hinzufügen abgelehnt, statt ein Gerät anzulegen, das nie einen
Wert hätte.

## Fehlerbehebung

- **Schaltfläche „Pollenanbieter testen“**: Sie fragt die Quelle für _jeden_ Ort ab
  (eine weniger als 30 Minuten alte Antwort wird wiederverwendet) und gibt eine
  Zeile pro Ort aus, nummeriert wie die Liste. Jede Zeile endet mit dem Datum der
  gelesenen Daten, sodass eine in der Vergangenheit hängende Quelle auch hier
  auffällt. Der schnellste Weg, ein Netzwerkproblem von einem
  Konfigurationsproblem zu unterscheiden.
- **Der Bildschirm „Überwachung“** sagt, _wer_ fehlgeschlagen ist:
  „Pollenvorhersage nicht verfügbar“ ist die Quelle (Open-Meteo), „Ratenlimit von
  Gladys erreicht“ oder „Gladys hat die Zustände nicht akzeptiert“ ist Ihr
  Gladys — die Quelle trifft dann keine Schuld, und die nächste Aktualisierung
  veröffentlicht die Werte.
- **Die Protokolle**: Lesen Sie die Protokolle der Integration in der Oberfläche
  von Gladys oder mit `docker logs`. Setzen Sie `LOG_LEVEL` auf `debug`, um jede
  Anfrage an die Quelle und die genaue an Gladys gesendete Gerätenutzlast zu
  sehen. Die Koordinaten Ihrer Orte erscheinen nie in den Protokollen, auf keiner
  Stufe.
- **Im Tab „Entdecken“ erscheint nichts**: Prüfen Sie den Status der Integration im
  Bildschirm „Überwachung“ — lehnt Gladys ein Gerät ab, wird der Grund dort
  gemeldet.
- **Ein Gerät bleibt leer**: Prüfen Sie, ob sein Ort noch von „Meine Orte
  anzeigen“ aufgelistet wird. Ein Gerät, dessen Ort entfernt wurde, wird nicht
  mehr aktualisiert.

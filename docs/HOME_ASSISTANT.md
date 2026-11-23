# Home Assistant mit der MuPiBox (Fork mit Spotify-Live-Suche)

Diese Anleitung bringt dich Schritt für Schritt dahin, dass **Home Assistant dir meldet, wenn sich das Kind in der Suche am
Display etwas wünscht** – und dass du die Box dort auch abspielen und steuern kannst. Sie ist für Leute geschrieben, die
Home Assistant (HA) nur wenig kennen. Jeder Schritt sagt, wo du klickst und wonach du suchst.

> **Was ist von wem?**
> Die Integration „MuPiBox“ für Home Assistant stammt **von splitti** und dem MuPiBox-Team
> ([splitti/MuPiBox-homeassistant](https://github.com/splitti/MuPiBox-homeassistant)). Dieser Fork ergänzt sie nur um **drei
> kleine Dateien**, damit die Wünsche aus der Suche in Home Assistant ankommen. Alles andere – Steuern, Anzeigen, Koppeln –
> macht das Original, und auf dessen Anleitung wird hier verwiesen.

Inhalt: [Überblick](#überblick) · [A Integration installieren](#teil-a--die-integration-von-splitti-installieren) ·
[B Box koppeln](#teil-b--die-box-für-home-assistant-freigeben-und-koppeln) ·
[C Erweiterung einspielen](#teil-c--die-wünsche-erweiterung-einspielen) · [D Testen](#teil-d--testen) ·
[E Helfer, Automationen, Dashboard](#teil-e--helfer-automationen-und-dashboard) ·
[F Mehrere Boxen, Updates, Hilfe](#teil-f--mehrere-boxen-updates-und-fehlersuche) · [Datenschutz](#was-wohin-geschickt-wird)

---

## Überblick

```
 Kind wünscht sich etwas          Box (dieser Fork)             Home Assistant
 am Display der Box   ───────►   merkt sich den Wunsch   ◄───── fragt alle 15 s: "Was Neues?"
                                  (Liste "search_events")        feuert das Ereignis
                                                                 mupibox_search_event
                                                                        │
                                                          deine Automation: Meldung, Zähler, Logbuch
```

Home Assistant **fragt** die Box (die Box schickt nichts von selbst nach außen). Pro Wunsch entsteht in Home Assistant ein
Ereignis (`mupibox_search_event`) mit einem fertigen deutschen Satz, z. B.
*„Beispiel-Album“ (Beispiel-Band) unter Hörspiele. Freigeben: https://…/app/#/wuensche*.
Darauf baust du Automationen auf. Wenn du nur die Box steuern willst und keine Wunsch-Meldungen brauchst, genügen Teil A und B.

**Das brauchst du**

| | |
|---|---|
| MuPiBox mit diesem Fork | Fork installiert, Stand `fork-2026-11-23-spotify-live-suche` oder neuer – siehe [INSTALLATION.md](INSTALLATION.md) |
| Home Assistant | Version **2024.10 oder neuer**, im selben Heimnetz wie die Box |
| HACS | der Store für Zusatz-Integrationen in Home Assistant ([Anleitung von HACS](https://www.hacs.xyz/docs/use/)) |
| Zugriff auf die Dateien von Home Assistant | eines davon: Add-on **File editor**, **Studio Code Server**, **Terminal & SSH** oder die Samba-Freigabe (Teil C) |

---

## Teil A – Die Integration von splitti installieren

Die Schritte stehen ausführlich in der [README der Integration](https://github.com/splitti/MuPiBox-homeassistant#install-from-hacs).
Kurz:

1. In Home Assistant links **HACS** öffnen und nach **MuPiBox** suchen.
2. Die Integration wählen und **Herunterladen**.
3. Home Assistant **neu starten** (*Einstellungen › System › Neu starten*; oben rechts das Symbol ⏻).
4. *Einstellungen › Geräte & Dienste*: Meist steht dort schon **„Entdeckt: MuPiBox“** – auf **Konfigurieren** tippen.
   Wird nichts entdeckt: **+ Integration hinzufügen › MuPiBox** und die Adresse der Box mit **Port 8443** eintragen
   (z. B. `192.168.x.y`; die Adresse zeigt dir die MuPiBox-App auf der Seite *Einstellungen › Dienste › Home Assistant*).

Du bist noch nicht fertig: die Integration muss die Box erst **koppeln** (Teil B).

> **Wichtig für Teil C:** Der Fork passt zu Version **0.5.3** der Integration. Die Zahl steht in HACS bei „MuPiBox“ und in
> der Datei `manifest.json` (`"version": "0.5.3"`). Ist deine Version neuer, lies bitte zuerst [Teil F](#nach-einem-update-der-integration).

---

## Teil B – Die Box für Home Assistant freigeben und koppeln

Das macht man **an der Box in der MuPiBox-App** und in Home Assistant gleichzeitig; öffne beides nebeneinander.

**In der MuPiBox-App** (im Browser: `http://<Adresse-der-Box>/app/`):

1. *Einstellungen › Dienste › Home Assistant* öffnen.
2. Den Schalter **Home Assistant erlauben** einschalten. Darunter erscheint „Bereit unter https://…:8443“.
   (Steht dort eine Warnung wegen *MQTT-Discovery*: dann ist die Box sonst schon über MQTT in Home Assistant; eines von beiden
   ausschalten, sonst erscheint sie doppelt.)
3. Bei **Koppeln** auf **Schlüssel kopieren** tippen. Das ist der „Fingerabdruck“ der Box (64 Zeichen).

**In Home Assistant** (die Integration „MuPiBox“ aus Teil A, Schritt 4):

4. Wenn Home Assistant nach dem **Fingerabdruck (SHA-256)** fragt, den kopierten Schlüssel einfügen.
   Home Assistant zeigt ihn zur Kontrolle an; er muss mit der App übereinstimmen. Nie einen Schlüssel von woanders einfügen.
5. Die Berechtigungen wählen. **Anzeigen** und **Steuern** sind immer dabei. Für die Wunsch-Meldungen brauchst du nichts
   Zusätzliches. Optional: *Nachrichten und Ansagen* (Text oder Sprache auf der Box) und *Neu starten & Ausschalten*.
6. In der **MuPiBox-App** bei **Koppeln** auf **Koppeln erlauben (60 s)** tippen. Die Box zeigt dir am **Display** einen
   **sechsstelligen Code** an.
7. Den Code in Home Assistant eingeben. Das Koppeln ist nur kurz erlaubt (60 Sekunden); ist die Zeit abgelaufen, in der App
   erneut „Koppeln erlauben“ tippen.

Fertig, wenn in der App unter **Gekoppelt** dein Home Assistant steht und in Home Assistant unter
*Einstellungen › Geräte & Dienste › MuPiBox* ein Gerät mit deinen Sensoren und einem **Player** zu sehen ist.

> Kein MuPiBox-Admin-Passwort nötig – und keinen Schlüssel, Code oder Token in Fehlermeldungen oder Issues einfügen.

---

## Teil C – Die Wünsche-Erweiterung einspielen

Jetzt kommen die **drei Dateien** dieses Forks in die Integration. Du brauchst sie aus diesem Repository:

| Datei | Link |
|---|---|
| `search_events.py` (**neu**) | [Ordner ansehen](../homeassistant/wishes-extension/custom_components/mupibox/search_events.py) |
| `coordinator.py` (**ersetzt** die vorhandene) | [Ordner ansehen](../homeassistant/wishes-extension/custom_components/mupibox/coordinator.py) |
| `v1_api.py` (**ersetzt** die vorhandene) | [Ordner ansehen](../homeassistant/wishes-extension/custom_components/mupibox/v1_api.py) |

Auf GitHub öffnest du eine Datei, tippst oben rechts auf **Raw** und kannst den ganzen Text kopieren oder die Datei mit
**Download raw file** speichern.

### Wo liegen die Dateien in Home Assistant?

Die Integration von HACS liegt im Konfigurationsordner von Home Assistant, der **`/config`** heißt:

```
/config/custom_components/mupibox/
    manifest.json          ← steht schon da (Version 0.5.3)
    coordinator.py         ← diese Datei ERSETZEN
    v1_api.py              ← diese Datei ERSETZEN
    search_events.py       ← diese Datei NEU anlegen
    api.py, sensor.py, …   ← bleiben unberührt
```

Findest du den Ordner nicht, ist die Integration nicht (vollständig) installiert – zurück zu Teil A (nach dem Herunterladen
in HACS fehlt oft nur der Neustart).

### Weg 1 – mit dem Add-on „File editor“ (für Einsteiger)

1. *Einstellungen › Add-ons › Add-on-Store*: **File editor** suchen, **Installieren**, **Starten**, „In Seitenleiste anzeigen“ an.
2. Im File editor oben links das Ordner-Symbol, dann zu `/config/custom_components/mupibox/` gehen.
3. **Sicherung:** `coordinator.py` und `v1_api.py` einzeln öffnen, den ganzen Text markieren und in einer Textdatei auf deinem
   Rechner sichern. So kannst du später zurück. (Wer das nicht möchte: in HACS lässt sich die Integration jederzeit neu
   herunterladen und ersetzt die Dateien wieder durch die Originale.)
4. `coordinator.py` im Editor öffnen, **alles löschen** (Strg + A, Entf), den Text der neuen Datei einfügen, **Speichern**
   (Diskette oben rechts).
5. Dasselbe mit `v1_api.py`.
6. **Neue Datei:** im Ordner-Menü *Neue Datei* wählen, Name `search_events.py`, den Text einfügen, speichern.

Pythondateien reagieren empfindlich auf Leerzeichen am Zeilenanfang. Kopiere deshalb den **ganzen** Text unverändert und
tippe nichts dazu.

### Weg 2 – mit dem Add-on „Terminal & SSH“ (schneller)

Im Terminal diese Zeilen nacheinander einfügen (Zeilen mit `#` sind Hinweise):

```shell
mkdir -p /config/mupibox-sicherung
cp /config/custom_components/mupibox/coordinator.py /config/custom_components/mupibox/v1_api.py /config/mupibox-sicherung/
cd /config/custom_components/mupibox
BASIS=https://raw.githubusercontent.com/fetredlwl/MuPiBox/wishes/homeassistant/wishes-extension/custom_components/mupibox
curl -fsSLO "$BASIS/coordinator.py"
curl -fsSLO "$BASIS/v1_api.py"
curl -fsSLO "$BASIS/search_events.py"
ls -l
```

`ls -l` soll nun die drei Dateien mit dem heutigen Datum zeigen.

### Weg 3 – über die Samba-Freigabe (Windows-Explorer)

Das Add-on **Samba share** installieren und starten. Im Explorer `\\homeassistant\config` öffnen (oder `\\<Adresse-von-HA>\config`),
nach `custom_components\mupibox` gehen und die drei Dateien dorthin kopieren (die zwei vorhandenen überschreiben, vorher
eine Kopie davon anlegen).

### Neu starten

*Einstellungen › System › Neu starten › **Home Assistant neu starten*** (nicht nur „Konfiguration neu laden“).
Danach in *Einstellungen › System › Protokolle* nach `mupibox` suchen: Fehlermeldungen in roter Schrift darf es nicht
geben. (Eine Zeile „Search pool events unavailable“ in einer Debug-Ansicht ist harmlos.)

---

## Teil D – Testen

1. In Home Assistant *Entwicklerwerkzeuge › Ereignisse* öffnen (*Developer tools › Events*).
2. Unten bei **Ereignisse abhören** den Namen `mupibox_search_event` eintragen und **Abhören starten**.
3. Am Display der Box in der **Suche** die Kachel **„Bei Spotify suchen“** antippen, ein Album suchen und es **wünschen**
   (oder: etwas aus den Podcast-Tipps auf die Startseite holen).
4. Innerhalb von etwa 15 Sekunden erscheint im Fenster ein Ereignis, etwa so (hier mit **erfundenen** Daten):

```json
{
  "event_type": "mupibox_search_event",
  "data": {
    "box": "MuPiBox Kinderzimmer",
    "id": 12,
    "what": "wish",
    "kind": "album",
    "kind_label": "Album",
    "name": "Beispiel-Album",
    "artist": "Beispiel-Band",
    "category": "audiobook",
    "category_label": "Hörspiele",
    "message": "„Beispiel-Album“ (Beispiel-Band) unter Hörspiele. Freigeben: https://192.168.x.y/app/#/wuensche",
    "url": "https://192.168.x.y/app/#/wuensche"
  }
}
```

| Feld | Bedeutung |
|---|---|
| `what` | `wish` = gewünscht (wartet auf dich) · `added` = das Kind hat es auf die Startseite geholt (ein Song: in eine Playlist gelegt) · `removed` = das Kind hat es entfernt (ein Song: aus der Playlist genommen) · `created` = das Kind hat eine neue Playlist angelegt |
| `kind` / `kind_label` | `album`, `artist`, `playlist`, `podcast`, `radio`, `track` (ein einzelner Song) / das deutsche Wort dazu |
| `playlist` | bei einem Song: der Name der Playlist, in die er soll (sonst leer) |
| `name`, `artist` | Titel und Künstler |
| `category` / `category_label` | der Reiter: `audiobook` = Hörspiele, `music` = Musik, `other` = Radio |
| `message` | fertiger deutscher Satz, bei Wünschen mit Link zur Freigabe |
| `url` | Link zur Seite *Wünsche* in der MuPiBox-App (nur bei Wünschen) |
| `box` | Name der Box (wichtig, wenn du mehrere hast) |
| `id`, `at` | laufende Nummer und Zeit der Box |

Kommt nichts an: [Fehlersuche in Teil F](#nichts-kommt-an).

---

## Teil E – Helfer, Automationen und Dashboard

Du bekommst eine fertige Datei, die **Helfer** und **Automationen** auf einmal mitbringt:
[`mupibox_wuensche_package.yaml`](../homeassistant/wishes-extension/examples/mupibox_wuensche_package.yaml). Darin stecken:

| Was | Name | Wozu |
|---|---|---|
| Helfer (Schalter) | `input_boolean.mupibox_wunsch_meldung` | Meldungen an/aus (z. B. im Urlaub aus) |
| Helfer (Zähler) | `counter.mupibox_neue_wuensche` | zählt die Wünsche seit dem letzten Zurücksetzen |
| Helfer (Text) | `input_text.mupibox_letzter_wunsch` | der letzte Wunsch als Satz |
| Helfer (Datum/Zeit) | `input_datetime.mupibox_letzter_wunsch_zeit` | wann er kam |
| Automation | „MuPiBox – neuer Wunsch“ | zählt, merkt, meldet (Benachrichtigung in Home Assistant, optional aufs Handy) |
| Automation | „MuPiBox – Kind holt oder entfernt etwas“ | schreibt ins **Logbuch**, was das Kind selbst geholt oder entfernt hat, Songs in seinen Playlists und neue Playlists |
| Automation | „MuPiBox – Erinnerung an Wünsche“ | 18:00 Uhr, wenn noch Wünsche gezählt sind |

### Variante 1: als Paket (eine Datei, am schnellsten)

1. Im **File editor** (oder Studio Code Server) die Datei `/config/configuration.yaml` öffnen und ganz oben prüfen, ob dort
   `homeassistant:` steht. Dann das Folgende **darunter** einrücken, sonst als eigenen Block anfügen:

   ```yaml
   homeassistant:
     packages: !include_dir_named packages
   ```

   (Steht dort schon eine Zeile mit `packages:`, ist der Schritt schon erledigt.)
2. Im Ordner `/config` einen neuen Ordner **`packages`** anlegen.
3. In `packages` eine neue Datei **`mupibox_wuensche.yaml`** anlegen und den Inhalt von
   [`mupibox_wuensche_package.yaml`](../homeassistant/wishes-extension/examples/mupibox_wuensche_package.yaml) einfügen, speichern.
4. *Entwicklerwerkzeuge › YAML › Konfiguration prüfen*: muss „Konfiguration gültig“ zeigen.
5. Home Assistant **neu starten**.
6. Den Schalter einmal einschalten: *Einstellungen › Geräte & Dienste › Helfer › MuPiBox Wunsch-Meldungen* öffnen und
   einschalten (er startet „aus“, damit nichts ungefragt meldet).

### Variante 2: alles von Hand in der Oberfläche

*Einstellungen › Geräte & Dienste › Helfer › + Helfer erstellen* legt Schalter, Zähler, Text und Datum/Zeit an
(Namen wie in der Tabelle). Eine Automation entsteht über *Einstellungen › Automationen & Szenen › + Automation erstellen › Neue
Automation*; oben rechts im Menü **⋮ › In YAML bearbeiten**, den Block einer Automation aus der Paketdatei einfügen
(nur ihren Teil unter `automation:`, ohne die Zeile `automation:` selbst).

### Meldung aufs Handy (optional)

Installiere die **Home Assistant Companion App** auf dem Handy und melde dich an. Dann gibt es in Home Assistant eine Aktion
`notify.mobile_app_<name-deines-handys>`. Ihren Namen findest du unter *Entwicklerwerkzeuge › Aktionen*, wenn du dort
`notify.mobile` eintippst. In der Automation „neuer Wunsch“ steht im Kommentar ein fertiger Block: das `#` vorne entfernen und
`DEIN_HANDY` ersetzen. Mit `url:`/`clickAction:` öffnet ein Tipp auf die Meldung gleich die Freigabe-Seite der MuPiBox-App.
Hinweis: Die App der Box hat ein selbst ausgestelltes Zertifikat; der Browser fragt beim ersten Mal nach, ob er der Seite
vertrauen soll.

### Dashboard

1. Ein Dashboard öffnen, oben rechts **⋮ › Bearbeiten**, dann **+ Karte hinzufügen › Manuell**.
2. Den Inhalt von [`dashboard_wuensche.yaml`](../homeassistant/wishes-extension/examples/dashboard_wuensche.yaml) einfügen.
3. Zwei Stellen anpassen (im Text mit *EINTRAGEN* markiert):
   - `https://ADRESSE-DER-BOX/app/#/wuensche` → die Adresse, mit der du die MuPiBox-App im Browser öffnest.
   - `media_player.DEINE_BOX` → die Entity-ID des Players. Sie steht unter *Einstellungen › Geräte & Dienste › MuPiBox ›
     deine Box › Player* (auf das Zahnrad tippen: „Entity-ID“).
4. **Speichern**.

Du siehst dann: neue Wünsche (Zähler) mit **Zurücksetzen**-Knopf, den letzten Wunsch, den Meldungsschalter, einen Link zur
Freigabe in der App und die Wiedergabe-Karte. Weitere Karten (Akku, Netzwerk, Audioausgabe, Bildschirmfoto) findest du in den
[Dashboard-Vorlagen von splitti](https://github.com/splitti/MuPiBox-homeassistant/blob/main/docs/DASHBOARD.md); dort steht auch
die Tabelle, welche Entity du für welche Karte brauchst.

### Weitere Ideen (zum Selbstbauen)

- **Licht oder Lautsprecher blinken lassen**, wenn ein Wunsch kommt: in der Automation eine weitere Aktion anhängen.
- **Nur zu bestimmten Zeiten melden:** eine Bedingung `condition: time` mit `after`/`before` ergänzen.
- **Zwei Boxen unterscheiden:** im Ereignis steht `box`; in der Bedingung `{{ trigger.event.data.box == 'MuPiBox Kinderzimmer' }}`.

---

## Teil F – Mehrere Boxen, Updates und Fehlersuche

### Mehrere Boxen

Jede Box wird einzeln gekoppelt (Teil B). Die Erweiterung (Teil C) und das Paket (Teil E) braucht man nur **einmal**: Die
Ereignisse aller Boxen laufen in dieselbe Automation und tragen den Namen der Box im Feld `box` (und in der Meldung).

### Nach einem Update der Integration

HACS kann die Integration aktualisieren; dabei werden **`coordinator.py` und `v1_api.py` wieder durch die Originale ersetzt**, und
die Wunsch-Meldungen hören auf. Dann:

1. In `/config/custom_components/mupibox/manifest.json` die Version ansehen.
2. Ist sie noch **0.5.3**: Teil C noch einmal ausführen. (`search_events.py` bleibt liegen.)
3. Ist sie **neuer**: schau in den [Release-Notes](../RELEASE_NOTES.md) nach, ob es schon eine passende Version der Erweiterung gibt. Die zwei Dateien einer
   neueren Version einfach zu überschreiben **kann die Integration beschädigen** – im Zweifel die Dateien aus der Sicherung
   (`/config/mupibox-sicherung/`) zurückspielen oder in HACS die Version 0.5.3 wählen (*MuPiBox › ⋮ › Neu herunterladen › Version wählen*).
   Ohne die Erweiterung läuft alles andere der Integration weiter.

### Erweiterung wieder entfernen

`coordinator.py` und `v1_api.py` aus der Sicherung zurückkopieren (oder in HACS „Neu herunterladen“), `search_events.py` löschen,
Home Assistant neu starten.

### Nichts kommt an

Von vorn nach hinten prüfen:

1. **Läuft die Box mit dem Fork?** *App › Einstellungen › System › Updates*: bei „Installiert“ muss `FORK …` stehen.
2. **Sind „Suche auf dem Display“ und „Wünsche aus Spotify“ an?** *App › Einstellungen › Display & Bedienung › Suche am Display*.
   Ohne den ersten Schalter gibt es am Display keine Lupe.
3. **Ist Home Assistant gekoppelt?** *App › Einstellungen › Dienste › Home Assistant*: unter „Gekoppelt“ muss er stehen, „Bereit unter …“ grün.
4. **Liegen die drei Dateien richtig?** Teil C, `ls -l` im Ordner. Und wurde Home Assistant danach **neu gestartet**?
5. **Fehler im Protokoll?** *Einstellungen › System › Protokolle*, Suchwort `mupibox`.
6. **Beim allerersten Start** meldet die Erweiterung nur, *ab jetzt* – was vorher war, wird nicht nachträglich gemeldet. Neuen Wunsch auslösen.
7. **Nach einem Neustart von Home Assistant** holt sie nach, was inzwischen passiert ist (die zuletzt gesehene Nummer wird in
   `/config/.storage/mupibox_search_events_…` gemerkt).

Der einfachste Test ist das Abhören des Ereignisses in [Teil D](#teil-d--testen): Kommt dort nichts an, liegt es an einem der
Punkte oben; kommt dort etwas an, aber keine Meldung, liegt es an der Automation (*Einstellungen › Automationen & Szenen* –
dort bei „MuPiBox – neuer Wunsch“ auf **Ablaufverfolgungen** tippen, dann siehst du, an welchem Schritt es hängt, und ob der
Schalter „MuPiBox Wunsch-Meldungen“ an ist).

---

## Was wohin geschickt wird

- Alles läuft **im Heimnetz** zwischen Box und Home Assistant, verschlüsselt (HTTPS, Port 8443, geprüfter Fingerabdruck).
- Ins **Internet** geht durch diese Erweiterung nichts. Spotify wird weiterhin nur von der Box gefragt.
- Im Ereignis stehen der **Name der Box**, **Titel und Künstler** des Wunsches und ein **Link auf die Box im Heimnetz**.
  Wenn du Meldungen aufs Handy schickst (Companion App), laufen sie über die Push-Dienste von Google bzw. Apple – der Satz mit
  Titel und Link ist dann Teil der Meldung. Wer das nicht möchte, nimmt nur die Meldung in Home Assistant selbst.
- **Teile nie**: den Schlüssel/Fingerabdruck, sechsstellige Kopplungscodes, Zugangstoken, die Adresse deiner Box oder Home Assistant
  in Fehlerberichten, Issues oder Bildschirmfotos. Ersetze sie durch Platzhalter wie `192.168.x.y`.

---

## Dank

Integration, Kopplung und Dashboard-Vorlagen: **splitti** und das MuPiBox-Team
([MuPiBox-homeassistant](https://github.com/splitti/MuPiBox-homeassistant), [mupibox.de](https://mupibox.de)). Dieser Fork steuert nur die
drei Dateien der Wünsche-Erweiterung und diese Anleitung bei und wird vom MuPiBox-Team nicht betreut.

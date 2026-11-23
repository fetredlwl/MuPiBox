# Den Fork auf einer MuPiBox installieren

Diese Anleitung zeigt, wie du eine **laufende Standard-MuPiBox** auf diesen Fork (Spotify-Live-Suche, Wünsche, Kinder-Podcasts
und -Radio) bringst. Sie ist so geschrieben, dass du sie für **jede weitere Box** noch einmal Schritt für Schritt abarbeiten kannst.

> **Was ist von wem?** Die MuPiBox und fast der gesamte Code stammen von **splitti** und dem MuPiBox-Team
> ([splitti/MuPiBox](https://github.com/splitti/MuPiBox), [mupibox.de](https://mupibox.de)). Dieser Fork ist eine Ergänzung und wird
> vom MuPiBox-Team nicht betreut. Fragen dazu bitte in den [Issues dieses Forks](https://github.com/fetredlwl/MuPiBox/issues).

**Inhalt:** [1 Voraussetzungen](#1-voraussetzungen) · [2 Sicherung](#2-vorher-eine-sicherung-machen) ·
[3 Per SSH verbinden](#3-mit-der-box-per-ssh-verbinden) · [4 Installieren](#4-den-fork-installieren) ·
[5 Prüfen](#5-prüfen-ob-es-geklappt-hat) · [6 Einrichten](#6-die-neuen-funktionen-einrichten) ·
[7 Weitere Boxen](#7-weitere-boxen) · [8 Später aktualisieren und zurück](#8-später-aktualisieren-und-zurück) ·
[9 Hilfe](#9-wenn-etwas-nicht-klappt)

---

## 1 Voraussetzungen

- Eine **funktionierende MuPiBox** (Version 5.x), die du schon einmal nach der [Anleitung des Originals](https://mupibox.de/anleitungen/installationsanleitung/einfache-installation/)
  eingerichtet hast. Diese Anleitung ersetzt die Erstinstallation der Box **nicht**.
- Die Box ist im **Heimnetz** und hat **Internet** (die Dateien kommen von GitHub).
- Die Box hängt am **Netzteil** (nicht am Akku): Die Installation dauert 10 bis 30 Minuten, in denen die Box nicht nutzbar ist.
- Ein Rechner im selben Netz mit einem Terminal:
  - **Windows 10/11:** *PowerShell* (Startmenü, „PowerShell“ eintippen) – `ssh` ist schon eingebaut.
  - **Mac/Linux:** das Programm *Terminal*.
- Die **Adresse der Box** (`192.168.x.y` oder ein Name wie `mupibox.local`) und das **Passwort** des Benutzers `dietpi`.
  Die Adresse siehst du in der Geräteliste deines Routers; das Passwort ist das, das du bei der Einrichtung der Box vergeben
  hast bzw. das in der Anleitung des Originals steht.
  Ist SSH auf deiner Box ausgeschaltet, schalte es nach der Anleitung des Originals ein.

> In dieser Anleitung steht `<Adresse-der-Box>` für deine Adresse. **Schreibe sie nirgends öffentlich hin** (Issues, Foren,
> Bildschirmfotos); nimm dort `192.168.x.y`.

---

## 2 Vorher eine Sicherung machen

Einstellungen und Bibliothek bleiben bei der Installation erhalten, und die Box sichert vorher selbst. Eine **eigene Sicherung
auf deinen Rechner** kostet zwei Minuten und lohnt sich trotzdem:

1. Die MuPiBox-App im Browser öffnen: `http://<Adresse-der-Box>/app/`.
2. *Einstellungen › System › Backup* öffnen und das Backup **herunterladen**.
3. Die Datei an einem sicheren Ort aufbewahren (sie enthält deine Einstellungen – nicht weitergeben).

Willst du die Version vorher notieren: *Einstellungen › System › Updates*, oben steht bei **Installiert** die jetzige Version.

---

## 3 Mit der Box per SSH verbinden

Im Terminal (PowerShell):

```shell
ssh dietpi@<Adresse-der-Box>
```

- Beim ersten Mal fragt das Terminal „Are you sure you want to continue connecting?“ – mit `yes` und Enter bestätigen.
- Dann das Passwort eingeben (die Eingabe bleibt unsichtbar, das ist normal) und Enter.
- Es erscheint die Eingabeaufforderung der Box, etwa `dietpi@MuPiBox:~$`.

Zur Kontrolle, welche Version läuft:

```shell
jq -r .mupibox.version /etc/mupibox/mupiboxconfig.json
```

Es kommt z. B. `5.0.17 stable` (oder `DEV …`). Merke dir die Zeile.

---

## 4 Den Fork installieren

Die Installation läuft **als eigener Systemdienst** auf der Box. Das ist wichtig: Sie dauert 10 bis 30 Minuten und hält dabei
den Server der Box an (über ihn läuft auch das DietPi-Dashboard) und startet das Dashboard neu. Startet man das Skript direkt
in einem Terminal, wird es **mitten drin beendet**:

- im **Terminal des DietPi-Dashboards**, weil das Dashboard dabei neu startet und sein Terminal mitnimmt;
- per **SSH**, wenn die Verbindung abbricht (WLAN-Aussetzer, Laptop zugeklappt, Fenster zu).

Als Dienst läuft die Installation unabhängig von jedem Fenster weiter. Mit den zwei Befehlen unten ist es deshalb egal, ob du
sie per SSH oder im Dashboard-Terminal eingibst; nur **direkt** darfst du das Skript in keinem von beiden starten.

Stände heißen *Tags* (feste, getestete Stände); die Liste steht in den [Release-Notes](../RELEASE_NOTES.md).
**Empfohlen: der letzte getestete Stand** `fork-2026-11-23-spotify-live-suche`. Die zwei Befehle **einzeln, nacheinander** einfügen.

**Schritt 1 – das Installationsskript des Forks laden** (es wird nur gespeichert, noch nicht ausgeführt):

```shell
cd; curl -fsSL -o fork-update.sh https://raw.githubusercontent.com/fetredlwl/MuPiBox/fork-2026-11-23-spotify-live-suche/update/start_mupibox_update.sh
```

Kontrolle: `ls -l fork-update.sh` zeigt eine Datei mit einigen zehntausend Byte (nicht 0 und keine Fehlermeldung).

**Schritt 2 – als Dienst starten:**

```shell
sudo systemd-run --unit=mupibox-fork-install --collect --setenv=TERM=xterm --working-directory=/home/dietpi /bin/bash -c 'script -qfec "bash /home/dietpi/fork-update.sh branch fork-2026-11-23-spotify-live-suche fetredlwl/MuPiBox \"FORK 5.0.17 fork-2026-11-23-spotify-live-suche 77aa80a\"" /home/dietpi/fork-install.log && systemctl reboot'
```

Es kommt nur eine Zeile wie `Running as unit: mupibox-fork-install.service`. Dann läuft die Installation im Hintergrund.

**Nicht** stattdessen `curl … | sudo bash` oder `sudo bash fork-update.sh …` direkt im Terminal einfügen – aus dem oben genannten Grund.

Was die Teile des zweiten Befehls bedeuten, falls du später einen **anderen Stand** nehmen willst:

| Teil | Bedeutung |
|---|---|
| `mupibox-fork-install` | Name des Dienstes (zum Nachsehen, siehe unten) |
| `fork-2026-11-23-spotify-live-suche` (in Schritt 1 und 2) | der Tag. Steht ein Zweigname wie `wishes` dort, bekommst du den **laufenden Entwicklungsstand** – der kann Fehler haben |
| `fetredlwl/MuPiBox` | das Repository des Forks (`<Besitzer>/<Name>`) |
| `"FORK 5.0.17 … 77aa80a"` | die Versionsbezeichnung, die die Box danach anzeigt: `FORK`, die Basis-Version von splitti, der Tag, die ersten 7 Zeichen der Kennung. `FORK` am Anfang muss stehen bleiben, sonst hält die Box den Fork für eine offizielle Entwicklerversion. Die Angaben zu jedem Tag stehen in den Release-Notes |
| `script -qfec … /home/dietpi/fork-install.log` | gibt dem Skript ein Terminal (es braucht eins für die Fortschrittsanzeige) und schreibt alles in die Datei `fork-install.log` |
| `&& systemctl reboot` | startet die Box neu, **wenn** die Installation ohne Fehler fertig wurde |

**Mitlesen (optional)** – das geht auch nach einem Verbindungsabbruch und einer neuen SSH-Anmeldung:

```shell
tail -f /boot/mupibox_update.log
```

Mit Strg + C hörst du auf zu lesen; die Installation läuft weiter. Ob der Dienst noch läuft:
`systemctl is-active mupibox-fork-install` zeigt `active`, solange sie arbeitet.

**Was dann passiert**

1. Das Skript sichert deine Einstellungen und die Bibliothek, lädt den Fork herunter und ersetzt Programm, App und Display.
2. Das **Display zeigt eine Wartungsanzeige**. Das dauert **10 bis 30 Minuten**.
3. Am Ende **startet die Box von selbst neu**. Danach läuft der Fork.

Die Box in dieser Zeit am Netzteil lassen und **nicht ausschalten**. Das SSH-Fenster darfst du schließen.

**Bricht die Installation doch ab** (Stromausfall, Fehler): die Box **neu starten** (Netzteil kurz ab und wieder an). Der Dienst
`mupi_update_recover` stellt dann **vor allem anderen die vorherige Installation wieder her**; die Box läuft wie vorher.
Danach Schritt 1 und 2 noch einmal; sie sind wiederholbar. Die Ursache steht am Ende von `/boot/mupibox_update.log`.

---

## 5 Prüfen, ob es geklappt hat

1. Nach dem Neustart zeigt das Display die Startseite wie vorher (Bibliothek und Einstellungen sind unverändert).
2. In der MuPiBox-App *Einstellungen › System › Updates* öffnen: bei **Installiert** steht jetzt etwas wie
   `FORK 5.0.17 fork-2026-11-23-spotify-live-suche 77aa80a`. Darunter erscheinen die Zeilen **„Fork · Letzter Tag“** und
   **„Fork · Entwicklungsstand“** – über sie machst du künftig alle Updates (Teil 8).
3. Per SSH (optional): `jq -r .mupibox.version /etc/mupibox/mupiboxconfig.json` zeigt dieselbe Zeile.

Zeigt die App die alte Oberfläche, die Seite im Browser einmal **neu laden** (Strg + F5).

---

## 6 Die neuen Funktionen einrichten

Alles Neue hat **Schalter in der App**; solange ein Schalter aus ist, verhält sich die Box wie das Original.

1. **Spotify einrichten** (nur für „Bei Spotify suchen“ und Wünsche nötig): *Bibliothek › Spotify › Spotify einrichten*. Die Seite
   führt dich durch das Anlegen deiner **eigenen** Spotify-Entwickler-App (kostenlos auf
   [developer.spotify.com](https://developer.spotify.com/dashboard)) und das Eintragen von **Client-ID** und **Client-Secret**.
   Diese beiden Werte sind persönlich – nicht weitergeben, nicht in Issues oder Bildschirmfotos zeigen.
2. **Schalter für die Suche:** *Einstellungen › Display & Bedienung › Suche*. Zuerst der Hauptschalter, **ohne den es am Display
   gar keine Suche gibt**:
   - **Suche auf dem Display** – eine Lupe oben links auf der Startseite öffnet die Suche mit Bildschirmtastatur. Nach der
     Installation ist sie **aus**, die Startseite sieht also genauso aus wie vorher.

   Dann, je nachdem was das Kind können soll:
   - **Wünsche aus Spotify** – die Kachel „Bei Spotify suchen“ am Display; Wünsche gibst du in der App frei.
   - **Podcasts für Kinder in der Suche** – Kachel „Podcasts“ (Apple-Verzeichnis, bei Deutsch auch ARD Audiothek).
   - **Radio für Kinder in der Suche** – Kachel „Radio“ (radio-browser.info, nur als Kinderradio markierte Sender).
3. **Wünsche freigeben:** *Bibliothek › Wünsche*. Dort erscheinen die Wünsche des Kindes zum Freigeben oder Ablehnen; was du
   freigibst, merkt sich die Box (*Bibliothek › Für die Suche freigegeben*), das Kind kann es dann selbst holen und wieder entfernen.
4. **Testen:** Am Display auf die **Lupe** oben links auf der Startseite tippen. Du siehst runde Kacheln: „Bei Spotify suchen“, „Podcasts“, „Radio“ und
   „Einträge verwalten“.
5. **Home Assistant (optional):** Meldung aufs Handy, wenn sich das Kind etwas wünscht – [HOME_ASSISTANT.md](HOME_ASSISTANT.md).

---

## 7 Weitere Boxen

Jede Box wird **einzeln** installiert – gehe für jede die Teile 2 bis 6 durch:

1. Sicherung der Box (Teil 2).
2. `ssh dietpi@<Adresse-dieser-Box>` (Teil 3). Jede Box hat ihre eigene Adresse.
3. Dieselben **zwei Befehle** wie bei der ersten Box (Teil 4), mit **demselben Tag** – dann haben alle Boxen denselben Stand.
   Die Installation läuft auf jeder Box als eigener Dienst; auch mehrere Boxen gleichzeitig sind möglich, jede in ihrem SSH-Fenster.
4. Prüfen (Teil 5) und die Funktionen einrichten (Teil 6). Die Schalter und Spotify-Daten gelten **je Box**; Spotify-Entwickler-App
   kannst du für mehrere Boxen dieselbe verwenden.
5. Home Assistant: jede Box einzeln koppeln; Erweiterung und Automationen bleiben einmalig ([HOME_ASSISTANT.md, Teil F](HOME_ASSISTANT.md#teil-f--mehrere-boxen-updates-und-fehlersuche)).

Tipp: Notiere dir je Box Name, Adresse (nur für dich), installierten Tag und Datum der Sicherung.

---

## 8 Später aktualisieren und zurück

Ab jetzt brauchst du **kein SSH mehr**. In der App: *Einstellungen › System › Updates*:

| Zeile | Wozu |
|---|---|
| **Fork · Letzter Tag** | der letzte benannte Stand – der sichere Weg, auch **zurück** zu einem bekannten guten Stand zu springen |
| **Fork · Entwicklungsstand** | der laufende Zweig `wishes` – neueste Änderungen, nicht immer getestet |
| **Stabil** („Zurück zur offiziellen Version“) | zurück zum offiziellen MuPiBox von splitti, ohne den Fork |

Jede Installation dauert 10 bis 30 Minuten (Wartungsanzeige am Display), die Box startet danach selbst neu, Einstellungen und
Bibliothek bleiben erhalten. Bei einer Rückkehr zum Original gibt es die Funktionen des Forks nicht mehr (Suche am Display
mit Spotify, Wünsche, Kinder-Podcasts und -Radio); was du damit auf die Startseite geholt hast, ist normale Bibliothek.

Neue Stände erkennst du in den [Release-Notes](../RELEASE_NOTES.md) und auf der [Tag-Liste](https://github.com/fetredlwl/MuPiBox/tags).

---

## 9 Wenn etwas nicht klappt

| Problem | Was tun |
|---|---|
| `ssh` fragt nach einem Passwort, das nicht passt | Passwort wie bei der Einrichtung; Groß-/Kleinschreibung; die Eingabe bleibt unsichtbar |
| `Permission denied` / `Connection refused` | Adresse falsch oder SSH aus. Mit `ping <Adresse-der-Box>` prüfen, ob die Box antwortet |
| `curl: (22) … 404` | Tag falsch geschrieben. Den Namen genau aus den [Release-Notes](../RELEASE_NOTES.md) kopieren |
| `Error: Branch or tag '…' does not exist on GitHub repo` | dasselbe: Tag/Zweig oder Repository falsch geschrieben |
| Skript meldet, ein **anderes Update läuft** | warten, bis es fertig ist (und die Box neu gestartet hat), dann noch einmal |
| `Failed to start transient service unit … already exists` | die Installation läuft schon (oder ist hängen geblieben): `systemctl is-active mupibox-fork-install` – steht dort `active`, mit `tail -f /boot/mupibox_update.log` zusehen; ist sie nicht aktiv: `sudo systemctl reset-failed mupibox-fork-install` und Schritt 2 noch einmal |
| Nach Schritt 2 passiert nichts | `tail -n 30 /home/dietpi/fork-install.log` und `tail -n 30 /boot/mupibox_update.log` ansehen; die letzten Zeilen nennen den Fehler |
| Nach dem Update sieht die App wie vorher aus | Seite neu laden (Strg + F5); in *Updates* prüfen, was „Installiert“ zeigt |
| Das Display bleibt auf der Wartungsanzeige | 30 Minuten warten (ältere Raspberry Pis sind langsam); danach die Box vom Netz nehmen und neu starten |
| Fehler im Backend ansehen | per SSH: `pm2 logs server --lines 50 --nostream` |
| Alles zurück | Backup aus Teil 2 in der App unter *Einstellungen › System › Backup* wiederherstellen; oder **Stabil** unter Updates |

Hilft das nicht: ein [Issue im Fork](https://github.com/fetredlwl/MuPiBox/issues) eröffnen und die **Version aus Teil 3/5** sowie die
Fehlermeldung aufschreiben – **ohne** Adressen, Passwörter, Schlüssel oder Tokens.

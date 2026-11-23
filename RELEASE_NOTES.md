# Release-Notes des Forks

Dies sind die Notizen des Forks [fetredlwl/MuPiBox](https://github.com/fetredlwl/MuPiBox). Das Original mit seinen eigenen
Versionen und Notizen ist [splitti/MuPiBox](https://github.com/splitti/MuPiBox/releases) – dort steht, was am MuPiBox selbst
neu ist. Hier steht nur, was dieser Fork **zusätzlich** ändert. Alles Eigene des Forks sitzt hinter Schaltern; ist ein
Schalter aus, verhält sich die Box wie das Original.

Ein Stand heißt `fork-<Datum>-<Name>` (Tag). Installieren: Eltern-App › Einstellungen › Updates › „Fork · Letzter Tag“
(oder „Fork · Entwicklungsstand“ für den laufenden Zweig `wishes`). Zurück zum Original: „Stabil“. Vor jedem Update legt
die Box ein Backup an.

---

## Seit dem letzten Tag (noch ohne Tag)

**Neu: Playlists und einzelne Songs in der Suche** (alles hinter drei neuen Schaltern unter *Einstellungen › Display &
Bedienung › Suche*; aus = wie bisher)
- **Playlists in der Suche:** Kachel „Playlists“ mit den Playlists, die die Eltern in „Meine Playlists“ für die Suche
  freigeben; das Kind hört sie an und holt sie auf die Startseite. Die Box merkt sich, ob eine Playlist dem eigenen Konto gehört.
- **Kind darf Playlists anlegen:** „Neue Playlist“ – Name über die Tastatur, Reiter wählen; die Playlist entsteht **privat** im
  Spotify-Konto der Box. Wie viele am Tag, ist in der App einstellbar (Vorgabe 5).
- **Einzelne Songs aus Spotify:** Die Spotify-Suche findet auch Songs (explizite nie). Kann das Kind den Song schon hören (Album
  oder ganzer Künstler auf der Box bzw. freigegeben), legt es ihn sofort in eine **eigene** Playlist auf der Startseite (auch eine, die die Eltern selbst dorthin gelegt haben – die Box fragt Spotify, wem sie gehört; die Auswahl kommt immer, auch bei nur einer Playlist); sonst
  wünscht es ihn sich für eine davon, die Eltern geben ihn unter *Bibliothek › Wünsche* frei. Songs lassen sich unter
  „Einträge verwalten“ wieder aus den eigenen Playlists herausnehmen.
- Songs finden: Die ersten drei Songs eines Suchbegriffs stehen vorn; wie bei Spotify sagt jeder Treffer auf dem Cover, was er ist („Song · Fettes Brot“, „Album · …“), Künstler haben ein rundes Bild; jedes Album der Suche
  (auch eines, das schon auf der Box ist) bietet „Songs“ – so kommt das Kind über Künstler und Album bis zum einzelnen Lied.
- Private Playlists: Ihre Titelliste im Player kommt jetzt über den Spotify-Login der Box (Spotify zeigt private Playlists nicht
  öffentlich an – bisher kam „Spotify antwortet gerade nicht“); nach einem neuen oder herausgenommenen Song sofort aktuell.
- Für Anlegen und Songs braucht die Box das Recht, private Playlists zu ändern: Die App zeigt „Spotify neu verbinden“ (einmal).
- Home Assistant: Ereignisse für neue Playlists (`created`) und Songs (`kind: "track"`, mit `playlist`); die Wünsche-Erweiterung
  (`search_events.py`) ist dafür aktualisiert. Backup und Wiederherstellung sichern die neue Datei `search-playlists.json` mit.
- Display-Prüfung: Regeln R14–R16; alle neuen Texte in allen Sprachen.

**Anleitungen**
- [docs/INSTALLATION.md](docs/INSTALLATION.md): Erstinstallation des Forks auf einer laufenden Standard-MuPiBox per SSH, Prüfen,
  Einrichten, weitere Boxen, Updates, Fehlersuche.
- [docs/HOME_ASSISTANT.md](docs/HOME_ASSISTANT.md): Home Assistant mit dem Fork – Integration von splitti, Koppeln, die
  Wünsche-Erweiterung (`homeassistant/wishes-extension/`, drei Dateien für Version 0.5.3 der Integration), Beispiele für Helfer,
  Automationen und Dashboard.

---

## `fork-2026-11-23-spotify-live-suche` – Spotify-Live-Suche

Basis: splitti/MuPiBox 5.0.17. Version auf der Box: `FORK 5.0.17 fork-2026-11-23-spotify-live-suche 77aa80a`
(Installationsbefehl: [docs/INSTALLATION.md](docs/INSTALLATION.md)).

**Neu**
- **Suche am Display, aufgebaut wie die Startseite.** Beim Öffnen kommen runde Kacheln „Bei Spotify suchen“, „Podcasts“,
  „Radio“ und „Einträge verwalten“ – dieselbe Cover-Liste, dieselben Namensschilder (Tippen liest den Namen vor) und
  derselbe Scrollbalken wie auf der Startseite und bei „Weiterhören“. Die Tastatur erscheint erst nach einem Tipp aufs Suchfeld.
  Auch die Detailseiten sind diese Liste: das Cover, daneben „Abspielen“, „Auf die Startseite“ oder „Wünschen“ als
  Cover; die Reiter zur Auswahl ebenso. Ändert ein Design die Startseite, sehen Suche und Detailseiten genauso aus.
- **Spotify live suchen.** Das Kind sucht Alben und Künstler bei Spotify. Eine Kachel schränkt die Suche auf ihre Quelle
  ein; direkt auf der ersten Seite getippt bleibt es eine lokale Suche, die Spotify-Treffer hängen hinten dran.
- **Wünsche.** Was das Kind sich wünscht, geben die Eltern in der App frei oder lehnen es ab. **Freigaben merkt sich die
  Box**: das Kind kann es danach selbst hinzufügen und wieder entfernen. Eine Freigabe lässt sich widerrufen, die
  Wunschliste lässt sich aufräumen (einzeln oder alles Erledigte). Bei einem neuen Wunsch meldet sich Home Assistant.
- **Podcasts und Radio für Kinder.** Eigene Kacheln mit Tipps für Kinder; das Kind darf sie ohne Freigabe hinzufügen. Radio
  hat einen eigenen Schalter wie die Podcasts. Was die Box schon hat, wird nicht noch einmal angeboten.
- **Schon auf der Box?** Spotify-Treffer, die es schon gibt, werden gefunden, aber markiert (Eckzeichen) und lassen sich
  weder wünschen noch hinzufügen. Eckzeichen: **+** kann das Kind holen, **★** kann es sich wünschen, **✓** ist schon da.
- **Einträge verwalten.** Das Kind kann selbst Geholtes auf eine andere Seite verschieben oder entfernen.
- **App: Bibliothek › „Für die Suche freigegeben“.** Neue Seite neben „Wünsche“ mit allem, was für die Suche freigegeben
  ist, und mit dem, was das Kind selbst geholt hat.
- **Updates: „Fork · Letzter Tag“** neben dem Entwicklungsstand – man kommt jederzeit zum letzten benannten Stand zurück.
- Besserer Suchtext („Was möchtest du hören?“) und ein Spotify-Zeichen im Stil der übrigen Symbole.

**Behoben**
- Alben eines Künstlers erschienen beim ersten Öffnen der Künstlerseite nicht.
- Die Suche merkt sich ihre Treffer und fragt beim Zurückgehen nichts noch einmal.

**Für Entwickler**
- `tools/display-check`: eine Prüfung mit erfundenen Daten klickt die Suche bei 1024×600 und 800×480 (auch in
  Cover-Flow-Designs) durch und läuft in `tools/build-deploy.sh`; bricht eine Regel, wird `deploy.zip` nicht gebaut.
- Das Update-Skript nimmt neben einem Zweig auch ein Tag als Ziel.

---

## `fork-wishes-tipps-2026-11-22` – Tipps für Kinder in der Suche

Der Stand vor den Spotify-Wünschen, falls man dorthin zurück möchte.

- Suche am Display: eigene Künstler- und Albumseite, Hinweise nur bei einem echten Problem.
- Podcasts für Kinder, die das Kind ohne Freigabe auf die Startseite holen darf; Tipps für Kinder bei leerem Suchfeld.
- Suche in der Bibliothek, Vorrat „Nur in der Suche“, vom Kind Geholtes in der App entfernen.
- Spotify schonen: Alben gedrosselt laden, Abstand der Hintergrundanfragen einstellbar, Kontingente trennen (nur mit Schalter).
- Updates: neuer Kanal „Fork“ neben Stabil, Beta und Entwicklung.

---

## Dank

MuPiBox ist das Werk des Teams hinter [mupibox.de](https://mupibox.de), allen voran **splitti** und **nero**, und baut auf
[Sonos Kids Controller](https://github.com/Thyraz/Sonos-Kids-Controller) von Thyraz, DietPi, Librespot und weiteren
Projekten auf – die Liste steht in der [README](README.md) („Based on“) und in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Dieser Fork ist nur eine Ergänzung und steht unter derselben MIT-Lizenz.

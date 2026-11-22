# Display-Prüfung (Fork „wishes“)

Prüft die Suche auf dem Display so, wie Eltern sie testen – mit den Augen des Kindes. Läuft automatisch in
`tools/build-deploy.sh`; bricht eine Regel, wird `deploy.zip` nicht gebaut.

Gestartet werden das echte Backend (aus `src`, Entwicklungsmodus) mit **erfundenen** Testdaten in einem
temporären Ordner und das gebaute Display. Chrome klickt die Suche bei 1024×600 und 800×480 durch.

| Regel | Was geprüft wird |
|---|---|
| R1 | Ein Spotify-Hinweis nur, wenn es das Kind betrifft (Spotify spielt nicht) – nie bei einer Katalogsperre mit „Kontingente trennen“, und nie so, dass er der Seite Platz nimmt (Popup) |
| R2 | Aus der Suche in Künstler oder Album: Suchleiste und Tastatur weg; zurück kommt man zur Suche wie sie war (gleicher Text, gleiche Treffer), ohne dass Listen oder Spotify neu gefragt werden |
| R3 | Künstler- und Albumseite sehen aus wie die Seiten der Startseite (Kopf der Albumliste, Cover-Karussell), nichts scrollt |
| R4 | Ein Weg zurück je Seite (kein zweites „Schließen“ mit derselben Wirkung) |
| R5 | Die Texte kommen aus den Display-Übersetzungen (englische Box: kein Deutsch auf der Seite) |
| R0 | Vorbedingung: das Backend meldet die Test-Sperren so, wie sie gesetzt wurden |

Von Hand: `node tools/display-check/check.mjs <www-Ordner> [--shots <Ordner>]` (mit `--shots` legt sie ein Bild je
Schritt ab). Braucht Chrome und freie Ports 8200 und 4300.

Reparieren kann die Prüfung nichts selbst: Sie zeigt, welche Regel bricht, und hält den Build an.

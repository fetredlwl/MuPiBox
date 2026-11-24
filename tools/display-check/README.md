# Display-Prüfung (Fork „wishes“)

Prüft die Suche auf dem Display so, wie Eltern sie testen – mit den Augen des Kindes. Läuft automatisch in
`tools/build-deploy.sh`; bricht eine Regel, wird `deploy.zip` nicht gebaut.

Gestartet werden das echte Backend (aus `src`, Entwicklungsmodus) mit **erfundenen** Testdaten in einem
temporären Ordner (Spotify, Apple und ARD durch erfundene Antworten ersetzt, jede Spotify-Anfrage gezählt) und das
gebaute Display. Chrome klickt die Suche bei 1024×600 und 800×480 durch.

| Regel | Was geprüft wird |
|---|---|
| R1 | Ein Spotify-Hinweis nur, wenn es das Kind betrifft (Spotify spielt nicht) – nie bei einer Katalogsperre mit „Kontingente trennen“, und nie so, dass er der Seite Platz nimmt (Popup) |
| R2 | Aus der Suche in Künstler oder Album: Suchleiste und Tastatur weg; zurück kommt man zur Suche wie sie war (gleicher Text, gleiche Treffer), ohne dass Listen oder Spotify neu gefragt werden |
| R3 | Künstler- und Albumseite sind die Albumliste der Startseite und von „Weiterhören“ (Kopf der Albumliste, dieselbe Cover-Liste); die Albumseite zeigt ihr Cover und daneben, was man tun kann, als Cover – keine eigenen Knöpfe; nichts scrollt |
| R4 | Ein Weg zurück je Seite (kein zweites „Schließen“ mit derselben Wirkung) |
| R5 | Die Texte kommen aus den Display-Übersetzungen (englische Box: kein Deutsch auf der Seite) |
| R6 | Podcasts für Kinder: beim Tippen keine Anfrage, erst die Kachel fragt; nur Kindersendungen; ohne Freigabe auf die Startseite, danach unter „Von dir geholt“ |
| R7 | Tipps für Kinder bei leerem Suchfeld: einmal gefragt, nur Kindersendungen, schon Vorhandenes nicht noch einmal; mit eigenen Einträgen passen beide Reihen über die Tastatur |
| R8 | Wünsche aus Spotify: nur die Kachel fragt (10 je Art), weitere Seiten erst am Ende der Treffer bzw. beim Wischen ans Ende der Alben; zurück und noch einmal fragt nichts; im zweiten Durchlauf kommt alles aus dem Speicher der Box (0 Anfragen); Wünschen ohne „Abspielen“/„Startseite“; genau 5 Spotify-Anfragen im ersten Durchlauf |
| R9 | Schalter „Wünsche aus Spotify“ aus: keine Spotify-Suche, keine Anfrage dazu, alles andere wie vorher |
| R10 | App-Seite „Wünsche“: der Wunsch steht dort; freigegeben liegt er unter dem Reiter des Kindes auf der Startseite |
| R14 | Playlists in der Suche: Kachel „Playlists“, darunter „Neue Playlist“ und die freigegebenen Playlists; eine eigene Playlist kommt auf die Startseite und ist als eigene gekennzeichnet |
| R15 | Neue Playlist: Name über die Tastatur, dann die Reiter; angelegt im Konto des Kindes, auf der Startseite; nicht mehr als erlaubt am Tag (Hinweis, keine Tastatur); mit „Kind darf eigene Playlists löschen“ lässt sie sich ganz löschen (einmal nachgefragt, auch aus der Spotify-Bibliothek) |
| R16 | Songs: in der Spotify-Suche, explizite nie; ein Song, den das Kind schon hören kann, kommt sofort in eine seiner eigenen Playlists (gefolgte stehen nicht zur Wahl); die ersten Songs stehen vorn; jeder Treffer sagt auf dem Cover, was er ist („Song · …“, „Album · …“, „Künstler“ rund); ein Album bietet „Songs“ (ohne explizite); eine Playlist, in der er schon steckt, trägt ✓; ein neuer wird für eine Playlist gewünscht; Songs lassen sich aus der eigenen Playlist herausnehmen (einmal nachgefragt) |
| R17 | Ein Spotify-Album mit einem expliziten Song zeigt „Nicht für Kinder“ statt „Wünschen“; dafür wird Spotify einmal gefragt (seine Songs), danach nicht mehr |
| R18 | Startseite sortieren (Schalter an): langes Drücken startet das Sortieren, nichts geht auf; ein Cover wird an einen anderen Platz gezogen (Bühne: Pfeile), die Reihenfolge bleibt nach dem Neuladen; „A–Z“ fragt einmal nach und sortiert wie vorher; Schalter aus: langes Drücken tut nichts |
| R0 | Vorbedingung: das Backend meldet die Test-Sperren so, wie sie gesetzt wurden |

Von Hand: `node tools/display-check/check.mjs <www-Ordner> [--shots <Ordner>]` (mit `--shots` legt sie ein Bild je
Schritt ab). Braucht Chrome und freie Ports 8200 und 4300.

Reparieren kann die Prüfung nichts selbst: Sie zeigt, welche Regel bricht, und hält den Build an.

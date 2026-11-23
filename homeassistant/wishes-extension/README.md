# Erweiterung „Wünsche“ für die MuPiBox-Integration in Home Assistant

Drei Dateien, die die offizielle Integration [splitti/MuPiBox-homeassistant](https://github.com/splitti/MuPiBox-homeassistant)
(Version **0.5.3**) um eine Sache erweitern: Home Assistant bekommt ein Ereignis `mupibox_search_event`, wenn das Kind sich in
der Suche am Display etwas wünscht, etwas auf die Startseite holt oder wieder entfernt.

**Die ganze Anleitung steht in [docs/HOME_ASSISTANT.md](../../docs/HOME_ASSISTANT.md)** – mit Installation, Helfern,
Automationen und Dashboard.

| Datei | Was damit zu tun ist |
|---|---|
| `custom_components/mupibox/search_events.py` | **neu**: nach `/config/custom_components/mupibox/` legen |
| `custom_components/mupibox/coordinator.py` | ersetzt die Datei gleichen Namens der Integration (Original 0.5.3 plus rund 60 Zeilen) |
| `custom_components/mupibox/v1_api.py` | ersetzt die Datei gleichen Namens der Integration (Original 0.5.3 + 4 Zeilen) |
| `examples/mupibox_wuensche_package.yaml` | Helfer und Automationen zum Kopieren |
| `examples/dashboard_wuensche.yaml` | Dashboard-Karten zum Kopieren |

Die geänderten Zeilen sind jeweils mit „(fork "wishes")“ oder dem Wort „search“ erkennbar; alles andere ist unverändert
von splitti. Der Schnitt ist klein gehalten, damit man ihn nach einem Update der Integration leicht erneut einspielen kann.

## Herkunft und Lizenz

Die beiden ersetzten Dateien sind abgeleitet von der Integration von **splitti (Copyright MuPiBox.de, MIT-Lizenz)**; ihr
Lizenztext steht im [Repository der Integration](https://github.com/splitti/MuPiBox-homeassistant/blob/main/LICENSE) und
gilt hier unverändert weiter. Dank und alle Rechte am Rest der Integration: splitti und das MuPiBox-Team.
Diese Erweiterung wird vom MuPiBox-Team nicht betreut – Fragen dazu bitte in den
[Issues dieses Forks](https://github.com/fetredlwl/MuPiBox/issues).

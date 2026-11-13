# Kaderlabor – Windows-App

Kaderanalyse für den Karrieremodus von EA SPORTS FC 27 als eigenständiges Windows-Programm. Kein offizielles Produkt von EA SPORTS.

## Installieren

1. `Kaderlabor-Windows-x64.zip` entpacken, zum Beispiel nach `C:\Programme\Kaderlabor` oder auf den Desktop.
2. `Kaderlabor.exe` starten.
3. Windows SmartScreen meldet beim ersten Start eventuell „Unbekannter Herausgeber“, weil die App nicht signiert ist. Dann auf **Weitere Informationen → Trotzdem ausführen** klicken.

## Wo deine Daten gespeichert werden

- **Mit claude.ai verbunden:** Kader, Datenbank, Rollen und Einstellungen liegen in deinem Claude-Konto, privat für dich. Sie sind auf jedem Gerät gleich, auch auf der Website, und bleiben erhalten, wenn du die App neu installierst.
- **Lokale Version:** Alles liegt in `%APPDATA%\Kaderlabor\kaderlabor-daten.json` (mit automatischer Sicherungskopie `.bak`).
- **Sicherung:** Unter Datenbank → „Sicherung herunterladen“ speicherst du alles als Datei; „Sicherung laden“ stellt sie wieder her, auch zwischen den beiden Modi.

## Vollbild

Die App startet im Vollbild. **F11** schaltet zwischen Vollbild und Fenster um, **Alt** blendet das Menü ein. Die App merkt sich deine Wahl.

## Verbindung mit Claude

Die App öffnet immer ihre eigene Oberfläche (randlos im Vollbild) und spricht im Hintergrund über die Claude-API mit Claude. Dafür braucht sie einen eigenen Anthropic-API-Schlüssel: Beim ersten Start fragt sie danach, später unter **Alt → Verbindung → API-Schlüssel festlegen …**. Der Schlüssel wird mit der Windows-Verschlüsselung (DPAPI) gespeichert, nur an die Claude-API gesendet und über dein Anthropic-Konto abgerechnet. Ohne Schlüssel funktioniert alles außer den Claude-Funktionen.

Unter **Verbindung → claude.ai-Ansicht (Browser)** lässt sich die Web-Version weiterhin öffnen, zum Beispiel um dort gespeicherte Daten per „Sicherung herunterladen“ in die App zu holen.

## Abgleich mit FC 27

Die App liest deinen neuesten Karriere-Spielstand (`CmMgr…`/`Career…`) und übernimmt alle Spieler mit aktuellen Ratings, Potenzial, Alter, Vereinen und Ligen in die Datenbank. Spieler in deinem Kader werden mit aktualisiert. Die Spielstände werden nur gelesen, nie verändert, und die App greift nicht auf das laufende Spiel zu.

- Ordner: wird automatisch erkannt (`%LOCALAPPDATA%\EA SPORTS FC 27\settings`), sonst unter Datenbank → „Spielstand-Ordner …“ wählen.
- Namensliste: Spielstände enthalten nur Namens-Nummern. Unter Datenbank → „Namensliste …“ einmal eine `playernames`-Tabelle (Spalten `nameid` und `name`) wählen; sie bleibt nur auf diesem PC.
- „Nach jedem Speichern im Spiel automatisch“: Die App beobachtet den Ordner und gleicht wenige Sekunden nach dem Speichern ab. Menü **FC 27** bietet dasselbe.

## Updates

Ab Version 1.3.0 aktualisiert sich die App selbst: Beim Start prüft sie im Hintergrund, ob es eine neue Version gibt, lädt sie herunter, prüft jede Datei per SHA-256 und fragt dann, ob sie neu starten soll. Unter **Hilfe → Nach Updates suchen …** geht das auch von Hand. Deine Daten bleiben dabei unverändert. Heruntergeladene Versionen liegen unter `%APPDATA%\Kaderlabor\code`.

Ein neues Update veröffentlichen: Dateien in `code/` ändern (die Seite in `web/kaderlabor.html`), Version in `code/version.json` erhöhen, `npm run release:update -- "Was ist neu"` ausführen, committen und pushen.

## Selbst bauen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start          # App starten (auf dem aktuellen Betriebssystem)
npm run pack:win   # Windows-x64-Version nach dist/Kaderlabor-win32-x64 bauen
```

Die Seite selbst liegt in `web/kaderlabor.html` (identisch mit der Web-Version). `npm run build:page` erzeugt daraus `code/app/index.html` mit dem Claude-Adapter (`code/app/claude-shim.js`). `main.js` ist der feste Starter mit dem Updater, der eigentliche Programmcode liegt in `code/`.

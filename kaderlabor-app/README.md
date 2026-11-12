# Kaderlabor – Windows-App

Kaderanalyse für den Karrieremodus von EA SPORTS FC 27 als eigenständiges Windows-Programm. Kein offizielles Produkt von EA SPORTS.

## Installieren

1. `Kaderlabor-Windows-x64.zip` entpacken, zum Beispiel nach `C:\Programme\Kaderlabor` oder auf den Desktop.
2. `Kaderlabor.exe` starten.
3. Windows SmartScreen meldet beim ersten Start eventuell „Unbekannter Herausgeber“, weil die App nicht signiert ist. Dann auf **Weitere Informationen → Trotzdem ausführen** klicken.

Dein Kader, deine Spielerdatenbank, Rollen und Einstellungen werden dauerhaft auf dem PC gespeichert (`%APPDATA%\Kaderlabor`).

## Claude-Funktionen

Screenshot-Import, Transfervorschläge, Scoutbericht und Taktik-Beratung brauchen einen eigenen Anthropic-API-Schlüssel:

1. Schlüssel in der Anthropic Console unter „API Keys“ erstellen.
2. In der App **Claude → API-Schlüssel festlegen …** wählen und einfügen.

Der Schlüssel wird mit der Windows-Verschlüsselung (DPAPI) gespeichert und nur an die Claude-API gesendet. Die Nutzung wird über dein Anthropic-Konto abgerechnet. Ohne Schlüssel funktioniert alles andere ganz normal; die Claude-Bereiche sind dann ausgeblendet.

## Selbst bauen

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm start          # App starten (auf dem aktuellen Betriebssystem)
npm run pack:win   # Windows-x64-Version nach dist/Kaderlabor-win32-x64 bauen
```

Die Seite selbst liegt in `web/kaderlabor.html` (identisch mit der Web-Version). `npm run build:page` erzeugt daraus `app/index.html` mit dem Claude-Adapter (`app/claude-shim.js`).

# TestErsteller Web

Web-Umsetzung des bekannten Funktionsstands der WPF-App als Next.js-Anwendung.

## Funktionsumfang

- Klasse- und Themenauswahl wie in der Desktop-App
- sechs Kompetenzspalten nebeneinander: Argumentieren, Problemlösen, Modellieren, Darstellungen, Mathematik, Kommunizieren
- Aufgaben als Checkboxen innerhalb der jeweiligen Kompetenzgruppe
- Laden der Aufgaben aus Notion
- Unterstützung einer zentralen Notion-Datenbank sowie des alten Mappings „sechs Datenbanken pro Thema“
- Live-Berechnung von Gesamtpunkten und Gesamtzeit
- AFB-Verteilung für die Pflichtvariante ohne Sternchen-Teilaufgaben
- zweite AFB-Verteilung für die Sternchen-Variante: Sternchen zuerst, anschließend normale Teilaufgaben in Reihenfolge bis `MaxPoints`
- Kompetenzverteilung nach Punkten
- `Test DB`-Verbindungstest
- `Erstellen`-Dialog mit Testtitel, Hilfsmitteln und Formelpunkten
- Export als ZIP mit Test und Erwartungshorizont im DOCX-Format
- Bilder aus Notion im Testexport
- Word-Matheobjekte für typische LaTeX-Formeln, Brüche, Wurzeln, Hoch-/Tiefstellungen
- Notenpunkte-Tabelle mit den aus der WPF-App bekannten Prozentgrenzen
- responsive Oberfläche für kleinere Displays

## Notion-Konfiguration

Die geheime Notion-Integration wird ausschließlich serverseitig über `NOTION_TOKEN` verwendet. Der Schlüssel wird nicht in Client-JavaScript eingebaut und darf insbesondere **nicht** als `NEXT_PUBLIC_...` Variable gespeichert werden.

1. `.env.local.example` nach `.env.local` kopieren.
2. Den vorhandenen Notion-Integration-Key der WPF-App als `NOTION_TOKEN` eintragen.
3. Falls die WPF-App pro Thema sechs getrennte Datenbanken verwendet, `NOTION_DATABASE_MAP_JSON` mit den bisherigen IDs befüllen.

Das zentrale Datenbank-Fallback ist bereits auf die bekannte Datenbank-ID gesetzt:

```text
10233652f4bc801bab33d35a61a51f52
```

Die Anbindung verwendet die aktuelle Notion-API-Version `2026-03-11`. Eine Database-ID wird automatisch in ihre Data-Source-ID(s) aufgelöst und anschließend über den Data-Source-Query-Endpunkt abgefragt.

### Unterstützte Property-Namen

Die Zuordnung ist absichtlich tolerant, damit kleinere Benennungsunterschiede zur WPF-Datenbank keinen Umbau erfordern:

- `Name` / `Titel` / `Title`
- `Aufgabe` / `Aufgabentext` / `Question`
- `Aufgabenbereich` / `AFB` / `Anforderungsbereich`
- `Punkte` / `MaxPoints` / `Punktzahl`
- `Erwartungshorizont` / `Erwartung` / `Expectation`
- `Bild` / `Image` / `Grafik`
- `Kompetenz` / `Prozessbezogene Kompetenz` / `Competence`
- `Thema` / `Topic`
- `Klasse` / `Jahrgang` / `Jahrgangsstufe`
- `Zeit` / `Bearbeitungszeit` / `EstimatedTime` / `Minuten`

### AFB- und Punkteauswertung

Die AFB-Zuordnung wird ausschließlich aus `Aufgabenbereich` gelesen, nicht aus dem Aufgabentext erraten.

Beispiel:

```text
Aufgabe:
a) ...
b) ...
*c) ...
*d) ...

Punkte: 1+1+2+2 (max. 4)
Aufgabenbereich: a: AFB 1, b: AFB 1, c: AFB 1, d: AFB 2
```

Daraus entstehen:

- Pflichtvariante: AFB 1 = 2 P
- Sternchenvariante: AFB 1 = 2 P, AFB 2 = 2 P
- maximale Aufgabenpunktzahl: 4 P

Auch ein globales `AFB 1` wird unterstützt; dann erhalten alle erkannten Teilaufgaben diesen Aufgabenbereich.

## Lokal starten

```bash
npm install
npm run dev
```

Danach `http://localhost:3000` öffnen.

Für einen Produktionscheck:

```bash
npm run build
npm start
```

## Vercel

Die Variablen `NOTION_TOKEN`, `NOTION_DATABASE_ID` und optional `NOTION_DATABASE_MAP_JSON` als serverseitige Environment Variables im Vercel-Projekt anlegen und anschließend deployen.

## Hinweis zur 1:1-Übernahme

Die ursprünglichen `.xaml`- und `.cs`-Quelldateien sowie der geheime Notion-Key waren in den verfügbaren Dateien nicht enthalten. Deshalb basiert diese Umsetzung auf dem bekannten Funktionsstand der WPF-App. Die Architektur ist so angelegt, dass die noch fehlenden exakten Database-IDs oder Detailwerte aus dem XAML ohne Umbau nachgetragen werden können.

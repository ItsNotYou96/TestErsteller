# TestErsteller Web

Web-Umsetzung des bekannten Funktionsstands der WPF-App als Next.js-Anwendung.

## Funktionsumfang

- Klasse- und Themenauswahl wie in der Desktop-App
- sechs Kompetenzspalten nebeneinander: Argumentieren, Problemlösen, Modellieren, Darstellungen, Mathematik, Kommunizieren
- Aufgaben als Checkboxen innerhalb der jeweiligen Kompetenzgruppe
- Laden der Aufgaben aus Notion
- exakte Übernahme des WPF-Mappings: pro Thema sechs getrennte Notion-Datenbanken (K1–K6)
- Live-Berechnung von Gesamtpunkten und Gesamtzeit
- AFB-Verteilung für die Pflichtvariante ohne Sternchen-Teilaufgaben
- zweite AFB-Verteilung für die Sternchen-Variante: Sternchen zuerst, anschließend normale Teilaufgaben in Reihenfolge bis `MaxPoints`
- Kompetenzverteilung nach Punkten
- `Test DB`-Verbindungstest
- `Erstellen`-Dialog mit Testtitel, Hilfsmitteln und Formelpunkten
- frei änderbare Aufgabenreihenfolge vor dem Export; dieselbe Reihenfolge gilt für Test und Erwartungshorizont
- Export als ZIP mit Test und Erwartungshorizont im DOCX-Format
- Bilder aus Notion im Testexport
- Word-Matheobjekte für typische LaTeX-Formeln, Brüche, Wurzeln, Hoch-/Tiefstellungen
- Notenpunkte-Tabelle mit den aus der WPF-App bekannten Prozentgrenzen
- responsive Oberfläche für kleinere Displays

## Notion-Konfiguration

Die geheime Notion-Integration wird ausschließlich serverseitig über `NOTION_TOKEN` verwendet. Der Schlüssel wird nicht in Client-JavaScript eingebaut und darf insbesondere **nicht** als `NEXT_PUBLIC_...` Variable gespeichert werden.

1. `.env.local.example` nach `.env.local` kopieren.
2. Den vorhandenen Notion-Integration-Key der WPF-App als `NOTION_TOKEN` eintragen.
3. Weitere Datenbankvariablen sind für den normalen Betrieb nicht nötig: Das exakte WPF-Mapping Klasse → Thema → K1–K6 ist bereits im Servercode enthalten. `NOTION_DATABASE_MAP_JSON` dient nur noch als optionaler Override.

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

Für den normalen Betrieb reicht `NOTION_TOKEN` als serverseitige Environment Variable im Vercel-Projekt. `NOTION_DATABASE_ID` kann aus Kompatibilitätsgründen gesetzt bleiben; `NOTION_DATABASE_MAP_JSON` ist nur für ein bewusstes Mapping-Override nötig.

## Übernommene WPF-Struktur

Aus der veröffentlichten WPF-App wurde die eingebettete .NET-Assembly ausgelesen. Damit sind nun auch die zuvor fehlenden Details exakt bekannt und im Webprojekt hinterlegt:

- Klassenliste 7–13
- Themenlisten je Klasse (in der WPF-Version für 7–10 befüllt)
- 20 Themen insgesamt
- 120 feste Notion-Datenbankzuordnungen: sechs Kompetenz-Datenbanken je Thema
- Kompetenzreihenfolge K1 Argumentieren, K2 Problemlösen, K3 Modellieren, K4 Darstellungen, K5 mathematische Werkzeuge/Mathematik, K6 Kommunizieren

Der geheime Notion-Token bleibt weiterhin ausschließlich in Vercel bzw. `.env.local` und ist nicht im Web-Quellcode enthalten.

## Admin-Aufgabenimport

Unter `/admin` gibt es einen geschützten Importbereich für PDF/DOCX. Der Workflow ist:

1. Admin-Code eingeben (`ADMIN_CODE` in Vercel).
2. Eine oder mehrere PDF-/DOCX-Dateien hochladen (z. B. Klassenarbeit + Erwartungshorizont).
3. Aufgaben automatisch erkennen und Metadaten prüfen/bearbeiten.
4. Ähnlichkeitswarnungen gegen bereits vorhandene Aufgaben prüfen.
5. Nur markierte Aufgaben final in die passende WPF/Notion-Datenbank schreiben.

Der Import kann ohne LLM arbeiten. Für bessere automatische Zuordnung von Thema, Kompetenz, AFB, Zeit und Erwartungshorizont kann serverseitig `GROQ_API_KEY` gesetzt werden. Das Modell ist über `GROQ_MODEL` konfigurierbar.

Für das tatsächliche Schreiben nach Notion benötigt die bestehende Integration neben Leserechten auch **Insert content**. Bilder aus DOCX werden, soweit sie einer Aufgabe zugeordnet werden können, als Notion-Dateiupload gespeichert. Bei PDFs kann ein Aufgabenbild in der Prüfansicht manuell ergänzt werden.

Der derzeitige Importverlauf wird lokal im Browser des Admins gespeichert; die eigentlichen Aufgaben landen weiterhin ausschließlich in Notion.

### Groq Free-Tier import (v2.0)
The importer first separates tasks locally. If Groq analysis is enabled, each task is then sent separately to `/api/admin/analyze-task`. This keeps each request small and lets the browser automatically pause/retry when the Groq free-tier token-per-minute window is temporarily exhausted.

### Sichere PDF-/Mathe-Erkennung (v2.2)

Die PDF-Textschicht ist ab v2.2 die verbindliche Quelle dafür, **welche Aufgaben existieren**. Die frühere vollständige Vision-OCR wurde entfernt, weil ein Vision-Modell ohne Textanker Inhalte halluzinieren kann. Der Schalter im Adminbereich heißt jetzt **Mathematik visuell korrigieren**: Groq/Qwen sieht die gerenderte Seite, darf aber ausschließlich mathematische Schreibweise (Brüche, Potenzen, Wurzeln, Rechenzeichen) innerhalb des bereits extrahierten Textes korrigieren.

Jede visuelle Korrektur wird serverseitig verworfen, sobald Aufgabennummern, Teilaufgaben, Zahlenmenge, Prosa oder Textlänge unplausibel verändert werden. Bei Scan-PDFs ohne brauchbare Textschicht wird lieber gewarnt als eine nicht belegte Aufgabe erzeugt.

Zusätzlich repariert der lokale PDF-Parser häufige einfache Fälle wie gestapelte Brüche (`3/4`) bereits ohne Groq. Komplexe Formelsätze werden nur mit der abgesicherten visuellen Korrektur nachgelesen.

Die Duplikatprüfung berücksichtigt ab v2.2 echte Zahlen, Operatoren, mathematische Tokens, Prosa, Titel und Aufgabenstruktur getrennt. Eine Warnung erscheint erst ab ca. 74 %, automatisch abgewählt wird eine Aufgabe erst bei mindestens 96 % Ähnlichkeit.

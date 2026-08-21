# Validierung

## Durchgeführte Prüfungen

- Parser für `Punkte` mit Summen und `(max. N)` geprüft.
- Explizite AFB-Zuordnung pro Teilaufgabe geprüft.
- Globales AFB für alle Teilaufgaben geprüft.
- Sternchen-Erkennung für alternative Teilaufgaben geprüft.
- Pflichtverteilung geprüft: Sternchen werden ausgeschlossen.
- optimierte Sternchenverteilung geprüft: Sternchen werden zuerst berücksichtigt, danach normale Teilaufgaben bis `MaxPoints`.
- aktuelle Notion-Struktur Database → Data Source berücksichtigt.
- DOCX-Mathematik-API gegen die aktuelle `docx`-Dokumentation abgeglichen (Math, Fraction, Radical, Superscript, Subscript, ImageRun).
- TypeScript-Parserlauf ohne Syntaxfehler in den eigenen Modulen.
- WPF-Publish extrahiert und das eingebettete Mapping überprüft: 7 Klassen, 20 Themen, 120 Kompetenz-Datenbankzuordnungen.
- Klassen-/Themen-Metadaten der Webversion gegen die WPF-Logik geprüft.
- Reihenfolge der sechs Datenbanken gegen die WPF-Enum-Reihenfolge K1–K6 geprüft.
- Exportreihenfolge wird jetzt explizit aus der vom Benutzer sortierbaren Auswahl übernommen.


## Konkreter Regressionstest

Eingabe:

```text
a) A
b) B
*c) C
*d) D
Punkte: 1+1+2+2 (max. 4)
Aufgabenbereich: a: AFB 1, b: AFB 1, c: AFB 1, d: AFB 2
```

Erwartet und erhalten:

```text
Pflicht:      AFB1=2, AFB2=0, AFB3=0
Sternchen:    AFB1=2, AFB2=2, AFB3=0
```

## Noch lokal/auf Vercel zu prüfen

Ein kompletter `next build` konnte in der Erstellungsumgebung nicht ausgeführt werden, weil der Zugriff auf das npm-Paketregister dort nicht verfügbar war. Deshalb muss nach `npm install` einmal `npm run build` ausgeführt werden. Die reine Geschäftslogik wurde davon unabhängig ausgeführt und getestet.

Ein echter Notion-Integrationstest ist erst möglich, sobald `NOTION_TOKEN` gesetzt ist.

## v1.3 changes
- Task cards render the actual Notion image when available.
- Image extraction supports Notion Files (uploaded/external), URL, rich text link/plain URL and formula URL.
- Task cards show Punkte, AFB and Zeit.
- Export dialog includes Lehrkraft, Datum, Klasse, Thema and per-task "Auf Extrablatt erledigen?".
- Word export layout was rebuilt from the published WPF application's embedded labels and visual resources:
  FRO logo, sheet/extra-sheet pictograms, student header, Hinweise, task headings, grading fields,
  Notenspiegel, expectation table and Notenpunkte table.
- Default title aligned to the WPF application: "Klassenarbeit".
- TypeScript/TSX syntax/transpile check passed for all project source files.
- Full dependency-aware `next build` was not run locally because the project dependencies are not installed in this runtime; Vercel performs the authoritative production build.

## v1.4 – Word-Export gegen WPF-Referenz abgeglichen

Referenzdateien: `Klassenarbeit.docx` und `Klassenarbeit_Erwartung.docx`, erzeugt durch die WPF-App.

Anpassungen:
- Kopfbereich als echter Word-Header, damit er auf Folgeseiten wiederholt wird.
- 4-spaltiger WPF-Kopf: Schule/Klasse/Lehrkraft, Titel/Thema, FRO-Logo, Datum.
- Schüler-/Bewertungstabelle wie in der Referenz: Vorname, Name, Hilfsmittel, Aufgabenpunkte in Dreierspalten, Formpunkte, Punktzahl/Notenpunkte/Note.
- Kompakter zweizeiliger Notenspiegel mit Überschrift.
- Hinweise ohne Umrandung und mit den originalen Piktogrammen sowie Trennlinie.
- Aufgabenüberschrift enthält wieder Aufgabennummer, Titel und die originale Punktezerlegung (`pointsRaw`).
- Keine zusätzliche Punktezeile nach jeder Aufgabe.
- Aufgabenbilder werden – wie im WPF-Export – in ihren Original-Pixelmaßen eingefügt und links ausgerichtet.
- Erwartungshorizont wieder mit exakt 3 Spalten: Aufgabe, Erwartungshorizont, Punkte (keine zusätzliche AFB-Spalte).
- Notenpunkte-Tabelle wieder horizontal mit Prozent / Notenpunkte / Punkte ab.
- Standard-Schrift im Dokument auf Aptos 11 pt; WPF-spezifische Kopfbereiche mit den in der Referenz beobachteten Größen/Schriften.

Prüfung:
- TypeScript/TSX-Syntax mit TypeScript 5.8.3 erfolgreich geparst.
- Die verwendeten docx-API-Elemente (Header, TableLayoutType, HeightRule, UnderlineType, VerticalAlign, BorderStyle) wurden gegen die aktuelle docx-API-Dokumentation abgeglichen.
- Ein vollständiger `next build` ist in dieser Sandbox weiterhin nicht möglich, da die npm-Abhängigkeiten hier nicht vollständig installiert sind; Vercel führt den vollständigen Build beim Deployment aus.

## v1.5 layout adjustment
- Header table now uses fixed column proportions so the title sits closer to the center of the full header.
- FRO logo is rendered at 100×22 px, matching the size embedded in the reference WPF DOCX more closely.
- The school name has more reliable single-line space in the fixed header layout.
- Student scoring table uses three fixed equal columns and taller rows; the form-points row gets extra height for "Mathematische Form".
- Student table text is vertically centered within the larger cells.


## v1.6 (2026-08-21)

- Exportdialog auf bis zu 940 px verbreitert; Reihenfolgenliste auf mindestens 330 px Höhe vergrößert.
- Zweite AFB-Tabelle (Sternchen-Variante) entfernt; rechts bleibt eine AFB-Verteilung.
- Notion-Zeitparser erweitert: Number-, Formula-, Rollup-, Text-, Select- und Statuswerte werden unterstützt; aus Angaben wie `10 min` oder `12,5 Minuten` wird die numerische Zeit extrahiert.
- Zusätzliche Aliasnamen für Zeit: `Bearbeitungsdauer`, `Zeitaufwand`, `Dauer`.
- Aufgabenanzeige verwendet KaTeX. Die TeX-Erkennung orientiert sich am Muster der WPF-App und erkennt u. a. `$...$`, `$$...$$`, `\(...\)`, `\[...\]`, `\frac{...}{...}`, TeX-Befehle sowie Potenzen wie `x^2`.
- Syntaxprüfung aller Dateien in `app`, `lib` und `components` mit TypeScript 5.8.3: keine Parserfehler.
- Regression des Zahlen-Parsers separat geprüft: `10 min -> 10`, `12,5 Minuten -> 12.5`, `Zeit: 7 -> 7`.
- Vollständiges `npm install` konnte in der Container-Umgebung wegen fehlendem Registry-Netzzugriff nicht abgeschlossen werden. Vercel installiert die neue `katex`-Abhängigkeit beim Deployment.

## v1.7
- Die kleine Reihenfolgenliste im Exportdialog wurde entfernt.
- Stattdessen öffnet `Reihenfolge bearbeiten` einen eigenen großen Sortierdialog.
- Der Sortierdialog zeigt Titel, Kompetenz, Punkte, AFB, Zeit, vollständigen Aufgabentext (inkl. LaTeX), optional das Aufgabenbild und die Extrablatt-Option.
- Hoch/Runter ändert weiterhin direkt `selectedOrder`; Export und Erwartungshorizont verwenden diese Reihenfolge.

## v1.8 Admin-Import

- Neuer geschützter Bereich `/admin` mit serverseitig signierter 8-Stunden-Session (`ADMIN_CODE`, optional `ADMIN_SESSION_SECRET`).
- PDF/DOCX-Analyse: DOCX über Mammoth + zusätzliche OMML-Textgewinnung, PDF über `pdf-parse` 2.x.
- Heuristische Aufgabentrennung erkennt beim vorhandenen WPF-Beispiel `Klassenarbeit.docx` alle 6 Überschriften (`Aufgabe 1` bis `Aufgabe 6`).
- Erwartungshorizont-Tabellen aus DOCX werden anhand des Aufgabentitels zugeordnet, soweit die Tabellenstruktur `Aufgabe | Erwartungshorizont | Punkte` erkennbar ist.
- Optionaler LLM-Pfad über die OpenAI Responses API mit Structured Outputs; ohne `OPENAI_API_KEY` bleibt der komplette Prüf-/Notion-Workflow nutzbar.
- Duplikatprüfung nutzt normalisierte Token-Jaccard- und Trigram-Dice-Ähnlichkeit gegen die vorhandenen Aufgaben des vorgeschlagenen Klasse/Thema-Paars.
- Finaler Import wird pro Aufgabe einzeln an `/api/admin/commit` geschickt, damit Bilder nicht gemeinsam das Vercel-Requestlimit überschreiten.
- Notion-Ziel wird aus dem originalen WPF-Mapping Klasse → Thema → Kompetenz gewählt; Page-Properties werden anhand des tatsächlichen Data-Source-Schemas geschrieben.
- Notion-Dateiupload für Aufgabenbilder implementiert; Integration benötigt `Insert content`.
- Alle TypeScript/TSX-Dateien mit dem TypeScript-Compiler syntaktisch transpiliert: 0 Syntaxdiagnosen.
- Vollständiger `npm install`/`next build` konnte in der Containerumgebung nicht abgeschlossen werden, da der Registry-Zugriff innerhalb des Zeitlimits nicht fertig wurde. Der vollständige Integrationsbuild erfolgt daher beim Vercel-Deployment.

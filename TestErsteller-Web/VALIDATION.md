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

# Validierung v3.0

## Regression: Aufgabengrenzen

Die neue deterministische Blocksegmentierung wurde mit den drei bisher problematischen Dokumenttypen geprüft:

- `Gleichungen-und-Terme (1).pdf` → **10 Aufgaben**, Strukturkonfidenz 0,96
- `Klassenarbeit zu rationale Zahlen und Wahrscheinlichkeit - Teil 1.pdf` → **5 Aufgaben**, Strukturkonfidenz 0,96
- `KA3_TermeGleichungen_GruppeA.docx` → **7 Aufgaben**, Strukturkonfidenz 0,99 (echte Word-Listennummerierung)

Der Test verwendet beim DOCX die Listenmetadaten statt eines Dateispezifischen Ausdrucks. Die Überschrift `3. KA: ...` ist dadurch kein Aufgabensignal; die nummerierten Arbeitsschritte innerhalb einer Aufgabe konkurrieren nicht mit der echten Word-Listenebene.

## Regression: lokale Ähnlichkeits-Vorauswahl

Beispiele mit der neuen Stufe-1-Suche:

- `Drücke ... mit einem Term aus` vs. `Stelle ... einen passenden Term auf` → ca. **0,70**
- `Fasse die Terme zusammen ...` vs. gleiche Fertigkeit mit anderen Termen → ca. **0,84**
- Term-Vereinfachung vs. lineare Gleichung lösen → ca. **0,05**

Die endgültige semantische Einstufung erfolgt – wenn Groq aktiviert ist – erst im Reranking der besten lokalen Kandidaten.

## TypeScript

`tsc --noEmit` wurde ausgeführt. In der Ausführungsumgebung konnten die npm-Pakete nicht installiert werden (`npm install` Registry-Timeout). Die verbleibenden Meldungen sind daher fehlende externe Module/Typen (`next`, `react`, `jszip`, `mammoth`, `pdf-parse`, `@types/node`). Für die neu geschriebenen Importdateien wurden nach Bereinigung keine zusätzlichen Syntax-/Logik-Typfehler außerhalb dieser fehlenden Abhängigkeiten gefunden.

Die reine `taskSegmentation.ts` wurde separat transpiliert und mit den oben genannten drei Block-Fix­tures ausgeführt.

## Zusätzlicher Server-Typecheck

Für die neuen Serverdateien wurde zusätzlich ein isolierter strikter TypeScript-Check mit lokalen Deklarations-Stubs für die in dieser Umgebung nicht installierbaren Fremdpakete ausgeführt. Dabei wurden `documentBlocks.ts`, `taskSegmentation.ts`, `importParsing.ts`, `pdfVisionOcr.ts`, `duplicateCheck.ts`, `notion.ts`, `llmAnalysis.ts` sowie die beiden Admin-API-Routen gemeinsam geprüft: **0 TypeScript-Fehler**.

## Regression: Punkte

Mit den Originalstrukturen wurden u. a. geprüft:

- Tutory Aufgabe 4 → `6+6`
- Tutory Aufgabe 5 → `3+10`
- Word-Listen-DOCX Aufgabe 1 → `1+1+2 (max. 3)`
- Word-Listen-DOCX Aufgabe 3 → `1+1+2+4 (max. 6)`
- Word-Listen-DOCX Aufgabe 6 → `1+2+3+5 (max. 8)`
- Word-Listen-DOCX Aufgabe 7 bleibt `4`; die nachfolgende dokumentweite Formbewertung `(3 BE)` wird nicht zur Aufgabe addiert.

Bei `Je N P.` wird die höchste erkannte Teilaufgabenbezeichnung (z. B. d) → vier Teilaufgaben) als zusätzliche Absicherung verwendet, falls die PDF-Textschicht eine frühere Teilaufgabenmarke beschädigt.

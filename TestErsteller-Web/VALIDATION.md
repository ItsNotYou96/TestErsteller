# Validierung v3.5

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

## v3.1 – Duplicate-Rerank-Regression

- schwacher bester lokaler Treffer (~20 %): 0 Groq-Aufrufe
- verdächtiger Treffer (~60 %): genau 1 Groq-Aufruf
- maximal an Groq gesendete Kandidaten: 5
- Kandidatentext pro Treffer auf 650 Zeichen begrenzt; neue Aufgabe auf 1800 Zeichen begrenzt
- max_completion_tokens für das Reranking von 1200 auf 600 reduziert
- bereits vorhandener duplicatePool wird nach der Metadatenanalyse wiederverwendet, auch wenn `duplicates` leer ist
- Syntax-Transpilierung aller TS/TSX-Dateien separat geprüft

## v3.2 – Rate-Limit-/Queue-Regression

- Metadatenanalyse (`/api/admin/analyze-task`) und Duplikat-Reranking (`/api/admin/check-duplicate`) sind getrennte Requests/Queues.
- `duplicateCheck.ts` gibt bei einem nicht erfolgreichen Groq-Rerank keinen stillen Kandidaten-Fallback mehr zurück. HTTP-Fehler werden als `DuplicateRerankError` mit Status und Rate-Limit-Headern weitergereicht.
- Bei HTTP 429 hält die Admin-Queue dieselbe Aufgabe fest, zeigt den Wartezustand an, wartet `retry-after` bzw. `x-ratelimit-reset-tokens` ab und wiederholt ausschließlich die Ähnlichkeitsprüfung.
- Es gibt für 429 keinen Vier-Versuche-Abbruch mehr in der Duplicate-Queue; die nächste Aufgabe beginnt erst nach erfolgreicher Prüfung der aktuellen Aufgabe.
- Nicht-429-Fehler werden sichtbar als `Ähnlichkeit: Fehler` markiert und als Warnung ausgegeben, statt still wie eine erfolgreiche Prüfung auszusehen.
- Aufgaben, deren lokaler Treffer klar schwach oder bereits nahezu identisch ist, bleiben bei `Ähnlichkeit: lokal ✓`; sie verbrauchen weiterhin keinen Groq-Request.
- TS/TSX-Syntax aller Projektdateien wurde mit TypeScript `transpileModule` geprüft.

## v3.3 – Bruch-/Math-Regression

Regression mit `Gleichungen-und-Terme (1)(1).pdf`, Aufgabe 3:

Die gedruckte Seite enthält u. a. folgende zweidimensional gesetzte Mathematik:

- `d)` → `\\frac{3}{4}x+4=25`
- erstes `e)` → `\\frac{1}{2}x-3=-5\\frac{1}{2}`
- zweites `e)` → `\\frac{4}{5}-\\frac{3}{20}y=\\frac{3}{4}`
- `f)` → `\\frac{3}{4}=\\frac{3}{2}-\\frac{3}{8}y`

Die lineare PDF-Textschicht kann dieselben Stellen als nackte Zahlenfolgen liefern (`4 3`, `4 3 20 3 5 4`, ...). Der neue pure Detector `pdfMathSignals.ts` wurde mit folgenden Fällen ausgeführt:

- flach beschädigte Aufgabe 3 → `true`
- normale lineare Gleichungen ohne Brüche → `false`
- reine Sachaufgabe mit Zahlen, aber ohne beschädigte Mathe-Struktur → `false`
- gestapelte Einzelzahlzeilen eines Bruchs → `true`

Zusätzlich wird `pdf-parse.getText()` nun mit `itemJoiner: " "` aufgerufen, damit getrennte Textobjekte ihre Grenze behalten und die Sicherheitsvalidierung z. B. eine gemischte Zahl nicht als vermeintliche `52` missversteht.

Die visuelle Reparatur validiert Teilaufgabenlabels und den Zahlen-Multiset nun pro Teilaufgabe. Eine Korrektur darf Bruchlayout rekonstruieren, aber weder Zahlen zwischen Teilaufgaben verschieben noch neue Zahlen hinzufügen.


## v3.4 – Regression: gestapelte Brüche / doppelte Teilaufgabenlabels

Für die problematische Aufgabe 3 aus `Gleichungen-und-Terme (1)(1).pdf` wurde die zerfallene Textspur als Fixture verwendet. Die Teilaufgabenfolge wird als **12 Positionen** erkannt: `a), b), c), d), e), e), f), g), h), i), j), k)`. Das doppelte `e)` bleibt absichtlich erhalten.

Die vier visuell problematischen Positionen haben im Originalbild folgende Mathematik:

- Position 4 (`d)`): `\frac{3}{4}x+4=25`
- Position 5 (erstes `e)`): `\frac{1}{2}x-3=-5\frac{1}{2}`
- Position 6 (zweites `e)`): `\frac{4}{5}-\frac{3}{20}y=\frac{3}{4}`
- Position 7 (`f)`): `\frac{3}{4}=\frac{3}{2}-\frac{3}{8}y`

Die neue Vision-Schnittstelle verlangt exakt 12 `parts` nach Ordinalzahl und gibt keine Labels zurück. Das Programm setzt die Original-Labels anschließend selbst wieder ein. Die Zahlenvalidierung erfolgt pro Position; damit sind reine Layout-Umsortierungen von Zähler/Nenner erlaubt, Zahlenänderungen zwischen Teilaufgaben dagegen nicht.

Die Dateien `pdfVisionOcr.ts`, `adminTypes.ts`, `app/api/admin/import/route.ts`, `app/api/admin/repair-math/route.ts` und `app/admin/page.tsx` wurden mit TypeScript `transpileModule` syntaktisch geprüft: **0 Diagnosen**.

## v3.5 – Erwartungshorizont / lokale Vergleichsreferenz

- Der LLM-Prompt fordert nun ausdrücklich eine vollständige Musterlösung für jede Teilaufgabe und nicht mehr einen auf ca. 100 Wörter begrenzten Erwartungshorizont.
- `max_completion_tokens` der Metadatenanalyse wurde auf 2200 erhöht, damit auch mehrteilige Aufgaben vollständig gelöst werden können.
- Eine deterministische Vollständigkeitsprüfung zählt die Teilaufgabenlabels des Aufgabentexts einschließlich doppelter Labels. Fehlt im Erwartungshorizont mindestens eine Position, wird ein separater `complete_expectation`-Structured-Output-Request mit bis zu 2400 Completion-Tokens ausgelöst.
- Die lokale Ähnlichkeitsprüfung speichert im Statushinweis immer den besten vorhandenen lokalen Vergleich (`Titel · Thema · Kompetenz · Prozentwert`).
- Die linke Aufgabenliste zeigt diesen Vergleich bei `Ähnlichkeit: lokal ✓` zusätzlich direkt unter den Aufgabendaten an.

## v3.6 – lokaler Vergleich
- Admin-Editor rendert für `duplicateCheckStatus === "local"` auch dann einen aufklappbaren Vergleich, wenn `draft.duplicate` wegen der Sichtbarkeitsschwelle nicht gesetzt ist.
- Der Kandidat stammt aus `duplicatePool`/`duplicates` über `bestLocalComparison()`.
- Der vollständige `questionText` wird mit `LatexText` gerendert und nutzt denselben Summary-Text **„Bestehende Aufgabe vergleichen“** wie der KI-geprüfte Vergleich.
- Existiert bereits `selected.duplicate`, bleibt der bestehende Vergleich unverändert; dadurch entsteht kein doppelter Block.


## v3.7 – Regression: Quadrat-Aufgabe vs. Aussagen zu negativen Zahlen

Als Negativtest wurde folgender Vergleich verwendet:

- Neu: `a) Ein Quadrat hat einen Umfang von 18 cm ... b) Die Seiten eines Quadrates wurden verdoppelt ...`
- Bestand: `Überprüfe folgende Aussagen auf Richtigkeit ... negative Zahl ... ganze Zahl ...`

Mit der lokalen Retrieval-Funktion liegt der Rohwert nach Entfernung struktureller Teilaufgabenlabels aus den Math-Tokens bei ca. **15,8 %** und damit deutlich unter `LOCAL_RELEVANCE_THRESHOLD = 0.34`. Der Kandidat wird daher **nicht mehr als lokale Ähnlichkeit dargestellt und nicht aufklappbar angeboten**. Die Oberfläche zeigt stattdessen `Lokal geprüft ✓` sowie den Statushinweis, dass kein relevanter ähnlicher Treffer gefunden wurde.

Zusätzlich wurde die Einzelbuchstaben-Erkennung in `mathTokens()` auf Unicode-Letter-Grenzen umgestellt. Dadurch wird das `w` in `wächst` nicht mehr als mathematische Variable tokenisiert.

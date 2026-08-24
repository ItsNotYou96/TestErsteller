# v4.7 Validation

## Regression: formale Sprache → Algebra

Getestetes Positivbeispiel:
- Neu: `Drücke die folgenden Aussagen mit einem Term aus ... Versechsfache die Summe ...`
- Datenbank: `Stelle/telle eine zum Text passende Gleichung ... Eine unbekannte Zahl x wird mit 2 multipliziert ...`
- Ergebnis der strukturellen lokalen Analyse: **0,76 Retrieval-Struktursignal**
- Signale: `formale sprachliche Beschreibung in Algebra übersetzen`, `gleiche Repräsentationshandlung: Text in Algebra übersetzen`, `gleiche Darstellungsform`
- Damit ist der Kandidat deutlich oberhalb der Groq-/Anzeige-Schwellen und kann nicht mehr allein wegen `Term` vs. `Gleichung` aus der Kandidatenauswahl fallen.

Dasselbe Ergebnis wird erzielt, wenn der Operator in der Bestandsaufgabe als `telle ... passende Gleichung` vorliegt.

Negativkontrolle:
- Sprachliche Termbildung vs. Johannisbeer-Sachmodellierung
- strukturelles Signal ca. **0,178**
- kein `formal_verbal_to_algebra`-Familienmatch; damit kein künstlicher Boost.

Weitere Regressionen:
- Gleichungen lösen + Lösungsmenge vs. Variante mit Grundmenge: strukturell **0,78**, lokaler sicherer Aufgabentyp.
- Nadja/Mutter vs. `Äquivalenzumformung erklären`: **0,16**, kein sicherer Match.
- Zwei unterschiedlich formulierte sprachliche Termbildungsaufgaben: **0,85**, sicherer Match.

## Adminanzeige

- Lokale Vergleichskandidaten werden auch dann weiter angezeigt, wenn bereits ein KI-bestätigter Treffer existiert.
- KI-bestätigte Aufgaben werden aus dieser lokalen Zusatzliste herausgefiltert, damit keine Doppelanzeige entsteht.
- Lokaler Pool: 24 Kandidaten; Anzeige: bis zu 5 nicht bereits bestätigte Kandidaten ab bestehender Relevanzschwelle.

## Technische Prüfung

- Keine neuen npm-Pakete oder Environment-Variablen.
- 29 ausführbare TS/TSX-Dateien per TypeScript `transpileModule` auf Syntax geprüft: 0 Fehler.

---

# v4.6 Validation

## Weitere ähnliche Treffer

- Der beste Ähnlichkeitstreffer bleibt wie bisher über **„Bestehende Aufgabe vergleichen“** aufklappbar.
- Unter **„Weitere ähnliche Treffer“** sind die Treffer 2–5 jetzt jeweils separat aufklappbar.
- Jeder Aufklapper zeigt den vollständigen `questionText` über `LatexText`, also inklusive KaTeX/LaTeX-Rendering.
- Vorhandene Groq-Begründungen und Rubrik-Kriterien werden innerhalb des jeweiligen Treffers mit angezeigt.
- Keine Änderung an Kandidatenauswahl, Scores, Groq-Requests oder Notion-Daten.

---

# v4.5 Validation

## Mathematische Struktur-Normalisierung

Getestete Regressionen:

- `Löse die Gleichung und bestimme die Lösungsmenge ...` vs. `Gib die Lösungsmenge an und beachte dabei die Grundmenge ...`
  - alter Wortlaut-/Tokenwert: ca. 25 %
  - struktureller Match: stark (`confidentSameSkill=true`)
  - gemeinsame Signale: lineare Gleichungen lösen, Lösungsmenge bestimmen, gleiche Schülerhandlung; Grundmenge nur Zusatzanforderung
  - Ergebnis: lokal als gleicher Aufgabentyp erkennbar, kein Groq nötig
- Nadja/Mutter-Altersaufgabe vs. `Erkläre ... Äquivalenzumformung`
  - strukturell schwach, kein sicherer Match
- sprachliche Aussage → Term vs. Johannisbeer-Sachmodellierung → Term
  - wegen unterschiedlicher Repräsentation/Modellierungsart kein sicherer Match
- zwei unterschiedlich formulierte sprachliche Termbildungsaufgaben
  - strukturell starker Match
- Quadrat/Umfang/Flächeninhalt vs. Aussagen über negative Zahlen
  - strukturell schwach

## Adminanzeige

- Keine sichtbaren lokalen Prozentwerte mehr.
- Bis zu fünf lokale Kandidaten bleiben vollständig aufklappbar.
- Kandidaten werden als `Starker`, `Guter`, `Plausibler` oder `Weiterer lokaler Kandidat` bezeichnet.
- Fachliche Gemeinsamkeiten werden als lokale Signale angezeigt.

## Groq

- Eindeutige strukturelle Matches werden lokal entschieden und verbrauchen keine Groq-Tokens.
- Unklare Fälle senden höchstens drei Kandidaten pro Aufgabe an Groq.
- v4.3-Fallback bei langen Rate-Limit-Resets bleibt bestehen.

## Technische Prüfung

- Keine neuen npm-Pakete oder Environment-Variablen.
- TypeScript-Syntax/Transpilierbarkeit der ausführbaren TS/TSX-Dateien wird vor Packaging geprüft.


## v4.5 Regression – Groq Structured Output

Auslöser: Ein realer Groq-400-Fehler enthielt in `results` nach dem ersten gültigen Objekt String-Fragmente wie `"{draftId"`, sodass das komplette Batch zuvor verworfen wurde.

Geprüfte Schutzmaßnahmen:
- Batch-Schema verwendet nur Integer-Indizes und keine UUID-Rückgabe.
- Batch-Ausgabe enthält keinen frei generierten Ähnlichkeits-Score mehr.
- Strict-Schema-400 (`json_validate_failed`/`output_parse_failed`) führt zu genau einem JSON-Object-Fallback.
- Nicht-Objekte in `results` und `matches` werden ignoriert statt den gesamten Batch zu zerstören.
- Fehlende Kandidatenbewertungen erzeugen Status `partial`; lokale Kandidaten bleiben sichtbar.
- 429 bleibt ein echter Rate-Limit-Fehler und wird weiterhin von der bestehenden Client-Queue behandelt.
- TypeScript-Transpile-Test über 29 TS/TSX-Dateien: 0 Syntaxdiagnosen.

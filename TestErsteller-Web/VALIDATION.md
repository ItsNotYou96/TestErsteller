# v5.0 Validation – kompakte Erwartungshorizonte

Geprüfte Änderungen:
- `expectationLooksComplete(...)` akzeptiert kurze, fachlich vollständige Lösungen ab 12 Zeichen; Teilaufgabenlabels werden weiterhin vollständig geprüft.
- Der Generator-Prompt verlangt explizit knappe Musterlösungen ohne unnötige didaktische Erklärtexte.
- Der Validator verlangt bei einer Korrektur ebenfalls eine vollständige, aber kompakte Ersatzlösung.
- Die mathematische Validierung, Faktor-/Operator-Kontrolle und unabhängige Zweitprüfung aus v4.9 bleiben unverändert aktiv.

Regression für die Beispielaufgabe:
`Versechsfache die Summe aus einer Zahl und 7.` → erwartetes Ergebnis weiterhin `6(x+7)`, nun ohne erzwungenen ausführlichen Erklärungstext.

---

# v4.9 Validation

## Regression: Versechsfachen der Summe

Testaufgabe:
`Drücke die folgenden Aussagen mit einem Term aus a) Versechsfache die Summe aus einer Zahl und 7.`

Deterministische Vorprüfung:
- erkannter Vervielfachungsfaktor: **6**
- `Summe` erkannt: **Addition**
- vorhandene Konstante: **7**
- Faktor 2 wird aus dieser Aufgabe nicht abgeleitet

Erwartetes mathematisches Ergebnis: `6(x+7)`.

## Validierungspipeline

1. Generator erzeugt eine vollständige Musterlösung nur aus der Originalaufgabe.
2. Unabhängiger Validator löst die Aufgabe selbst und prüft die Kandidatenlösung.
3. Bei einem Fehler wird eine vollständige Korrektur erzeugt.
4. Die Korrektur wird durch ein zweites Modell erneut geprüft.
5. Nur eine bestandene Lösung wird gespeichert.

## Technische Prüfung

- `lib/llmAnalysis.ts` basiert auf dem vollständigen v4.8-Projektstand.
- TypeScript `transpileModule` mit `strict: true`: **0 Fehler**.
- Keine neuen npm-Pakete.
- Keine neue Pflicht-Environment-Variable.
- `GROQ_VALIDATION_MODEL` ist optional; ohne Konfiguration werden vorhandene Modelle als Validator-Fallbacks verwendet.

---

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

## v4.8 – Regression Erwartungshorizont

Geprüft:
- `lib/llmAnalysis.ts`, `lib/adminTypes.ts`, `app/api/admin/generate-expectation/route.ts` und `app/admin/page.tsx` via TypeScript `transpileModule`: keine Syntaxdiagnosen.
- Erwartungshorizont ist nicht mehr Teil des Metadaten-Schemas/-Prompts.
- Admin-Reihenfolge: PDF-Mathereparatur -> Musterlösungsqueue -> Metadatenqueue -> Ähnlichkeitsqueue.
- Die Musterlösungsqueue iteriert über **alle** erkannten Aufgaben und wird nicht durch `stopMetadataGroq` beendet.
- Modellfallback für Musterlösungen: konfiguriertes Lösungsmodell (Default Qwen) -> GPT-OSS 20B -> GPT-OSS 120B.
- Metadatenanalyse bewahrt `draft.expectation`, `expectationStatus` und `expectationNote` unverändert.
- Vollständigkeitsprüfung zählt auch doppelte Teilaufgabenlabels (z. B. `e), e)`) positionsunabhängig über Häufigkeiten.

Ein vollständiger `next build` war in der isolierten Umgebung ohne installierte Projekt-Abhängigkeiten nicht möglich; die geänderten TS/TSX-Dateien wurden isoliert transpiliert.

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

# v4.2 Validation

## Ziel
Regression auf den v3.7-Kern der lokalen Kandidatensuche, kombiniert mit den späteren Queue-/Batch-Verbesserungen. Keine didaktischen Profil-Boosts aus v3.8–v4.1.

## Lokale Regressionen
Mit der wiederhergestellten v3.7-Formel ergeben die bekannten Gegenbeispiele ungefähr:

- sprachliche Termbildung vs. Johannisbeer-Sachmodellierung: ~10 % → unter Groq-Grenze
- Nadja/Mutter-Altersaufgabe vs. „Äquivalenzumformung erklären“: ~15 % → unter Groq-Grenze
- Grundmenge/Lösungsmenge vs. echte Variante mit anderen Zahlen: ~38 % → wird Groq vorgelegt
- anders formulierte sprachliche Termbildungsvariante: ~79 % → sicherer Kandidat
- Alters-Sachaufgabe vs. gleichartige Alters-Sachaufgabe mit anderen Personen/Zahlen: ~27 % → wird Groq vorgelegt

Damit wird der frühere 24-%-False-Negative-Fall nicht mehr an der alten 34-%-Grenze abgeschnitten, ohne die sehr breite 16-%-Suche aus v3.8 zurückzubringen.

## Groq
- bis zu 4 neue Aufgaben pro Batch
- bis zu 5 Kandidaten pro Aufgabe
- Kandidaten stammen ausschließlich aus dem wiederhergestellten v3.7-Retrieval
- `related`/`not_related` werden nicht als sichtbare Ähnlichkeit ausgegeben
- es ist ausdrücklich erlaubt, keinen Treffer zu bestätigen

## Syntax
`lib/duplicateCheck.ts`, `app/admin/page.tsx` und `app/api/admin/check-duplicates-batch/route.ts` wurden mit TypeScript `transpileModule` geprüft: keine Syntaxdiagnosen.

---

# v4.1 Validation

## Ähnlichkeitslogik

- Nadja/Mutter-Sachaufgabe vs. „Erkläre mit eigenen Worten, wie man eine Äquivalenzumformung durchführt.“: lokaler Retrievalscore ca. 0,05, `eligible=false`; kein semantischer Groq-Vergleich nötig.
- Zwei Varianten „Lösungsmenge unter Beachtung der Grundmenge“: Retrievalscore ca. 0,84, `eligible=true`; starke Signale für didaktischen Typ, Grundmenge/Lösungsmenge, Handlung und mathematische Struktur.
- Zwei unterschiedlich formulierte Aufgaben „sprachliche Aussage → Term“: Retrievalscore ca. 0,83, `eligible=true`.
- Sprachliche Termbildung vs. Johannisbeer-Sachmodellierung: Retrievalscore ca. 0,21, `eligible=false`.

## Semantische Rubrik

Groq liefert keinen Score und keine Relation mehr, sondern ausschließlich sechs Booleans. Die Anwendung entscheidet deterministisch:

- Lernziel oder Schülerhandlung verschieden → `not_related`
- Lernziel + Handlung gleich, mathematischer Weg verschieden → `related`
- Lernziel + Handlung + Weg gleich, Darstellungsform verschieden → `related`
- Lernziel + Handlung + Weg + Darstellungsform gleich → `same_skill`
- zusätzlich vergleichbare Struktur + gleiche Vorlage → `near_duplicate`

## Technische Prüfung

- 29 ausführbare `.ts`/`.tsx`-Dateien per TypeScript `transpileModule`: 0 Syntaxdiagnosen.
- `duplicateCheck.ts` zusätzlich in isolierter Laufzeit mit den obigen Regressionstexten geprüft.

---

# Validation v4.0

## Ziel

Regression der Ähnlichkeitssuche nach den Problemen in v3.8/v3.9: keine falschen Treffer nur wegen eines gemeinsamen Oberbegriffs, aber auch keine False Negatives bei fachlich sehr charakteristischen Aufgaben mit anderem Zahlenmaterial.

## Getestete Fälle

1. **Lösungsmenge + Grundmenge**
   - Neu: „Gib die Lösungsmenge an und beachte dabei die Grundmenge … G = Z / N / Q“
   - Variante: gleiche Teilkompetenz mit anderen Gleichungen/Zahlen.
   - Ergebnis: lokaler Kandidat wird sicher zugelassen (`eligible=true`), Retrievalscore ca. 0,82; Signale: gleicher didaktischer Aufgabentyp, solution_set/domain_set, gleiche Schülerhandlung, ähnliche mathematische Struktur.

2. **Gleiche Formulierung, andere Zahlen**
   - Ergebnis: `confidentVariant=true`, Strukturwert 1,0. Kann ohne Groq als sehr ähnliche Variante erkannt werden.

3. **Lösungsmenge/Grundmenge vs. normale Gleichungen lösen**
   - Ergebnis: kein starker Kandidat (`eligible=false`).

4. **Sprachliche Termbildung vs. Johannisbeer-Sachmodellierung**
   - Ergebnis: `eligible=false`; gemeinsames Endprodukt „Term“ reicht nicht.

5. **Zwei sprachliche Termbildungsvarianten**
   - Ergebnis: `eligible=true`, hoher Retrievalscore.

6. **Quadrat/Flächeninhalt vs. Aussagen über negative Zahlen begründen**
   - Ergebnis: `eligible=false`.

## Technische Checks

- 29 TS/TSX-Dateien mit TypeScript `transpileModule` geprüft: keine Syntaxdiagnosen.
- `lib/duplicateCheck.ts` zusätzlich im strikten TypeScript-Check mit minimaler `process.env`-Deklaration geprüft.

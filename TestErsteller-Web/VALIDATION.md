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

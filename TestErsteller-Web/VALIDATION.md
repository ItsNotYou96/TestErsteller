# v4.3 Validation

## Groq-Fallback

- Automatisches Warten nur bei kurzen 429-Resets bis 60 Sekunden.
- Nach zwei kurzen Rate-Limit-Retries wird ebenfalls nicht weiter blockiert.
- Metadaten: bei langem Reset wird der restliche Metadatenlauf heuristisch belassen statt z. B. 1201 Sekunden zu warten.
- Ähnlichkeitsprüfung: bei langem Reset werden der aktuelle und alle restlichen pending Kandidaten auf `local` gesetzt; lokale Vergleichskandidaten bleiben sichtbar.
- Visuelle Mathekorrektur: lange Rate-Limits blockieren den Import nicht mehr.

## Lokale Ähnlichkeit

- Sichtbare lokale Kandidaten ab 18 % Retrieval-/Suchwert.
- Bis zu fünf Kandidaten werden vollständig aufklappbar angezeigt.
- Die Oberfläche bezeichnet sie ausdrücklich als **lokale Suchkandidaten**, nicht als bestätigte Ähnlichkeit.
- Groq-Reranking wird wieder erst ab 34 % bestem lokalen Suchwert ausgelöst. Dadurch werden 18–33-%-Kandidaten sichtbar, verbrauchen aber keine Groq-Tokens.
- Lokale Kandidaten bleiben auch sichtbar, wenn Groq erfolgreich keinen Treffer bestätigt oder die KI-Prüfung wegen Rate-Limits ausfällt.

## Technische Prüfung

- 29 ausführbare `.ts`/`.tsx`-Dateien mit TypeScript 5.8.3 `transpileModule` geprüft: 0 Syntaxdiagnosen.
- Keine neuen npm-Pakete oder Environment-Variablen.

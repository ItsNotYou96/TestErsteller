# Validierung v2.3

- Syntaxcheck aller 23 TS/TSX-Dateien: 0 Parsefehler.
- Regression mit `Gleichungen-und-Terme (1).pdf`: 10 Aufgabenblöcke werden weiterhin erkannt.
- Bei fehlender Bepunktung entstehen bereits ohne Groq Punkte-Vorschläge; Groq darf diese anschließend verfeinern.
- Themenheuristik arbeitet auf dem jeweiligen Aufgabenblock statt auf dem Dateinamen; dadurch wird z. B. eine Gleichungsaufgabe nicht mehr allein wegen „Terme“ im Dateinamen als `Terme` klassifiziert.
- Ähnlichkeitstest: paraphrasierte Varianten von „Drücke Aussagen mit einem Term aus“ erreichen in lokalen Regressionen ca. 67–70 %, eine sachfremde Gleichungsaufgabe ca. 1 %.
- Duplikatsuche verwendet bis zu fünf Treffer und durchsucht bei Klasse 7 insbesondere `Terme` und `Gleichungen` gegenseitig, auch wenn der erste Themenvorschlag falsch war.
- Vollständiger `next build` konnte in der Containerumgebung nicht ausgeführt werden, da `npm install` wegen Registry-Zeitüberschreitung nicht abgeschlossen werden konnte. Vercel bleibt der Integrationstest.

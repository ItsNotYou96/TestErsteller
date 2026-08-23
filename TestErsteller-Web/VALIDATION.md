# Validierung v2.4

- `app/admin/page.tsx` und `components/LatexText.tsx` mit TypeScript `transpileModule` syntaktisch geprüft: 0 Parsefehler.
- Aufgabentext wird standardmäßig über `LatexText`/KaTeX gerendert; der Quelltext ist nur nach Klick auf „Quelltext bearbeiten“ sichtbar.
- Erwartungshorizont verwendet denselben Ansicht/Bearbeiten-Wechsel.
- Beim Wechsel der ausgewählten Aufgabe werden beide Bereiche automatisch auf die formatierte Ansicht zurückgesetzt.
- Keine neuen npm-Abhängigkeiten; die bestehende `katex`-Abhängigkeit wird weiterverwendet.
- Ein vollständiger `next build` ist in dieser Containerumgebung ohne installierte Projektabhängigkeiten nicht aussagekräftig; Vercel bleibt der Integrationstest.

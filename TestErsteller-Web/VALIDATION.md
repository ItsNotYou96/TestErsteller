# Validierung

## Durchgeführte Prüfungen

- Parser für `Punkte` mit Summen und `(max. N)` geprüft.
- Explizite AFB-Zuordnung pro Teilaufgabe geprüft.
- Globales AFB für alle Teilaufgaben geprüft.
- Sternchen-Erkennung für alternative Teilaufgaben geprüft.
- Pflichtverteilung geprüft: Sternchen werden ausgeschlossen.
- optimierte Sternchenverteilung geprüft: Sternchen werden zuerst berücksichtigt, danach normale Teilaufgaben bis `MaxPoints`.
- aktuelle Notion-Struktur Database → Data Source berücksichtigt.
- DOCX-Mathematik-API gegen die aktuelle `docx`-Dokumentation abgeglichen (Math, Fraction, Radical, Superscript, Subscript, ImageRun).
- TypeScript-Parserlauf ohne Syntaxfehler in den eigenen Modulen.

## Konkreter Regressionstest

Eingabe:

```text
a) A
b) B
*c) C
*d) D
Punkte: 1+1+2+2 (max. 4)
Aufgabenbereich: a: AFB 1, b: AFB 1, c: AFB 1, d: AFB 2
```

Erwartet und erhalten:

```text
Pflicht:      AFB1=2, AFB2=0, AFB3=0
Sternchen:    AFB1=2, AFB2=2, AFB3=0
```

## Noch lokal/auf Vercel zu prüfen

Ein kompletter `next build` konnte in der Erstellungsumgebung nicht ausgeführt werden, weil der Zugriff auf das npm-Paketregister dort nicht verfügbar war. Deshalb muss nach `npm install` einmal `npm run build` ausgeführt werden. Die reine Geschäftslogik wurde davon unabhängig ausgeführt und getestet.

Ein echter Notion-Integrationstest ist erst möglich, sobald `NOTION_TOKEN` gesetzt ist.

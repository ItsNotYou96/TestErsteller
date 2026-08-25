# TestErsteller-Web v5.1 – Direct Patch

Änderung auf der Hauptseite: Word-Exporte werden nicht mehr als ZIP heruntergeladen.

## Enthaltene Ersatzdateien

- `app/page.tsx`
- `app/api/export/route.ts`

Die Dateien relativ zum Ordner `TestErsteller-Web` ersetzen.

## Neues Verhalten

Beim Klick auf **„Test + EWH erstellen“** werden zwei Word-Dateien erzeugt und direkt einzeln heruntergeladen:

- `<Titel>.docx`
- `<Titel>_Erwartung.docx`

Eine ZIP-Datei wird nicht mehr erzeugt. `jszip` bleibt als Projektabhängigkeit erhalten, weil es weiterhin für das Einlesen von DOCX-Dateien verwendet wird.

Hinweis: Einige Browser können beim ersten Mal nachfragen, ob mehrere automatische Downloads von der Seite erlaubt werden sollen. Das ist eine Browser-Sicherheitsfunktion; nach Erlaubnis werden beide DOCX-Dateien direkt gespeichert.

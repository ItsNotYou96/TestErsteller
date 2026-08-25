# Validierung v5.1

Geprüfte Änderungen:

- Export-Route enthält keinen `JSZip`-Import mehr.
- `/api/export` akzeptiert `kind: "test" | "expectation"`.
- `kind=test` liefert direkt eine DOCX-Datei mit Word-MIME-Type.
- `kind=expectation` liefert direkt den Erwartungshorizont als DOCX-Datei.
- Die Hauptseite ruft beide Exporte parallel mit `Promise.all` ab.
- Beide Blobs werden getrennt als `.docx` heruntergeladen.
- Dateinamen werden weiterhin von unzulässigen Windows-Zeichen bereinigt.
- Fehlerantworten der API werden weiterhin als Meldung auf der Hauptseite angezeigt.
- ZIP-Erstellung ist aus diesem Exportpfad vollständig entfernt.

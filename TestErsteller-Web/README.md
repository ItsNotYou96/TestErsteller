# TestErsteller Web v3.0 – blockbasierter Importer

Der Admin-Importer wurde in v3.0 neu aufgebaut. Er versucht nicht mehr, jedes neue Dokumentformat mit zusätzlichen Spezial-Regeln/Regexen zu reparieren.

## Neue Importarchitektur

1. **PDF/DOCX → neutrale Dokumentblöcke**
   - Absatz, Tabellenzeile, Bild, Seitenumbruch
   - bei DOCX zusätzlich echte Word-Listenebene/-nummer, Absatzstil, Fettung und Schriftgröße
   - Word-Mathe (OMML) und Hoch-/Tiefstellung werden soweit möglich direkt erhalten
2. **Aufgabengrenzen**
   - eindeutige strukturelle Folgen (z. B. echte Word-Liste oder fortlaufende Dokumentnummerierung) werden deterministisch erkannt
   - ist die Struktur nicht eindeutig, gruppiert Groq ausschließlich vorhandene Block-IDs zu Aufgabenbereichen
   - Groq darf in diesem Schritt keinen Aufgabentext neu schreiben
3. **Exakte Metadaten zuerst deterministisch**
   - vorhandene BE/Punkte werden aus dem Original übernommen
   - fehlende Punkte/Zeit/AFB/etc. bekommen zunächst einen Vorschlag und können anschließend per Groq verfeinert werden
4. **PDF-Mathematik**
   - visuelle Analyse bestimmt niemals Aufgabengrenzen
   - nur bereits erkannte Aufgaben mit verdächtig beschädigter PDF-Mathe werden gezielt visuell nachtranskribiert
   - Zahlen, Teilaufgaben und normaler Wortlaut werden serverseitig gegen das Original validiert
5. **Duplikate**
   - Stufe 1: lokale Kandidatensuche über **alle Themen und K1–K6 der ausgewählten Klasse**
   - Stufe 2: Groq bewertet nur die besten Kandidaten semantisch als `Sehr ähnliche Variante`, `Gleicher Aufgabentyp`, `Inhaltlich verwandt` oder `Nicht ähnlich`
   - die bereits geladenen Kandidaten werden bei der späteren KI-Metadatenanalyse wiederverwendet; dadurch werden nicht pro Aufgabe erneut alle Notion-Datenbanken abgefragt

## Zusätzliche optionale Environment Variables

Die bisherigen Variablen bleiben gültig. Neu sind nur optionale Modell-Overrides:

```env
GROQ_STRUCTURE_MODEL=openai/gpt-oss-20b
GROQ_DUPLICATE_MODEL=openai/gpt-oss-20b
```

Ohne diese Angaben werden die obigen Defaults verwendet. `GROQ_API_KEY` und `GROQ_MODEL` bleiben unverändert.

## Sicherheitsprinzip des Importers

Wenn eine Dokumentstruktur weder deterministisch noch über eine validierte Blockgruppierung sicher ermittelt werden kann, wird der Import abgebrochen bzw. gewarnt. Der Importer erzeugt in diesem Fall bewusst keine erfundenen Aufgaben.

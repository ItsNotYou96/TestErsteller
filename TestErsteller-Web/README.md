# TestErsteller Web v3.2 – blockbasierter Importer

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

## v3.1 – sparsame Ähnlichkeitsanalyse

Die Duplikatprüfung arbeitet jetzt konsequent zweistufig:

1. Alle vorhandenen Aufgaben der gewählten Klasse werden lokal verglichen.
2. Groq wird nur aufgerufen, wenn der beste lokale Treffer mindestens 34 % erreicht.
3. An Groq gehen höchstens die fünf besten Kandidaten (jeweils gekürzt), nicht mehr ein großer Kandidatenpool.
4. Nahezu identische lokale Treffer ab 95 % werden ohne LLM als sehr ähnliche Variante markiert.
5. Bereits geladene Kandidaten werden nach der Metadatenanalyse wiederverwendet; fehlende sichtbare Treffer lösen keine zweite vollständige Notion-Suche mehr aus.

Dadurch sinken Groq-Tokenverbrauch und Wartezeiten deutlich, besonders bei mehreren Dokumenten in einem Importlauf.

## v3.2 – vollständige Ähnlichkeits-Queue

Die Metadatenanalyse und die semantische Ähnlichkeitsanalyse laufen jetzt in zwei getrennten Browser-Queues.

- Jede Aufgabe wird bereits beim Import lokal gegen die vorhandenen Aufgaben der Klasse geprüft.
- Nur lokal uneindeutige Treffer werden anschließend in eine Groq-Queue aufgenommen.
- Ein Groq-`429` bei der Ähnlichkeitsanalyse wird **nicht mehr als erfolgreicher Fallback verschluckt**. Die konkrete Aufgabe bleibt in der Queue, wartet anhand von `retry-after`/Token-Reset und wird danach automatisch erneut geprüft.
- Der bereits erfolgreiche Metadaten-Request wird bei einem Duplicate-Rate-Limit nicht wiederholt.
- Im linken Aufgabenbereich und im Editor ist pro Aufgabe sichtbar, ob die Prüfung `lokal ✓`, `KI ✓`, `prüft …`, `wartet` oder `Fehler` ist.
- Lokale Kandidaten bleiben während einer Rate-Limit-Wartezeit sichtbar.

Damit bedeutet ein Groq-Minutenlimit nur noch eine Wartezeit. Spätere Aufgaben werden nicht still übersprungen.

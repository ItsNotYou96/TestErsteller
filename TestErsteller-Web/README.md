# v4.4 – mathematische Struktur statt Wortlaut-Prozent

Die lokale Ähnlichkeitssuche abstrahiert mathematische Aufgaben jetzt zusätzlich strukturell. Konkrete Zahlen/Konstanten werden für den Vergleich ersetzt, Gleichungsformen werden als Operator-/Variablenstruktur verglichen und explizite Lernziele/Schülerhandlungen werden erkannt. Dadurch können zwei Aufgaben zum Lösen linearer Gleichungen und Bestimmen der Lösungsmenge als derselbe Aufgabentyp erkannt werden, obwohl Zahlen, Terme und Formulierungen deutlich verschieden sind. Eine zusätzliche Grundmengen-Bedingung gilt dabei als Zusatzanforderung und zerstört den Kernmatch nicht.

Die lokale Adminanzeige zeigt keine Prozentzahl mehr. Der frühere Suchwert war nur ein technischer Retrievalwert und wurde zu leicht als fachliche Ähnlichkeit interpretiert. Stattdessen stehen dort Stufen wie **Starker lokaler Kandidat**, **Plausibler lokaler Kandidat** und konkrete fachliche Gemeinsamkeiten, z. B. `lineare Gleichungen lösen`, `Lösungsmenge bestimmen`, `ähnliche algebraische Gleichungsstruktur`. Schwächere lokale Kandidaten bleiben weiterhin ab der bisherigen internen 18%-Retrievalschwelle sichtbar und vollständig aufklappbar.

Ein strukturell eindeutiger lokaler Treffer wird ohne Groq als `Gleicher Aufgabentyp` bestätigt. Dadurch spart die Ähnlichkeitsprüfung Tokens. Für unklare Fälle bleibt das Groq-Reranking bestehen, prüft aber höchstens noch drei lokale Kandidaten pro Aufgabe. Das Rate-Limit-Fallback aus v4.3 bleibt unverändert: lange Groq-Resets blockieren den Import nicht.

Regressionen: Die beiden Gleichungsaufgaben `Löse ... und bestimme die Lösungsmenge` und `Gib die Lösungsmenge an und beachte dabei die Grundmenge` werden trotz nur ca. 25% alter Textähnlichkeit strukturell als derselbe konkrete Aufgabentyp erkannt. Dagegen bleiben Nadja/Mutter vs. `Äquivalenzumformung erklären`, sprachliche Termbildung vs. Johannisbeer-Sachmodellierung und Quadrat/Flächeninhalt vs. Aussagen über negative Zahlen klar getrennt.

---

# v4.3 – Groq-Limits blockieren den Import nicht mehr

Groq-Rate-Limits werden jetzt bewusst als optionaler Verfeinerungsschritt behandelt. Kurze 429-Wartezeiten (bis 60 Sekunden) werden weiterhin automatisch wiederholt. Meldet Groq jedoch einen langen Reset – z. B. 1201 Sekunden – wartet die Adminseite nicht mehr minutenlang. Die jeweilige KI-Phase wird für diesen Import übersprungen und die bereits vorhandenen heuristischen bzw. lokalen Ergebnisse bleiben vollständig nutzbar. Nach zwei kurzen Rate-Limit-Retries wird ebenfalls lokal weitergearbeitet.

Für die lokale Ähnlichkeitssuche gilt jetzt: **Anzeigen ab 18 % Suchwert, Groq erst ab 34 %.** Dadurch kann die Lehrkraft auch schwächere lokale Kandidaten selbst prüfen, ohne jeden 18–30-%-Treffer teuer an Groq zu schicken. Bis zu fünf lokale Kandidaten werden vollständig aufklappbar angezeigt. Der Prozentwert heißt ausdrücklich **Suchwert** und ist keine bestätigte fachliche Ähnlichkeit.

Wird die semantische Groq-Prüfung wegen eines langen Limits ausgelassen, steht pro Aufgabe weiterhin `Lokal geprüft ✓`; die lokalen Kandidaten bleiben sichtbar. Metadaten, die wegen eines langen Limits nicht per Groq verfeinert werden konnten, bleiben heuristisch und editierbar.

---

# v4.2 – Rückkehr zur bewährten v3.7-Ähnlichkeitssuche

Die Ähnlichkeits-Engine wurde bewusst auf den letzten stabilen Retrieval-Kern aus v3.7 zurückgeführt. Die ab v3.8 eingeführten didaktischen Fingerprints, Profil-Boosts und späteren Hybrid-Gates wurden aus der Kandidatenauswahl entfernt, weil sie grobe thematische Gemeinsamkeiten teilweise höher gewichteten als tatsächlich ähnliche Aufgaben.

Beibehalten wurden die späteren technischen Verbesserungen: klassenweite Suche über alle Themen/K1–K6, Browser-Queue mit Retry bei Groq-429, Batch-Prüfung mehrerer Aufgaben, vollständiges Aufklappen der bestehenden Vergleichsaufgabe und keine sichtbaren Ähnlichkeits-Prozentwerte.

Für mehr Recall als im ursprünglichen v3.7 wird ein semantischer Groq-Vergleich bereits ab 22 % lokalem Retrievalwert ausgelöst (Kandidatenboden 18 %). Dabei werden höchstens die fünf besten Kandidaten nach der alten v3.7-Text-/Mathe-Suche geprüft. Grob thematische, aber lexikalisch und strukturell unpassende Aufgaben wie „Alters-Sachaufgabe“ vs. „Äquivalenzumformung erklären“ oder „sprachliche Termbildung“ vs. „Johannisbeer-Modellierung“ liegen lokal deutlich darunter und gelangen nicht in die semantische Trefferanzeige.

Nach einer Groq-Prüfung werden ausschließlich Kandidaten angezeigt, die Groq als `same_skill` oder `near_duplicate` bestätigt hat. Nicht geprüfte lokale Runner-ups können nicht mehr nachträglich als vermeintliche Ähnlichkeit erscheinen. Groq darf ausdrücklich alle Kandidaten als `not_related` bewerten; ein Treffer wird nicht erzwungen.

---

# v4.1 – transparente Ähnlichkeitsprüfung ohne Schein-Prozente

Die semantische Ähnlichkeitsanalyse verwendet keine frei vom LLM vergebenen Prozentwerte mehr. Groq beantwortet für jeden Vergleich nur noch sechs feste Ja/Nein-Kriterien: gleiches konkretes Lernziel, gleiche Schülerhandlung, gleicher mathematischer Lösungsweg, gleiche Darstellungsform, vergleichbare Aufgabenstruktur und nahezu gleiche Vorlage. Die Anwendung leitet daraus deterministisch `near_duplicate`, `same_skill`, `related` oder `not_related` ab.

Harte Gates: Unterscheiden sich konkretes Lernziel oder Schülerhandlung, kann ein Kandidat niemals als ähnlicher Aufgabentyp erscheinen. Unterscheidet sich die Darstellungsform (z. B. Sachmodellierung vs. abstrakte Verfahrens-Erklärung), wird ebenfalls kein `same_skill` vergeben. Prozentanzeigen wurden aus der Adminansicht entfernt; stattdessen zeigt der beste Treffer die sechs Kriterien mit ✓/✗.

Die lokale Vorauswahl wurde außerdem um den allgemeinen Aufgabentyp `procedure_explanation` erweitert. Aufgaben wie „Erkläre, wie ein Verfahren funktioniert“ werden damit von Anwendungs-/Modellierungsaufgaben getrennt, bevor Groq überhaupt Tokens verbraucht.

Regressionen: Eine Alters-Sachaufgabe (Nadja/Mutter) gegen „Erkläre eine Äquivalenzumformung“ ist lokal nicht einmal ein relevanter Kandidat; Grundmengen-/Lösungsmengen-Varianten und unterschiedlich formulierte Aufgaben zur sprachlichen Termbildung bleiben dagegen sichere Kandidaten.

---

# v3.9 – präzisere und sparsamere Ähnlichkeitsanalyse

Die lokale Stufe ist wieder ein strenger Retrieval-Filter statt eines möglichst breiten Netzes. Sie klassifiziert Aufgaben nach didaktischer Familie und Repräsentationsmodus (z. B. sprachliche Termübersetzung, Sachsituations-Modellierung, Termvereinfachung, Gleichungslösen). Oberflächlich ähnliche, didaktisch aber verschiedene Aufgaben werden vor Groq ausgesiebt. Insbesondere gilt: „mathematische Aussage in einen Term übersetzen“ und „Sachsituation durch einen Term modellieren“ sind verschiedene Aufgabentypen.

Groq wird nur noch aufgerufen, wenn der beste lokale Kandidat mindestens 38 % Retrieval-Evidenz erreicht. Pro neuer Aufgabe werden höchstens zwei Kandidaten an die semantische Prüfung geschickt. Bis zu vier neue Aufgaben werden in **einem** Groq-Request gebündelt, damit die langen Bewertungsinstruktionen nicht für jede Aufgabe erneut Tokens verbrauchen. Semantisch bloß `related` eingestufte Aufgaben werden nicht mehr als Ähnlichkeitstreffer angezeigt; sichtbar sind nur `same_skill` und `near_duplicate`.

# TestErsteller Web v3.7 – blockbasierter Importer

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

## v3.3 – robuste Bruch-/PDF-Mathe-Erkennung

Bei PDF-Mathematik wird jetzt zwischen **Aufgabenstruktur** und **mathematischem Layout** getrennt:

- `pdf-parse` erhält beim Textauslesen `itemJoiner: " "`, damit getrennte PDF-Textobjekte nicht versehentlich zu neuen Zahlen verschmelzen (z. B. `5` + `2` → `52`).
- Die Erkennung einer beschädigten mathematischen Textschicht betrachtet nicht mehr nur isolierte Zahlzeilen. Auch horizontal zusammengefallene nackte Zahlenfolgen innerhalb mathematischer Ausdrücke werden als mögliches Bruch-/Layoutproblem erkannt.
- Die Erkennung ist bewusst generisch: Sie entscheidet nur, **ob** eine bereits erkannte PDF-Aufgabe visuell geprüft werden soll. Sie rekonstruiert keine spezielle Aufgabe per Regex.
- Für die visuelle Reparatur wird zusätzlich die rohe Textspur der bereits feststehenden Aufgabe übergeben. Das Seitenbild bleibt für die räumliche Anordnung (Bruchstrich, Zähler/Nenner, Potenzen) maßgeblich.
- Der Vision-Prompt verlangt vollständige Formeln in `\\( ... \\)` und Brüche als `\\frac{...}{...}`, damit die Admin-KaTeX-Vorschau die gesamte Formel formatiert.
- Die Sicherheitsprüfung vergleicht Zahlen jetzt **pro Teilaufgabe** statt nur global. Groq darf also keine Zahl zwischen a), b), c) usw. verschieben.
- Die Option „Mathematik visuell korrigieren“ ist standardmäßig aktiviert, läuft aber weiterhin nur für Aufgaben mit verdächtigen PDF-Mathe-Signalen. Sie kann im Adminbereich deaktiviert werden.

Die visuelle Korrektur ändert weiterhin niemals Aufgabengrenzen oder normalen Aufgabentext.


## v3.4 – Bruchreparatur pro Teilaufgabe und sichtbare Vision-Queue

Die visuelle PDF-Mathekorrektur läuft nicht mehr versteckt innerhalb des initialen Import-Requests. Verdächtige Aufgaben werden zunächst nur markiert und danach im Browser nacheinander über `/api/admin/repair-math` verarbeitet. Ein Rate-Limit führt zu sichtbarem Warten/Retry; eine verworfene Korrektur bleibt mit konkreter Fehlermeldung an der Aufgabe sichtbar.

Bei Aufgaben mit mehreren Teilaufgaben darf Qwen die Buchstaben/Labels nicht mehr neu transkribieren. Der Parser behält die Originalfolge (auch doppelte Labels) unverändert und Qwen liefert ausschließlich den Inhalt der 1., 2., 3. ... Teilaufgabe in visueller Reihenfolge. Das verhindert, dass offensichtliche Tippfehler im Quelldokument (z. B. zweimal `e)`) vom Modell "korrigiert" werden und dadurch die gesamte mathematische Reparatur verworfen wird.

Jede zurückgegebene Teilaufgabe wird separat auf ihren Zahlenbestand und – soweit vorhanden – ihren normalen Wortlaut geprüft. Erst danach werden die visuell rekonstruierten Inhalte wieder hinter die unveränderten Original-Labels gesetzt.

## v3.5 – vollständige Musterlösungen und transparente lokale Ähnlichkeit

- Der Erwartungshorizont wird bei aktivierter KI nicht mehr als knapper Bewertungs-Hinweis angefordert, sondern als **vollständige Musterlösung**.
- Jede vorhandene Teilaufgabe soll einzeln gelöst werden. Rechenaufgaben enthalten Rechenweg und Endergebnis, Sachaufgaben Variable/Ansatz/Rechnung/Antwortsatz und Begründungsaufgaben eine vollständige fachliche Begründung.
- Der normale Metadaten-Request hat dafür mehr Ausgaberaum. Falls bei einer mehrteiligen Aufgabe Teilaufgaben im erzeugten Erwartungshorizont fehlen, wird automatisch ein gezielter zweiter Request nur für die vollständige Musterlösung ausgelöst.
- In der linken Admin-Aufgabenliste zeigt `Ähnlichkeit: lokal ✓` jetzt zusätzlich den **besten lokalen Vergleich mit Titel, Thema, Kompetenz und lokalem Prozentwert**.
- Dieselbe Referenz steht auch im grünen Statusfeld des geöffneten Editors, selbst wenn der lokale Treffer zu schwach ist, um als eigentliche Duplikatwarnung angezeigt zu werden.

## v3.6
- Lokale Ähnlichkeitstreffer lassen sich im Admin-Editor jetzt genauso wie KI-geprüfte Treffer über **„Bestehende Aufgabe vergleichen“** vollständig aufklappen.
- Das gilt auch für den besten lokalen Vergleich unterhalb der eigentlichen Duplikat-Warnschwelle; zuvor war dieser nur als Kurzzeile sichtbar.


## v3.7 – lokale Ähnlichkeit: relevante Treffer statt beliebiger „bester“ Aufgabe

Die lokale Prüfung unterscheidet jetzt zwischen **„lokal geprüft“** und **„lokal ähnlich“**. Ein mathematisch unpassender Kandidat wird nicht mehr nur deshalb als Vergleich angezeigt, weil er innerhalb der Datenbank zufällig den höchsten Rohwert hatte.

- Unter `34 %` lokalem Retrieval-Rohwert gilt: **kein relevanter lokaler Treffer**.
- In diesem Fall zeigt die Adminoberfläche nur **„Lokal geprüft ✓“** und keinen aufklappbaren Fremdvergleich.
- Erst ab der Relevanzschwelle erscheint **„Ähnlichkeit: lokal ✓“** samt vollständigem aufklappbarem Vergleich.
- Teilaufgabenlabels wie `a)` und `b)` zählen nicht mehr als mathematische Variablen; damit erzeugen zwei völlig unterschiedliche mehrteilige Aufgaben keine künstliche mathematische Überschneidung.
- Einzelbuchstaben werden Unicode-sicher erkannt, sodass z. B. das `w` in `wächst` nicht als Variable missverstanden wird.

Die 34-%-Grenze ist eine **Retrieval-Schwelle**, keine behauptete mathematische Wahrscheinlichkeit der Ähnlichkeit. Uneindeutige relevante Kandidaten werden weiterhin durch Groq semantisch nachgeprüft.

## v3.8 – Ähnlichkeit: Retrieval ≠ semantische Bewertung
- Der lokale Prozentwert ist nur noch ein **Suchwert für Kandidaten**, keine behauptete inhaltliche Ähnlichkeit.
- Die lokale Suche kombiniert Wort-/Formelmerkmale mit einem didaktischen Fingerprint aus mathematischem Gegenstand und geforderter Schülerhandlung.
- Bereits ab einem Suchwert von 16 % kann eine Aufgabe semantisch per Groq geprüft werden; dadurch werden anders formulierte Varianten nicht mehr bei 20–30 % abgeschnitten.
- Groq ist bei diesen Kandidaten die endgültige semantische Bewertung. Der lokale Suchwert wird nicht mehr in den KI-Prozentwert hineingemischt.
- Nach einer Groq-Prüfung werden nur Kandidaten angezeigt, die Groq tatsächlich bewertet hat; nicht gerankte lokale Kandidaten können nicht mehr versehentlich als Ähnlichkeit erscheinen.

## v4.0 – Hybrid-Ähnlichkeitssuche

Die Duplikatprüfung verwendet keinen einzelnen lokalen Prozentwert mehr als harte Schranke. Kandidaten können über vier voneinander unabhängige Signale in die semantische Prüfung gelangen: Wortlaut, didaktischer Aufgabentyp, mathematische Struktur und markante Fachmerkmale. Dadurch werden z. B. Aufgaben zu „Lösungsmenge unter Beachtung der Grundmenge (G = Z/N/Q)“ auch dann gefunden, wenn Zahlen und Formulierungen variieren.

Lokale Prozentwerte werden in der Adminansicht nicht mehr als Ähnlichkeitswert präsentiert. Stattdessen zeigt die Oberfläche bei einem lokalen Kandidaten die konkreten Auswahlgründe. Die eigentliche Ähnlichkeitsbewertung bleibt der semantischen Groq-Prüfung vorbehalten; nahezu identische Varianten können weiterhin lokal erkannt werden, um Tokens zu sparen.

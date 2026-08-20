"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Database, FileDown, Loader2, RefreshCw } from "lucide-react";
import type { Afb, Competence, TaskItem, TestMetadata } from "@/lib/types";
import { sumAfb, totalAfb } from "@/lib/scoring";

const competences: Competence[] = ["Argumentieren", "Problemlösen", "Modellieren", "Darstellungen", "Mathematik", "Kommunizieren"];
const afbs: Afb[] = ["AFB1", "AFB2", "AFB3"];
const fallbackClasses = ["7", "8", "9", "10"];
const competenceShort: Record<Competence, string> = {
  Argumentieren: "K1",
  "Problemlösen": "K2",
  Modellieren: "K3",
  Darstellungen: "K4",
  Mathematik: "K5",
  Kommunizieren: "K6",
};

function percent(part: number, total: number) {
  return total <= 0 ? 0 : Math.round((part / total) * 100);
}

export default function Home() {
  const [classes, setClasses] = useState<string[]>(fallbackClasses);
  const [topics, setTopics] = useState<string[]>([]);
  const [classLevel, setClassLevel] = useState("7");
  const [topic, setTopic] = useState("");
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Bereit.");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const [meta, setMeta] = useState<TestMetadata>({
    title: "Mathematik-Test",
    tools: "",
    formPoints: "",
    classLevel: "7",
    topic: "",
  });

  useEffect(() => {
    fetch("/api/notion?action=meta")
      .then(async (r) => ({ ok: r.ok, data: await r.json() }))
      .then(({ ok, data }) => {
        if (!ok) {
          setMessage(data.error || "Notion ist nicht konfiguriert.");
          return;
        }
        if (data.classes?.length) {
          setClasses(data.classes);
          setClassLevel(data.classes[0]);
        }
        if (data.topics?.length) {
          setTopics(data.topics);
          setTopic(data.topics[0]);
        }
      })
      .catch(() => setMessage("Metadaten konnten nicht geladen werden."));
  }, []);

  useEffect(() => {
    if (!topic) return;
    void loadTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classLevel, topic]);

  async function loadTasks() {
    if (!topic) return;
    setLoading(true);
    setMessage("Aufgaben werden geladen …");
    setSelected(new Set());
    try {
      const r = await fetch(`/api/notion?action=tasks&class=${encodeURIComponent(classLevel)}&topic=${encodeURIComponent(topic)}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Aufgaben konnten nicht geladen werden.");
      setTasks(data.tasks || []);
      setMessage(`${data.tasks?.length || 0} Aufgaben geladen.`);
    } catch (e) {
      setTasks([]);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function testDb() {
    setMessage("Datenbankverbindung wird geprüft …");
    setConnected(null);
    try {
      const r = await fetch("/api/notion?action=test");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Verbindung fehlgeschlagen.");
      setConnected(true);
      setMessage(`Datenbank erreichbar: ${data.title}`);
    } catch (e) {
      setConnected(false);
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const selectedTasks = useMemo(() => tasks.filter((t) => selected.has(t.id)), [tasks, selected]);
  const groupedTasks = useMemo(
    () => Object.fromEntries(competences.map((c) => [c, tasks.filter((t) => t.competence === c)])) as Record<Competence, TaskItem[]>,
    [tasks],
  );
  const totalPoints = selectedTasks.reduce((sum, task) => sum + task.maxPoints, 0);
  const totalTime = selectedTasks.reduce((sum, task) => sum + task.estimatedTime, 0);
  const mandatoryTotals = totalAfb(selectedTasks, "mandatory");
  const optimizedTotals = totalAfb(selectedTasks, "optimized");
  const mandatoryTotalPoints = sumAfb(mandatoryTotals);
  const optimizedTotalPoints = sumAfb(optimizedTotals);
  const competenceTotals = Object.fromEntries(
    competences.map((c) => [c, selectedTasks.filter((t) => t.competence === c).reduce((sum, task) => sum + task.maxPoints, 0)]),
  ) as Record<Competence, number>;

  async function exportDocs() {
    setShowDialog(false);
    setMessage("Word-Dateien werden erstellt …");
    try {
      const payload = { tasks: selectedTasks, metadata: { ...meta, classLevel, topic } };
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Export fehlgeschlagen.");
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${meta.title || "Mathematik-Test"}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Test und Erwartungshorizont wurden erstellt.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="shell">
      <header className="appHeader">
        <div>
          <h1>TestErsteller</h1>
          <p>Mathematik · Web-Version</p>
        </div>
        <div className="status" title={message}>
          <span className={connected === true ? "dot ok" : connected === false ? "dot bad" : "dot"} />
          <span>{message}</span>
        </div>
      </header>

      <section className="selectionBar panel">
        <label>
          Klasse
          <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
            {classes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="topicSelect">
          Thema
          <select value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="" disabled>Thema wählen</option>
            {topics.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <button className="iconButton" onClick={() => void loadTasks()} disabled={!topic || loading} title="Aufgaben neu laden">
          {loading ? <Loader2 className="spin" size={19} /> : <RefreshCw size={19} />}
        </button>
      </section>

      <section className="workspace">
        <section className="taskArea panel">
          <div className="panelTitleRow">
            <div>
              <h2>Aufgaben</h2>
              <p>{tasks.length} verfügbar · {selected.size} ausgewählt</p>
            </div>
          </div>

          {loading ? (
            <div className="empty"><Loader2 className="spin" size={22} />Aufgaben werden geladen …</div>
          ) : tasks.length === 0 ? (
            <div className="empty">Keine Aufgaben geladen. Wähle Klasse und Thema oder prüfe die Datenbankverbindung.</div>
          ) : (
            <div className="competenceScroller">
              <div className="competenceGrid">
                {competences.map((competence, competenceIndex) => (
                  <section className={`competenceGroup compBorder-${competenceIndex}`} key={competence}>
                    <header className={`competenceHeader compBg-${competenceIndex}`}>
                      <span className="competenceCode">{competenceShort[competence]}</span>
                      <div>
                        <strong>{competence}</strong>
                        <small>{groupedTasks[competence].length} Aufgaben</small>
                      </div>
                    </header>
                    <div className="competenceTasks">
                      {groupedTasks[competence].length === 0 ? (
                        <div className="noGroupTasks">Keine Aufgaben</div>
                      ) : groupedTasks[competence].map((task) => (
                        <label
                          className={`taskChoice ${selected.has(task.id) ? "selected" : ""}`}
                          key={task.id}
                          title={task.title}
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(task.id)}
                            onChange={() => toggle(task.id)}
                          />
                          <span className="taskChoiceBody">
                            <strong>{task.title || "Aufgabe"}</strong>
                            <span className="taskQuestion">{task.questionText || "Kein Aufgabentext hinterlegt."}</span>
                            <span className="taskFacts">
                              <span>{task.pointsRaw || `${task.maxPoints}`} P</span>
                              {task.estimatedTime > 0 && <span>{task.estimatedTime} min</span>}
                              {task.imageUrl && <span>Bild</span>}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </section>

        <aside className="analysisPanel panel">
          <section className="analysisSection summarySection">
            <h2>Testübersicht</h2>
            <div className="summaryGrid">
              <div><b>{selected.size}</b><span>Aufgaben</span></div>
              <div><b>{totalPoints}</b><span>Punkte</span></div>
              <div><b>{totalTime}</b><span>Minuten</span></div>
            </div>
          </section>

          <DistributionTable
            title="AFB-Verteilung · Pflicht"
            hint="Sternchen-Teilaufgaben ausgeschlossen"
            rows={afbs.map((a) => ({ label: a, points: mandatoryTotals[a], share: percent(mandatoryTotals[a], mandatoryTotalPoints) }))}
          />

          <DistributionTable
            title="AFB-Verteilung · Sternchen"
            hint="Sternchen zuerst, danach normale Teilaufgaben bis MaxPoints"
            rows={afbs.map((a) => ({ label: a, points: optimizedTotals[a], share: percent(optimizedTotals[a], optimizedTotalPoints) }))}
          />

          <DistributionTable
            title="Kompetenz-Verteilung"
            rows={competences.map((c) => ({ label: `${competenceShort[c]} ${c}`, points: competenceTotals[c], share: percent(competenceTotals[c], totalPoints) }))}
          />

          <div className="actionArea">
            <button className="secondary" onClick={() => void testDb()}><Database size={18} />Test DB</button>
            <button
              className="primary"
              onClick={() => {
                setMeta((m) => ({ ...m, classLevel, topic }));
                setShowDialog(true);
              }}
              disabled={!selected.size}
            >
              <FileDown size={18} />Erstellen
            </button>
          </div>
        </aside>
      </section>

      {showDialog && (
        <div className="overlay" onMouseDown={() => setShowDialog(false)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dialogHead">
              <div><div className="eyebrow">EXPORT</div><h2>Testeigenschaften</h2></div>
              <CheckCircle2 />
            </div>
            <label>Titel<input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></label>
            <label>Hilfsmittel<input value={meta.tools} onChange={(e) => setMeta({ ...meta, tools: e.target.value })} placeholder="z. B. Taschenrechner, Formelsammlung" /></label>
            <label>Formelpunkte<input value={meta.formPoints} onChange={(e) => setMeta({ ...meta, formPoints: e.target.value })} placeholder="optional" /></label>
            <div className="dialogStats">{selected.size} Aufgaben · {totalPoints} Punkte · {totalTime} Minuten</div>
            <div className="dialogActions">
              <button className="secondary" onClick={() => setShowDialog(false)}>Abbrechen</button>
              <button className="primary" onClick={() => void exportDocs()}>Test + EWH erstellen</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function DistributionTable({
  title,
  hint,
  rows,
}: {
  title: string;
  hint?: string;
  rows: Array<{ label: string; points: number; share: number }>;
}) {
  return (
    <section className="analysisSection">
      <h2>{title}</h2>
      {hint && <p className="tableHint">{hint}</p>}
      <div className="tableWrap">
        <table className="distributionTable">
          <thead><tr><th>Bereich</th><th>Punkte</th><th>Anteil</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{row.points}</td>
                <td>{row.share}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

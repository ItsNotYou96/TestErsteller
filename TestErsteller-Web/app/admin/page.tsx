"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, FileSearch, Loader2, LogOut, Shield, Trash2, Upload, X } from "lucide-react";
import { LatexText } from "@/components/LatexText";
import type { AdminStatus, ImportDraft } from "@/lib/adminTypes";
import type { Competence } from "@/lib/types";
import { LEGACY_CLASSES, LEGACY_TOPICS_BY_CLASS } from "@/lib/wpfDatabaseMap";
import { parsePointsSpec } from "@/lib/taskParsing";

const competences: Competence[] = ["Argumentieren", "Problemlösen", "Modellieren", "Darstellungen", "Mathematik", "Kommunizieren"];

type ImportHistoryEntry = {
  at: string;
  files: string[];
  imported: number;
  failed: number;
  titles: string[];
};

export default function AdminPage() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [code, setCode] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [defaultClass, setDefaultClass] = useState("7");
  const [defaultTopic, setDefaultTopic] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sourceSummary, setSourceSummary] = useState<Array<{ name: string; characters: number; images: number }>>([]);
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);

  useEffect(() => {
    fetch("/api/admin/auth")
      .then((r) => r.json())
      .then((data) => {
        setStatus(data);
        setUseLlm(Boolean(data.llmConfigured));
      })
      .catch(() => setStatus({ authenticated: false, configured: false, llmConfigured: false, notionConfigured: false }));
    try { setHistory(JSON.parse(localStorage.getItem("testersteller_import_history") || "[]")); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    const topics = LEGACY_TOPICS_BY_CLASS[defaultClass] || [];
    if (!topics.includes(defaultTopic)) setDefaultTopic("");
  }, [defaultClass, defaultTopic]);

  const selected = useMemo(() => drafts.find((x) => x.id === selectedId) || drafts[0], [drafts, selectedId]);
  const includedCount = drafts.filter((x) => x.include).length;

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setLoginError("");
    setBusy(true);
    try {
      const r = await fetch("/api/admin/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Login fehlgeschlagen.");
      const refreshed = await fetch("/api/admin/auth").then((x) => x.json());
      setStatus(refreshed);
      setUseLlm(Boolean(refreshed.llmConfigured));
      setCode("");
    } catch (error) { setLoginError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    setStatus((s) => s ? { ...s, authenticated: false } : s);
    setDrafts([]);
  }

  async function analyze() {
    if (!files.length) { setMessage("Bitte zuerst PDF- oder DOCX-Dateien auswählen."); return; }
    setBusy(true);
    setMessage("Dokumente werden analysiert …");
    setWarnings([]);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      if (defaultClass) form.append("classLevel", defaultClass);
      if (defaultTopic) form.append("topic", defaultTopic);
      form.append("useLlm", String(useLlm));
      const r = await fetch("/api/admin/import", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Importanalyse fehlgeschlagen.");
      setDrafts(data.drafts || []);
      setSelectedId(data.drafts?.[0]?.id || "");
      setWarnings(data.warnings || []);
      setSourceSummary(data.sourceSummary || []);
      setMessage(`${data.drafts?.length || 0} Aufgaben erkannt. Bitte Vorschläge prüfen.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function patchDraft(id: string, patch: Partial<ImportDraft>) {
    setDrafts((prev) => prev.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function changeClass(draft: ImportDraft, classLevel: string) {
    const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
    patchDraft(draft.id, { classLevel, topic: topics.includes(draft.topic) ? draft.topic : topics[0] || "", duplicate: undefined });
  }

  async function addImage(draft: ImportDraft, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Bitte eine Bilddatei auswählen."); return; }
    if (file.size > 1024 * 1024) { setMessage("Das manuell ergänzte Bild sollte wegen des Vercel-Uploadlimits höchstens 1 MB groß sein."); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    patchDraft(draft.id, { imageDataUrl: dataUrl, imageName: file.name });
  }

  async function commit() {
    const included = drafts.filter((x) => x.include);
    if (!included.length) { setMessage("Keine Aufgaben für den Import markiert."); return; }
    if (!confirm(`${included.length} Aufgabe(n) jetzt endgültig in die zugeordneten Notion-Datenbanken schreiben?`)) return;
    setBusy(true);
    const allResults: any[] = [];
    try {
      for (let i = 0; i < included.length; i++) {
        const draft = included[i];
        setMessage(`Aufgabe ${i + 1} von ${included.length} wird nach Notion übertragen: ${draft.title}`);
        const r = await fetch("/api/admin/commit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ drafts: [{ ...draft, include: true }] }),
        });
        const data = await r.json().catch(() => ({}));
        if (Array.isArray(data.results)) allResults.push(...data.results);
        else allResults.push({ ok: false, title: draft.title, error: data.error || `HTTP ${r.status}` });
      }
      const successes = allResults.filter((x) => x.ok);
      const failures = allResults.filter((x) => !x.ok);
      const entry: ImportHistoryEntry = { at: new Date().toISOString(), files: files.map((x) => x.name), imported: successes.length, failed: failures.length, titles: successes.map((x) => x.title) };
      const nextHistory = [entry, ...history].slice(0, 30);
      setHistory(nextHistory);
      localStorage.setItem("testersteller_import_history", JSON.stringify(nextHistory));
      setMessage(failures.length
        ? `${successes.length} Aufgaben importiert, ${failures.length} fehlgeschlagen: ${failures.map((x) => `${x.title}: ${x.error}`).join(" | ")}`
        : `${successes.length} Aufgaben erfolgreich in Notion übernommen.`);
      if (!failures.length) {
        setDrafts([]); setSelectedId(""); setFiles([]); setSourceSummary([]); setWarnings([]);
      } else {
        const failedTitles = new Set(failures.map((x) => x.title));
        setDrafts((prev) => prev.filter((x) => failedTitles.has(x.title)));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  if (!status) return <main className="adminLoading"><Loader2 className="spin" />Adminbereich wird geladen …</main>;

  if (!status.authenticated) {
    return (
      <main className="adminLoginPage">
        <a href="/" className="adminBack"><ArrowLeft size={16} />Zum TestErsteller</a>
        <form className="adminLoginCard" onSubmit={login}>
          <span className="adminLoginIcon"><Shield size={30} /></span>
          <h1>Adminbereich</h1>
          <p>Aufgaben aus PDF- und DOCX-Dateien prüfen und in den Aufgabenpool übernehmen.</p>
          {!status.configured && <div className="adminWarning"><AlertTriangle size={17} />In Vercel muss zuerst <code>ADMIN_CODE</code> gesetzt werden.</div>}
          <label>Admin-Code<input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus disabled={!status.configured} /></label>
          {loginError && <div className="adminError">{loginError}</div>}
          <button className="primary" disabled={!status.configured || busy}>{busy ? <Loader2 className="spin" size={17} /> : <Shield size={17} />}Anmelden</button>
        </form>
      </main>
    );
  }

  return (
    <main className="adminShell">
      <header className="adminHeader">
        <div>
          <a href="/" className="adminBack"><ArrowLeft size={15} />TestErsteller</a>
          <h1>Aufgabenimport</h1>
          <p>Dokumente analysieren, Vorschläge prüfen und kontrolliert nach Notion übernehmen.</p>
        </div>
        <div className="adminHeaderActions">
          <span className={`adminCapability ${status.notionConfigured ? "ok" : "bad"}`}>Notion {status.notionConfigured ? "bereit" : "fehlt"}</span>
          <span className={`adminCapability ${status.llmConfigured ? "ok" : "neutral"}`}>{status.llmConfigured ? `KI: ${status.llmModel}` : "KI optional"}</span>
          <button className="secondary" onClick={() => void logout()}><LogOut size={16} />Abmelden</button>
        </div>
      </header>

      <section className="adminUploadCard panel">
        <div className="adminSectionTitle"><Upload size={19} /><div><h2>1. Dokumente hochladen</h2><p>Klassenarbeit, Arbeitsblatt und optional Erwartungshorizont gemeinsam auswählen.</p></div></div>
        <div className="adminUploadGrid">
          <label className="adminFileDrop">
            <input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            <FileSearch size={24} />
            <strong>{files.length ? `${files.length} Datei(en) ausgewählt` : "PDF / DOCX auswählen"}</strong>
            <span>{files.length ? files.map((x) => x.name).join(" · ") : "Mehrere Dateien sind möglich, z. B. Test + Erwartungshorizont. Zusammen derzeit max. 4 MB (Vercel-Limit)."}</span>
          </label>
          <div className="adminContextFields">
            <label>Klasse als Vorgabe<select value={defaultClass} onChange={(e) => setDefaultClass(e.target.value)}><option value="">Automatisch erkennen</option>{LEGACY_CLASSES.filter((x) => Number(x) <= 10).map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Thema als Vorgabe<select value={defaultTopic} onChange={(e) => setDefaultTopic(e.target.value)}><option value="">Automatisch erkennen</option>{(LEGACY_TOPICS_BY_CLASS[defaultClass] || []).map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="adminLlmToggle"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={!status.llmConfigured} /><span><b>KI-Analyse verwenden</b><small>{status.llmConfigured ? "Empfohlen für Kompetenz, AFB, Zeit und Erwartungshorizont. Dabei wird der Dokumentinhalt an die konfigurierte OpenAI-API gesendet." : "OPENAI_API_KEY nicht gesetzt – heuristische Analyse bleibt verfügbar."}</small></span><Bot size={18} /></label>
            <button className="primary adminAnalyzeButton" disabled={busy || !files.length} onClick={() => void analyze()}>{busy ? <Loader2 className="spin" size={17} /> : <FileSearch size={17} />}Aufgaben erkennen</button>
          </div>
        </div>
        {message && <div className="adminMessage">{message}</div>}
        {warnings.map((warning, i) => <div className="adminWarning" key={i}><AlertTriangle size={16} />{warning}</div>)}
        {sourceSummary.length > 0 && <div className="adminSourceSummary">{sourceSummary.map((x) => <span key={x.name}><b>{x.name}</b> · {x.characters.toLocaleString("de-DE")} Zeichen · {x.images} Bilder</span>)}</div>}
      </section>

      {drafts.length > 0 && (
        <section className="adminReview panel">
          <div className="adminReviewHeader">
            <div><h2>2. Import prüfen</h2><p>{drafts.length} Aufgaben erkannt · {includedCount} zum Import markiert</p></div>
            <button className="primary" disabled={busy || includedCount === 0 || !status.notionConfigured} onClick={() => void commit()}><CheckCircle2 size={17} />{includedCount} nach Notion übernehmen</button>
          </div>
          <div className="adminReviewLayout">
            <aside className="adminDraftList">
              {drafts.map((draft, index) => (
                <button key={draft.id} className={`adminDraftCard ${selected?.id === draft.id ? "active" : ""} ${!draft.include ? "excluded" : ""}`} onClick={() => setSelectedId(draft.id)}>
                  <span className="adminDraftIndex">{index + 1}</span>
                  <span className="adminDraftText"><strong>{draft.title}</strong><small>{draft.classLevel} · {draft.topic} · {draft.competence}</small><small>{draft.pointsRaw || "?"} P. · {draft.estimatedTime || "?"} min · {draft.analysisMode === "llm" ? "KI" : "Heuristik"}</small></span>
                  <span className="adminDraftBadges">{draft.duplicate && <em className={draft.duplicate.score >= .86 ? "danger" : "warn"}>{Math.round(draft.duplicate.score * 100)}% ähnlich</em>}{draft.include ? <Check size={16} /> : <X size={16} />}</span>
                </button>
              ))}
            </aside>

            {selected && (
              <article className="adminEditor">
                <div className="adminEditorTop">
                  <div><span className="eyebrow">{selected.analysisMode === "llm" ? "KI-VORSCHLAG" : "HEURISTISCHER VORSCHLAG"}</span><h2>{selected.title || "Aufgabe"}</h2><p>Quelle: {selected.sourceFile}</p></div>
                  <label className={`adminIncludeToggle ${selected.include ? "on" : ""}`}><input type="checkbox" checked={selected.include} onChange={(e) => patchDraft(selected.id, { include: e.target.checked })} />{selected.include ? "Wird importiert" : "Verworfen"}</label>
                </div>

                {selected.duplicate && (
                  <section className={`adminDuplicate ${selected.duplicate.score >= .86 ? "high" : ""}`}>
                    <div><AlertTriangle size={18} /><strong>Mögliches Duplikat: {Math.round(selected.duplicate.score * 100)} % Ähnlichkeit</strong></div>
                    <p><b>Vorhanden:</b> {selected.duplicate.title} · {selected.duplicate.competence}</p>
                    <details><summary>Vorhandene Aufgabe vergleichen</summary><div className="adminExistingQuestion"><LatexText text={selected.duplicate.questionText} /></div></details>
                  </section>
                )}

                <div className="adminEditorGrid">
                  <label className="span2">Titel<input value={selected.title} onChange={(e) => patchDraft(selected.id, { title: e.target.value })} /></label>
                  <label>Klasse<select value={selected.classLevel} onChange={(e) => changeClass(selected, e.target.value)}>{LEGACY_CLASSES.filter((x) => Number(x) <= 10).map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>Thema<select value={selected.topic} onChange={(e) => patchDraft(selected.id, { topic: e.target.value, duplicate: undefined })}>{(LEGACY_TOPICS_BY_CLASS[selected.classLevel] || []).map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>Kompetenz<select value={selected.competence} onChange={(e) => patchDraft(selected.id, { competence: e.target.value as Competence })}>{competences.map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>AFB<input value={selected.afbRaw} onChange={(e) => patchDraft(selected.id, { afbRaw: e.target.value })} placeholder="z. B. a: AFB 1, b: AFB 2" /></label>
                  <label>Punkte<input value={selected.pointsRaw} onChange={(e) => { const pointsRaw = e.target.value; patchDraft(selected.id, { pointsRaw, maxPoints: parsePointsSpec(pointsRaw).maxPoints }); }} placeholder="z. B. 1+1+2" /></label>
                  <label>Zeit (Min.)<input type="number" min="0" step="0.5" value={selected.estimatedTime || ""} onChange={(e) => patchDraft(selected.id, { estimatedTime: Number(e.target.value) || 0 })} /></label>
                  <label className="span2">Aufgabentext<textarea rows={9} value={selected.questionText} onChange={(e) => patchDraft(selected.id, { questionText: e.target.value })} /></label>
                  <label className="span2">Erwartungshorizont<textarea rows={8} value={selected.expectation} onChange={(e) => patchDraft(selected.id, { expectation: e.target.value })} placeholder="Lösung / Bewertungserwartung" /></label>
                </div>

                <section className="adminPreview">
                  <div className="adminPreviewHead"><strong>Vorschau</strong><span>{selected.maxPoints || "?"} P. · {selected.afbRaw || "AFB ?"} · {selected.estimatedTime || "?"} min</span></div>
                  <h3>{selected.title}</h3>
                  <div className="adminPreviewQuestion"><LatexText text={selected.questionText} /></div>
                  {selected.imageDataUrl && <img src={selected.imageDataUrl} alt="Aufgabenabbildung" />}
                </section>

                <div className="adminImageRow">
                  <label className="secondary adminImageButton">Bild auswählen<input type="file" accept="image/*" onChange={(e) => void addImage(selected, e.target.files?.[0])} /></label>
                  {selected.imageDataUrl && <button className="secondary" onClick={() => patchDraft(selected.id, { imageDataUrl: undefined, imageName: undefined })}><Trash2 size={15} />Bild entfernen</button>}
                  <span>{selected.imageName || "Bei DOCX werden nahe Aufgabenbilder automatisch übernommen; bei PDF kann hier manuell ergänzt werden."}</span>
                </div>
              </article>
            )}
          </div>
        </section>
      )}

      <section className="adminHistory panel">
        <div className="adminSectionTitle"><CheckCircle2 size={18} /><div><h2>Importverlauf</h2><p>Auf diesem Browser gespeicherte erfolgreiche Imports.</p></div></div>
        {history.length === 0 ? <div className="adminHistoryEmpty">Noch keine Imports auf diesem Gerät.</div> : history.map((entry, i) => <div className="adminHistoryItem" key={`${entry.at}-${i}`}><div><strong>{new Date(entry.at).toLocaleString("de-DE")}</strong><span>{entry.files.join(", ")}</span></div><div><b>{entry.imported}</b> importiert{entry.failed ? ` · ${entry.failed} fehlgeschlagen` : ""}</div></div>)}
      </section>
    </main>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCircle2, Code2, Eye, FileSearch, Loader2, LogOut, Shield, Trash2, Upload, X } from "lucide-react";
import { LatexText } from "@/components/LatexText";
import { LOCAL_RELEVANCE_THRESHOLD, type AdminStatus, type ImportDraft, type SimilarityRubric } from "@/lib/adminTypes";
import type { Competence } from "@/lib/types";
import { LEGACY_CLASSES, LEGACY_TOPICS_BY_CLASS } from "@/lib/wpfDatabaseMap";
import { parsePointsSpec } from "@/lib/taskParsing";

const competences: Competence[] = ["Argumentieren", "Problemlösen", "Modellieren", "Darstellungen", "Mathematik", "Kommunizieren"];

// Short Groq throttles are worth waiting out. A reset measured in many minutes is not:
// the admin should remain usable with heuristic metadata and local duplicate candidates.
const MAX_AUTO_GROQ_WAIT_SECONDS = 60;
const MAX_SHORT_RATE_LIMIT_RETRIES = 2;

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
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const fileDragDepth = useRef(0);
  const [defaultClass, setDefaultClass] = useState("7");
  const [defaultTopic, setDefaultTopic] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [useVisionOcr, setUseVisionOcr] = useState(true);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [sourceSummary, setSourceSummary] = useState<Array<{ name: string; characters: number; blocks?: number; images: number; method?: string }>>([]);
  const [history, setHistory] = useState<ImportHistoryEntry[]>([]);
  const [editQuestionSource, setEditQuestionSource] = useState(false);
  const [editExpectationSource, setEditExpectationSource] = useState(false);

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

  useEffect(() => {
    setEditQuestionSource(false);
    setEditExpectationSource(false);
  }, [selectedId]);

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

  function acceptDocuments(incoming: File[], append = true) {
    const allowed = incoming.filter((file) => {
      const name = file.name.toLowerCase();
      return name.endsWith(".pdf") || name.endsWith(".docx") ||
        file.type === "application/pdf" ||
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    });
    const rejected = incoming.filter((file) => !allowed.includes(file));

    const base = append ? files : [];
    const merged = [...base, ...allowed].filter((file, index, all) =>
      all.findIndex((candidate) => candidate.name === file.name && candidate.size === file.size && candidate.lastModified === file.lastModified) === index
    );
    const limited = merged.slice(0, 10);
    const totalBytes = limited.reduce((sum, file) => sum + file.size, 0);

    if (rejected.length) {
      setMessage(`Nicht unterstützt: ${rejected.map((file) => file.name).join(", ")}. Bitte nur PDF oder DOCX verwenden.`);
    } else if (merged.length > 10) {
      setMessage("Es können höchstens 10 Dateien gleichzeitig verarbeitet werden.");
    } else if (totalBytes > 4 * 1024 * 1024) {
      setMessage("Die ausgewählten Dateien sind zusammen größer als 4 MB. Bitte die Dateien auf mehrere Importe verteilen.");
    } else {
      setMessage("");
    }

    setFiles(totalBytes > 4 * 1024 * 1024 ? base : limited);
  }

  function removeDocument(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onFileDragEnter(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDraggingFiles(true);
  }

  function onFileDragOver(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) {
      e.dataTransfer.dropEffect = "copy";
      setIsDraggingFiles(true);
    }
  }

  function onFileDragLeave(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setIsDraggingFiles(false);
  }

  function onFileDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    fileDragDepth.current = 0;
    setIsDraggingFiles(false);
    acceptDocuments(Array.from(e.dataTransfer.files || []), true);
  }

  async function analyze() {
    if (!files.length) { setMessage("Bitte zuerst PDF- oder DOCX-Dateien auswählen."); return; }
    setBusy(true);
    setMessage("Dokumente werden ausgelesen und Aufgaben getrennt …");
    setWarnings([]);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      if (defaultClass) form.append("classLevel", defaultClass);
      if (defaultTopic) form.append("topic", defaultTopic);
      form.append("useLlm", String(useLlm));
      form.append("useVisionOcr", String(useVisionOcr));
      const r = await fetch("/api/admin/import", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Importanalyse fehlgeschlagen.");

      let working: ImportDraft[] = data.drafts || [];
      setDrafts(working);
      setSelectedId(working[0]?.id || "");
      setWarnings(data.warnings || []);
      setSourceSummary(data.sourceSummary || []);

      // Visual PDF math repair is a separate browser-side queue. It runs only for tasks that
      // the deterministic PDF analysis marked as suspicious. Rate limits are waited out and
      // failures remain visible on the exact task instead of silently keeping broken text.
      if (useVisionOcr && working.some((draft) => draft.mathRepair === "needed")) {
        const mathWarnings: string[] = [];
        const repairIndexes = working.map((draft, index) => draft.mathRepair === "needed" ? index : -1).filter((index) => index >= 0);
        for (let queueIndex = 0; queueIndex < repairIndexes.length; queueIndex++) {
          const i = repairIndexes[queueIndex];
          const sourceFile = files.find((file) => file.name === working[i].sourceFile);
          if (!sourceFile) {
            working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "failed", mathRepairNote: "Quelldatei für die visuelle Reparatur nicht mehr verfügbar." } : draft);
            setDrafts([...working]);
            mathWarnings.push(`${working[i].title}: Quelldatei nicht gefunden.`);
            continue;
          }

          working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "checking", mathRepairNote: "Mathematische Anordnung wird im PDF-Bild nachgelesen …" } : draft);
          setDrafts([...working]);

          let mathRateLimitRetries = 0;
          while (true) {
            setMessage(`Mathematik ${queueIndex + 1}/${repairIndexes.length}: ${working[i].title}`);
            const repairForm = new FormData();
            repairForm.append("file", sourceFile);
            repairForm.append("questionText", working[i].questionText);
            repairForm.append("pages", JSON.stringify(working[i].sourcePages || []));
            const rr = await fetch("/api/admin/repair-math", { method: "POST", body: repairForm });
            const result = await rr.json().catch(() => ({}));

            if (rr.ok && typeof result.correctedText === "string" && result.correctedText.trim()) {
              working = working.map((draft, index) => index === i ? {
                ...draft,
                questionText: result.correctedText,
                mathRepair: "visual",
                mathRepairNote: `Mathematische Schreibweise visuell mit ${result.model || "Groq Vision"} rekonstruiert.`,
              } : draft);
              setDrafts([...working]);
              break;
            }

            if (rr.status === 429) {
              const retrySeconds = Math.max(2, Number(result.retryAfterSeconds) || parseResetSeconds(result.resetTokens) || 8);
              if (retrySeconds > MAX_AUTO_GROQ_WAIT_SECONDS || mathRateLimitRetries >= MAX_SHORT_RATE_LIMIT_RETRIES) {
                const note = `Groq-Limit: visuelle Mathekorrektur für diesen Import übersprungen (Reset in ca. ${Math.ceil(retrySeconds)} s).`;
                working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "rejected", mathRepairNote: note } : draft);
                setDrafts([...working]);
                mathWarnings.push(`${working[i].title}: ${note}`);
                break;
              }
              mathRateLimitRetries += 1;
              working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "needed", mathRepairNote: `Groq-Limit erreicht; kurzer Retry in ${Math.ceil(retrySeconds)} s.` } : draft);
              setDrafts([...working]);
              setMessage(`Mathematik ${queueIndex + 1}/${repairIndexes.length}: Groq-Limit erreicht · kurzer Retry in ${Math.ceil(retrySeconds)} s …`);
              await sleep((retrySeconds + 0.5) * 1000);
              working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "checking", mathRepairNote: "Mathematische Anordnung wird im PDF-Bild nachgelesen …" } : draft);
              setDrafts([...working]);
              continue;
            }

            const reason = result.error || `HTTP ${rr.status}`;
            working = working.map((draft, index) => index === i ? { ...draft, mathRepair: "rejected", mathRepairNote: reason } : draft);
            setDrafts([...working]);
            mathWarnings.push(`${working[i].title}: ${reason}`);
            break;
          }
        }
        if (mathWarnings.length) setWarnings((prev) => [...prev, `Visuelle Mathekorrektur: ${mathWarnings.join(" | ")}`]);
      }

      if (data.llmRequested && working.length) {
        const llmWarnings: string[] = [];
        let stopMetadataGroq = false;
        for (let i = 0; i < working.length; i++) {
          if (stopMetadataGroq) break;
          setMessage(`Metadaten ${i + 1}/${working.length}: ${working[i].title}`);
          let completed = false;
          for (let attempt = 0; attempt < 4 && !completed; attempt++) {
            const rr = await fetch("/api/admin/analyze-task", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ draft: working[i], classLevel: defaultClass || undefined, topic: defaultTopic || undefined }),
            });
            const result = await rr.json().catch(() => ({}));
            if (rr.ok && result.draft) {
              working = working.map((draft, index) => index === i ? result.draft : draft);
              setDrafts([...working]);
              completed = true;
              break;
            }
            if (rr.status === 429) {
              const retrySeconds = Math.max(2, Number(result.retryAfterSeconds) || parseResetSeconds(result.resetTokens) || 8);
              if (retrySeconds > MAX_AUTO_GROQ_WAIT_SECONDS || attempt >= MAX_SHORT_RATE_LIMIT_RETRIES) {
                stopMetadataGroq = true;
                completed = true; // Heuristische Werte dieser und der restlichen Aufgaben behalten.
                llmWarnings.push(`Groq-Metadatenlimit erreicht (Reset in ca. ${Math.ceil(retrySeconds)} s). Weitere Metadaten werden für diesen Import heuristisch belassen; es wird nicht minutenlang gewartet.`);
                setMessage(`Groq-Metadatenlimit erreicht · kein Warten auf ${Math.ceil(retrySeconds)} s · Import läuft lokal weiter …`);
                break;
              }
              setMessage(`Metadaten ${i + 1}/${working.length}: Groq-Limit erreicht · kurzer Retry in ${Math.ceil(retrySeconds)} s …`);
              await sleep((retrySeconds + 0.5) * 1000);
              continue;
            }
            llmWarnings.push(`${working[i].title}: ${result.error || `Groq HTTP ${rr.status}`}`);
            completed = true; // Heuristische Werte für diese Aufgabe behalten.
          }
          if (!completed) llmWarnings.push(`${working[i].title}: Groq-Limit nach mehreren Versuchen weiterhin erreicht; Heuristik beibehalten.`);
        }
        if (llmWarnings.length) setWarnings((prev) => [...prev, `Einige Aufgaben konnten nicht per Groq verfeinert werden: ${llmWarnings.join(" | ")}`]);
      }

      // Duplicate checking is a separate, batched queue. Local retrieval has already searched the
      // whole class. Only genuinely plausible candidates reach Groq, and up to four tasks share one
      // semantic request so the long comparison instructions are not paid repeatedly per task.
      if (data.llmRequested && working.length) {
        const duplicateWarnings: string[] = [];
        const pendingIds = working.filter((draft) => draft.duplicateNeedsRerank).map((draft) => draft.id);
        const batches: string[][] = [];
        for (let offset = 0; offset < pendingIds.length; offset += 4) batches.push(pendingIds.slice(offset, offset + 4));

        let stopDuplicateGroq = false;
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          if (stopDuplicateGroq) break;
          const ids = new Set(batches[batchIndex]);
          working = working.map((draft) => ids.has(draft.id) ? {
            ...draft,
            duplicateCheckStatus: "checking",
            duplicateCheckNote: "Semantische Ähnlichkeitsprüfung läuft …",
          } : draft);
          setDrafts([...working]);

          let duplicateRateLimitRetries = 0;
          while (true) {
            const batchDrafts = working.filter((draft) => ids.has(draft.id));
            setMessage(`Ähnlichkeit: Paket ${batchIndex + 1}/${batches.length} · ${batchDrafts.length} Aufgabe${batchDrafts.length === 1 ? "" : "n"}`);
            const rr = await fetch("/api/admin/check-duplicates-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ drafts: batchDrafts }),
            });
            const result = await rr.json().catch(() => ({}));

            if (rr.ok && Array.isArray(result.drafts)) {
              const byId = new Map<string, ImportDraft>(result.drafts.map((draft: ImportDraft) => [draft.id, draft]));
              working = working.map((draft) => byId.get(draft.id) || draft);
              setDrafts([...working]);
              break;
            }

            if (rr.status === 429) {
              const retrySeconds = Math.max(2, Number(result.retryAfterSeconds) || parseResetSeconds(result.resetTokens) || 8);
              if (retrySeconds > MAX_AUTO_GROQ_WAIT_SECONDS || duplicateRateLimitRetries >= MAX_SHORT_RATE_LIMIT_RETRIES) {
                const remainingIds = new Set(batches.slice(batchIndex).flat());
                working = working.map((draft) => remainingIds.has(draft.id) ? {
                  ...draft,
                  duplicateNeedsRerank: false,
                  duplicateCheckStatus: "local",
                  duplicateCheckNote: `Lokal vollständig geprüft. Semantische Groq-Prüfung für diesen Import übersprungen (Reset in ca. ${Math.ceil(retrySeconds)} s). Lokale Vergleichskandidaten bleiben sichtbar.`,
                } : draft);
                setDrafts([...working]);
                duplicateWarnings.push(`Groq-Limit mit ca. ${Math.ceil(retrySeconds)} s Wartezeit; restliche Ähnlichkeitsprüfungen bleiben lokal.`);
                setMessage(`Groq-Ähnlichkeitslimit erreicht · kein Warten auf ${Math.ceil(retrySeconds)} s · lokale Kandidaten werden verwendet …`);
                stopDuplicateGroq = true;
                break;
              }
              duplicateRateLimitRetries += 1;
              working = working.map((draft) => ids.has(draft.id) ? {
                ...draft,
                duplicateCheckStatus: "pending",
                duplicateCheckNote: `Lokal geprüft; Groq-Limit erreicht. Kurzer Retry in ${Math.ceil(retrySeconds)} s.`,
              } : draft);
              setDrafts([...working]);
              setMessage(`Ähnlichkeit: Groq-Limit erreicht · kurzer Retry in ${Math.ceil(retrySeconds)} s …`);
              await sleep((retrySeconds + 0.5) * 1000);
              working = working.map((draft) => ids.has(draft.id) ? {
                ...draft,
                duplicateCheckStatus: "checking",
                duplicateCheckNote: "Lokale Kandidaten vorhanden; semantische Ähnlichkeitsprüfung läuft …",
              } : draft);
              setDrafts([...working]);
              continue;
            }

            const reason = result.error || `Ähnlichkeitsprüfung fehlgeschlagen (HTTP ${rr.status}).`;
            working = working.map((draft) => ids.has(draft.id) ? {
              ...draft,
              duplicateCheckStatus: "failed",
              duplicateCheckNote: reason,
            } : draft);
            setDrafts([...working]);
            duplicateWarnings.push(`Paket ${batchIndex + 1}: ${reason}`);
            break;
          }
        }
        if (duplicateWarnings.length) setWarnings((prev) => [...prev, `Hinweise zur Ähnlichkeitsprüfung: ${duplicateWarnings.join(" | ")}`]);
      }

      const llmCount = working.filter((x) => x.analysisMode === "llm").length;
      const duplicateChecked = working.filter((x) => x.duplicateCheckStatus === "local" || x.duplicateCheckStatus === "partial" || x.duplicateCheckStatus === "groq").length;
      const duplicateFailed = working.filter((x) => x.duplicateCheckStatus === "failed").length;
      const heuristicCount = working.length - llmCount;
      setMessage(`${working.length} Aufgaben erkannt${data.llmRequested ? ` · ${llmCount} Metadaten per Groq verfeinert${heuristicCount ? ` · ${heuristicCount} heuristisch` : ""}` : ""} · Ähnlichkeit ${duplicateChecked}/${working.length} geprüft${duplicateFailed ? ` · ${duplicateFailed} fehlgeschlagen` : ""}. Bitte Vorschläge prüfen.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function formatFileSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
  }

  function parseResetSeconds(value?: string) {
    if (!value) return 0;
    const ms = value.match(/([0-9.]+)ms/i);
    if (ms) return Number(ms[1]) / 1000;
    const sec = value.match(/([0-9.]+)s/i);
    if (sec) return Number(sec[1]);
    return 0;
  }



  const rubricLabels: Array<[keyof SimilarityRubric, string]> = [
    ["sameLearningGoal", "Gleiches konkretes Lernziel"],
    ["sameStudentAction", "Gleiche Schülerhandlung"],
    ["sameMathematicalMethod", "Gleicher mathematischer Lösungsweg"],
    ["sameRepresentation", "Gleiche Darstellungsform"],
    ["comparableStructure", "Vergleichbare Aufgabenstruktur"],
    ["sameTemplate", "Nahezu gleiche Aufgabenvorlage"],
  ];

  function duplicateLabel(relation?: string) {
    if (relation === "near_duplicate") return "Sehr ähnliche Variante";
    if (relation === "same_skill") return "Gleicher Aufgabentyp";
    if (relation === "related") return "Inhaltlich verwandt";
    if (relation === "not_related") return "Nicht ähnlich";
    return "Mögliche Ähnlichkeit";
  }

  function bestLocalComparison(draft: ImportDraft) {
    const pool = draft.duplicatePool?.length ? draft.duplicatePool : (draft.duplicates || []);
    return [...pool].sort((a, b) => (b.retrievalScore ?? b.localScore ?? b.score ?? 0) - (a.retrievalScore ?? a.localScore ?? a.score ?? 0))[0];
  }

  function localComparisons(draft: ImportDraft) {
    const pool = draft.duplicatePool?.length ? draft.duplicatePool : (draft.duplicates || []);
    return [...pool]
      .filter((candidate) => (candidate.retrievalScore ?? candidate.localScore ?? candidate.score ?? 0) >= LOCAL_RELEVANCE_THRESHOLD)
      .sort((a, b) => (b.retrievalScore ?? b.localScore ?? b.score ?? 0) - (a.retrievalScore ?? a.localScore ?? a.score ?? 0))
      .slice(0, 5);
  }

  function relevantLocalComparison(draft: ImportDraft) {
    return localComparisons(draft)[0];
  }

  function localCandidateLevel(candidate: NonNullable<ImportDraft["duplicate"]>) {
    if (candidate.confidentVariant || candidate.relation === "near_duplicate" || candidate.relation === "same_skill") return "Starker lokaler Kandidat";
    const score = candidate.retrievalScore ?? candidate.localScore ?? candidate.score ?? 0;
    if (score >= 0.50) return "Guter lokaler Kandidat";
    if (score >= 0.34) return "Plausibler lokaler Kandidat";
    return "Weiterer lokaler Kandidat";
  }

  function duplicateStatusLabel(draft: ImportDraft) {
    if (draft.duplicateCheckStatus === "groq") return "Ähnlichkeit: KI ✓";
    if (draft.duplicateCheckStatus === "local") return "Lokal geprüft ✓";
    if (draft.duplicateCheckStatus === "partial") return "Lokal ✓ · KI teilweise";
    if (draft.duplicateCheckStatus === "checking") return "Lokal geprüft · KI prüft …";
    if (draft.duplicateCheckStatus === "failed") return "Lokal geprüft · KI-Fehler";
    return "Lokal geprüft · KI wartet";
  }

  function patchDraft(id: string, patch: Partial<ImportDraft>) {
    setDrafts((prev) => prev.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function changeClass(draft: ImportDraft, classLevel: string) {
    const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
    patchDraft(draft.id, {
      classLevel,
      topic: topics.includes(draft.topic) ? draft.topic : topics[0] || "",
      duplicate: undefined,
      duplicates: undefined,
      duplicatePool: undefined,
      duplicateNeedsRerank: false,
      duplicateCheckStatus: "pending",
      duplicateCheckNote: "Klasse wurde geändert; Ähnlichkeitsprüfung beim nächsten Dokumentlauf neu berechnen.",
    });
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
          <span className={`adminCapability ${status.llmConfigured ? "ok" : "neutral"}`}>{status.llmConfigured ? `KI (Groq): ${status.llmModel}` : "KI optional"}</span>
          <button className="secondary" onClick={() => void logout()}><LogOut size={16} />Abmelden</button>
        </div>
      </header>

      <section className="adminUploadCard panel">
        <div className="adminSectionTitle"><Upload size={19} /><div><h2>1. Dokumente hochladen</h2><p>Klassenarbeit, Arbeitsblatt und optional Erwartungshorizont gemeinsam auswählen.</p></div></div>
        <div className="adminUploadGrid">
          <div
            className={`adminFileDrop ${isDraggingFiles ? "dragging" : ""}`}
            onDragEnter={onFileDragEnter}
            onDragOver={onFileDragOver}
            onDragLeave={onFileDragLeave}
            onDrop={onFileDrop}
          >
            <label className="adminFileDropPicker">
              <input
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                multiple
                onChange={(e) => {
                  acceptDocuments(Array.from(e.target.files || []), true);
                  e.currentTarget.value = "";
                }}
              />
              <FileSearch size={28} />
              <strong>{isDraggingFiles ? "Dokumente hier ablegen" : files.length ? "Weitere PDF / DOCX hinzufügen" : "PDF / DOCX hierher ziehen"}</strong>
              <span>oder klicken, um Dateien auszuwählen · bis zu 10 Dateien · zusammen max. 4 MB</span>
            </label>
            {files.length > 0 && (
              <div className="adminSelectedFiles" aria-label="Ausgewählte Dokumente">
                {files.map((file, index) => (
                  <div className="adminSelectedFile" key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <span title={file.name}>{file.name}</span>
                    <small>{formatFileSize(file.size)}</small>
                    <button type="button" className="adminFileRemove" onClick={() => removeDocument(index)} aria-label={`${file.name} entfernen`} title="Datei entfernen"><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="adminContextFields">
            <label>Klasse als Vorgabe<select value={defaultClass} onChange={(e) => setDefaultClass(e.target.value)}><option value="">Automatisch erkennen</option>{LEGACY_CLASSES.filter((x) => Number(x) <= 10).map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Thema als Vorgabe<select value={defaultTopic} onChange={(e) => setDefaultTopic(e.target.value)}><option value="">Automatisch erkennen</option>{(LEGACY_TOPICS_BY_CLASS[defaultClass] || []).map((x) => <option key={x}>{x}</option>)}</select></label>
            <label className="adminLlmToggle"><input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={!status.llmConfigured} /><span><b>KI-Analyse verwenden</b><small>{status.llmConfigured ? "Empfohlen für Kompetenz, AFB, Zeit und vollständige Musterlösung im Erwartungshorizont. Dabei wird der extrahierte Aufgabentext an Groq gesendet." : "GROQ_API_KEY nicht gesetzt – heuristische Analyse bleibt verfügbar."}</small></span><Bot size={18} /></label>
            <label className="adminLlmToggle"><input type="checkbox" checked={useVisionOcr} onChange={(e) => setUseVisionOcr(e.target.checked)} disabled={!status.llmConfigured} /><span><b>Mathematik visuell korrigieren</b><small>{status.llmConfigured ? "Automatisch nur bei verdächtiger PDF-Mathematik: Die Textschicht bestimmt weiterhin die Aufgabe; Groq liest lediglich die mathematische Anordnung im Seitenbild nach (z. B. gestapelte Brüche)." : "Benötigt denselben GROQ_API_KEY."}</small></span><FileSearch size={18} /></label>
            <button className="primary adminAnalyzeButton" disabled={busy || !files.length} onClick={() => void analyze()}>{busy ? <Loader2 className="spin" size={17} /> : <FileSearch size={17} />}Aufgaben erkennen</button>
          </div>
        </div>
        {message && <div className="adminMessage">{message}</div>}
        {warnings.map((warning, i) => <div className="adminWarning" key={i}><AlertTriangle size={16} />{warning}</div>)}
        {sourceSummary.length > 0 && <div className="adminSourceSummary">{sourceSummary.map((x) => <span key={x.name}><b>{x.name}</b> · {x.characters.toLocaleString("de-DE")} Zeichen{x.blocks ? ` · ${x.blocks} Dokumentblöcke` : ""} · {x.images} Bilder{x.method ? ` · ${x.method}` : ""}</span>)}</div>}
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
                  <span className="adminDraftText"><strong>{draft.title}</strong><small>{draft.classLevel} · {draft.topic} · {draft.competence}</small><small>{draft.pointsRaw || "?"} P.{draft.pointsSource === "heuristic" ? " (geschätzt)" : ""} · {draft.estimatedTime || "?"} min · {draft.analysisMode === "llm" ? "KI" : "Heuristik"}{draft.segmentationConfidence ? ` · Struktur ${Math.round(draft.segmentationConfidence * 100)}%` : ""}{draft.mathRepair === "visual" ? " · Mathe visuell korrigiert" : draft.mathRepair === "checking" ? " · Mathe wird geprüft" : draft.mathRepair === "needed" ? " · Mathe-Reparatur wartet" : draft.mathRepair === "rejected" || draft.mathRepair === "failed" ? " · Mathe-Korrektur fehlgeschlagen" : ""}</small>{draft.duplicateCheckStatus !== "groq" && relevantLocalComparison(draft) && (() => { const candidate = relevantLocalComparison(draft)!; return <small title={`${candidate.title} · ${candidate.topic} · ${candidate.competence}`}>{localCandidateLevel(candidate)}: {candidate.title} · {candidate.topic} · {candidate.competence}</small>; })()}</span>
                  <span className="adminDraftBadges">
                    <em className={`duplicateStatus ${draft.duplicateCheckStatus || "pending"}`}>{duplicateStatusLabel(draft)}</em>
                    {draft.duplicate && <em className={draft.duplicate.relation === "near_duplicate" ? "danger" : "warn"}>{duplicateLabel(draft.duplicate.relation)}</em>}
                    {draft.include ? <Check size={16} /> : <X size={16} />}
                  </span>
                </button>
              ))}
            </aside>

            {selected && (
              <article className="adminEditor">
                <div className="adminEditorTop">
                  <div><span className="eyebrow">{selected.analysisMode === "llm" ? "KI-VORSCHLAG" : "HEURISTISCHER VORSCHLAG"}</span><h2>{selected.title || "Aufgabe"}</h2><p>Quelle: {selected.sourceFile}</p></div>
                  <label className={`adminIncludeToggle ${selected.include ? "on" : ""}`}><input type="checkbox" checked={selected.include} onChange={(e) => patchDraft(selected.id, { include: e.target.checked })} />{selected.include ? "Wird importiert" : "Verworfen"}</label>
                </div>

                {selected.mathRepair && selected.mathRepair !== "none" && (
                  <section className={`adminMathRepairStatus ${selected.mathRepair}`}>
                    <div>
                      {selected.mathRepair === "checking" ? <Loader2 className="spin" size={15} /> : selected.mathRepair === "visual" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                      <strong>{selected.mathRepair === "visual" ? "Mathematik visuell korrigiert" : selected.mathRepair === "checking" ? "Mathematik wird visuell geprüft" : selected.mathRepair === "needed" ? "Visuelle Mathekorrektur wartet" : "Visuelle Mathekorrektur nicht übernommen"}</strong>
                    </div>
                    <span>{selected.mathRepairNote || ""}</span>
                  </section>
                )}

                <section className={`adminDuplicateCheckStatus ${selected.duplicateCheckStatus || "pending"}`}>
                  <div>
                    {selected.duplicateCheckStatus === "checking" ? <Loader2 className="spin" size={15} /> : selected.duplicateCheckStatus === "failed" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                    <strong>{duplicateStatusLabel(selected)}</strong>
                  </div>
                  <span>{selected.duplicateCheckNote || "Lokaler Vergleich steht noch aus."}</span>
                </section>

                {(!selected.duplicate || selected.duplicateCheckStatus === "partial") && localComparisons(selected).length > 0 && (
                  <section className="adminDuplicate adminDuplicateLocal">
                    <div><FileSearch size={18} /><strong>{selected.duplicateCheckStatus === "partial" ? "Weitere lokale Vergleichskandidaten" : "Lokale Vergleichskandidaten"}</strong></div>
                    <p className="adminDuplicateReason">Diese Treffer sind lokale Vergleichskandidaten. Die frühere Prozentanzeige wurde entfernt, weil der technische Suchwert keine fachliche Ähnlichkeits-Prozentzahl darstellt. Auch schwächere Treffer bleiben weiterhin sichtbar.</p>
                    {localComparisons(selected).map((candidate, index) => (
                      <details key={candidate.id} open={index === 0}>
                        <summary>{localCandidateLevel(candidate)} · {candidate.title} · {candidate.topic} · {candidate.competence}</summary>
                        {candidate.retrievalSignals?.length ? <p className="adminDuplicateReason"><b>Lokale Signale:</b> {candidate.retrievalSignals.join(" · ")}</p> : null}
                        <div className="adminExistingQuestion"><LatexText text={candidate.questionText} /></div>
                      </details>
                    ))}
                  </section>
                )}

                {selected.duplicate && (
                  <section className={`adminDuplicate ${selected.duplicate.relation === "near_duplicate" ? "high" : ""}`}>
                    <div><AlertTriangle size={18} /><strong>{duplicateLabel(selected.duplicate.relation)}</strong></div>
                    <p><b>Bester Treffer:</b> {selected.duplicate.title} · {selected.duplicate.topic} · {selected.duplicate.competence}</p>{selected.duplicate.reason && <p className="adminDuplicateReason">{selected.duplicate.reason}</p>}
                    {selected.duplicate.rubric && <div className="adminSimilarityRubric">{rubricLabels.map(([key, label]) => <span key={key} className={selected.duplicate!.rubric![key] ? "yes" : "no"}>{selected.duplicate!.rubric![key] ? <Check size={13} /> : <X size={13} />}{label}</span>)}</div>}
                    <details><summary>Bestehende Aufgabe vergleichen</summary><div className="adminExistingQuestion"><LatexText text={selected.duplicate.questionText} /></div></details>
                    {(selected.duplicates?.length || 0) > 1 && (
                      <details className="adminDuplicateMore">
                        <summary>Weitere ähnliche Treffer ({Math.min((selected.duplicates?.length || 1) - 1, 4)})</summary>
                        {selected.duplicates?.slice(1, 5).map((candidate) => (
                          <details className="adminDuplicateCandidate" key={candidate.id}>
                            <summary>
                              <b>{duplicateLabel(candidate.relation)}</b>
                              <span>{candidate.title} · {candidate.topic} · {candidate.competence}</span>
                            </summary>
                            {candidate.reason ? <p className="adminDuplicateReason">{candidate.reason}</p> : null}
                            {candidate.rubric ? (
                              <div className="adminSimilarityRubric">
                                {rubricLabels.map(([key, label]) => (
                                  <span key={key} className={candidate.rubric![key] ? "yes" : "no"}>
                                    {candidate.rubric![key] ? <Check size={13} /> : <X size={13} />}
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            <div className="adminExistingQuestion"><LatexText text={candidate.questionText} /></div>
                          </details>
                        ))}
                      </details>
                    )}
                  </section>
                )}

                <div className="adminEditorGrid">
                  <label className="span2">Titel<input value={selected.title} onChange={(e) => patchDraft(selected.id, { title: e.target.value })} /></label>
                  <label>Klasse<select value={selected.classLevel} onChange={(e) => changeClass(selected, e.target.value)}>{LEGACY_CLASSES.filter((x) => Number(x) <= 10).map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>Thema<select value={selected.topic} onChange={(e) => patchDraft(selected.id, { topic: e.target.value })}>{(LEGACY_TOPICS_BY_CLASS[selected.classLevel] || []).map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>Kompetenz<select value={selected.competence} onChange={(e) => patchDraft(selected.id, { competence: e.target.value as Competence })}>{competences.map((x) => <option key={x}>{x}</option>)}</select></label>
                  <label>AFB<input value={selected.afbRaw} onChange={(e) => patchDraft(selected.id, { afbRaw: e.target.value })} placeholder="z. B. a: AFB 1, b: AFB 2" /></label>
                  <label>Punkte<input value={selected.pointsRaw} onChange={(e) => { const pointsRaw = e.target.value; patchDraft(selected.id, { pointsRaw, maxPoints: parsePointsSpec(pointsRaw).maxPoints }); }} placeholder="z. B. 1+1+2" /></label>
                  <label>Zeit (Min.)<input type="number" min="0" step="0.5" value={selected.estimatedTime || ""} onChange={(e) => patchDraft(selected.id, { estimatedTime: Number(e.target.value) || 0 })} /></label>
                  <div className="span2 adminLatexField">
                    <div className="adminLatexFieldHead">
                      <span>Aufgabentext</span>
                      <button type="button" className="secondary adminLatexToggle" onClick={() => setEditQuestionSource((value) => !value)}>
                        {editQuestionSource ? <Eye size={14} /> : <Code2 size={14} />}
                        {editQuestionSource ? "Formatierte Ansicht" : "Quelltext bearbeiten"}
                      </button>
                    </div>
                    {editQuestionSource ? (
                      <textarea rows={9} value={selected.questionText} onChange={(e) => patchDraft(selected.id, { questionText: e.target.value })} />
                    ) : (
                      <div className="adminLatexRendered adminLatexRenderedQuestion"><LatexText text={selected.questionText} /></div>
                    )}
                  </div>
                  <div className="span2 adminLatexField">
                    <div className="adminLatexFieldHead">
                      <span>Erwartungshorizont · vollständige Musterlösung</span>
                      <button type="button" className="secondary adminLatexToggle" onClick={() => setEditExpectationSource((value) => !value)}>
                        {editExpectationSource ? <Eye size={14} /> : <Code2 size={14} />}
                        {editExpectationSource ? "Formatierte Ansicht" : "Quelltext bearbeiten"}
                      </button>
                    </div>
                    {editExpectationSource ? (
                      <textarea rows={8} value={selected.expectation} onChange={(e) => patchDraft(selected.id, { expectation: e.target.value })} placeholder="Vollständige Musterlösung mit Rechenweg / Bewertungserwartung" />
                    ) : (
                      <div className="adminLatexRendered">{selected.expectation ? <LatexText text={selected.expectation} /> : <span className="adminLatexEmpty">Noch keine vollständige Musterlösung vorhanden.</span>}</div>
                    )}
                  </div>
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

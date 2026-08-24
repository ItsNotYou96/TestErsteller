import type { ImportDraft } from "./adminTypes";
import type { Competence } from "./types";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";
import { parsePointsSpec } from "./taskParsing";

const COMPETENCES: Competence[] = ["Argumentieren", "Problemlösen", "Modellieren", "Darstellungen", "Mathematik", "Kommunizieren"];

export function llmConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function llmModel() {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
}

export function solutionModel() {
  return process.env.GROQ_SOLUTION_MODEL?.trim() || "qwen/qwen3.6-27b";
}

const metadataSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    competence: { type: "string", enum: COMPETENCES },
    afbRaw: { type: "string" },
    pointsRaw: { type: "string" },
    estimatedTime: { type: "number" },
    confidenceTopic: { type: "number" },
    confidenceCompetence: { type: "number" },
    confidenceAfb: { type: "number" },
    confidenceTime: { type: "number" },
  },
  required: [
    "title", "topic", "competence", "afbRaw", "pointsRaw", "estimatedTime",
    "confidenceTopic", "confidenceCompetence", "confidenceAfb", "confidenceTime",
  ],
} as const;

function metadataPrompt(draft: ImportDraft, defaultClass?: string, defaultTopic?: string) {
  const classLevel = defaultClass && LEGACY_TOPICS_BY_CLASS[defaultClass] ? defaultClass : draft.classLevel;
  const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  const preferredTopic = defaultTopic && topics.includes(defaultTopic) ? defaultTopic : draft.topic;
  const question = draft.questionText.slice(0, 8000);
  const pointsKnown = draft.pointsSource === "document" && Boolean(draft.pointsRaw);

  return `Analysiere genau EINE bereits getrennte Mathematikaufgabe für einen schulischen Aufgabenpool. Erzeuge NUR Metadaten, KEINE Musterlösung.

Klasse: ${classLevel}
Zulässige Themen: ${topics.join(" | ")}
${preferredTopic ? `Bisheriger Themenvorschlag: ${preferredTopic}` : ""}
Zulässige Prozesskompetenzen: ${COMPETENCES.join(", ")}
Bisherige Punkte: ${draft.pointsRaw || "nicht im Dokument angegeben"}
Punkte im Originaldokument sicher erkannt: ${pointsKnown ? "JA" : "NEIN"}
Bisheriger AFB-Vorschlag: ${draft.afbRaw || "AFB 1"}

Regeln:
- title: kurz und sachlich, möglichst 2-6 Wörter.
- topic: ausschließlich eines der oben genannten Themen.
- competence: DOMINANTE Prozesskompetenz der gesamten Aufgabe.
- afbRaw: global "AFB 1" oder bei Teilaufgaben z. B. "a: AFB 1, b: AFB 2".
- pointsRaw: ${pointsKnown ? `EXAKT "${draft.pointsRaw}" zurückgeben; nicht verändern.` : "realistische Bepunktung. Bei Teilaufgaben als Summe wie 2+2+3; sonst eine einzelne Zahl. Nur Zahlen und + verwenden."}
- estimatedTime: realistische Bearbeitungszeit in Minuten.
- confidence-Werte jeweils zwischen 0 und 1.
- Keine Lösung, keinen Erwartungshorizont und keinen Aufgabentext zurückgeben.

Aufgabe:
${question}`;
}

export type GroqRateLimitInfo = {
  retryAfterSeconds?: number;
  remainingTokens?: number;
  resetTokens?: string;
};

export class GroqAnalysisError extends Error {
  status: number;
  rateLimit: GroqRateLimitInfo;
  constructor(message: string, status: number, rateLimit: GroqRateLimitInfo = {}) {
    super(message);
    this.name = "GroqAnalysisError";
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

function rateLimitInfo(response: Response): GroqRateLimitInfo {
  const retry = Number(response.headers.get("retry-after") || "");
  const remaining = Number(response.headers.get("x-ratelimit-remaining-tokens") || "");
  return {
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    remainingTokens: Number.isFinite(remaining) ? remaining : undefined,
    resetTokens: response.headers.get("x-ratelimit-reset-tokens") || undefined,
  };
}

function chatOutput(data: any) {
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

function reasoningFields(model: string) {
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", reasoning_format: "hidden" };
  if (model.startsWith("qwen/")) return { reasoning_effort: "none" };
  return {};
}

async function groqMetadataChat(prompt: string, strict: boolean) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqAnalysisError("GROQ_API_KEY ist nicht gesetzt.", 503);
  const model = llmModel();
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: `Du analysierst Mathematikaufgaben für einen schulischen Aufgabenpool. Halte dich exakt an das verlangte JSON-Format.\n\n${prompt}` }],
      ...reasoningFields(model),
      response_format: strict
        ? { type: "json_schema", json_schema: { name: "math_task_metadata", strict: true, schema: metadataSchema } }
        : { type: "json_object" },
      max_completion_tokens: 700,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Metadatenanalyse fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }
  const data = await response.json();
  const text = chatOutput(data);
  if (!text) throw new GroqAnalysisError("Groq-Metadatenanalyse hat keine JSON-Ausgabe geliefert.", 502, rateLimitInfo(response));
  return text;
}

function isOutputParseFailure(error: unknown) {
  return error instanceof GroqAnalysisError && error.status === 400 && /output_parse_failed|parsing failed|could not be parsed|json/i.test(error.message);
}

function subtaskLabels(text: string) {
  return Array.from((text || "").matchAll(/(?:^|[\s\n])\*?([a-z])\)\s*/gim)).map((match) => match[1].toLowerCase());
}

export function expectationLooksComplete(question: string, expectation: string) {
  const solution = String(expectation || "").trim();
  if (solution.length < 45) return false;
  const expected = subtaskLabels(question);
  if (expected.length < 2) return true;
  const actual = subtaskLabels(solution);
  const requiredCounts = new Map<string, number>();
  const actualCounts = new Map<string, number>();
  expected.forEach((label) => requiredCounts.set(label, (requiredCounts.get(label) || 0) + 1));
  actual.forEach((label) => actualCounts.set(label, (actualCounts.get(label) || 0) + 1));
  for (const [label, count] of requiredCounts) if ((actualCounts.get(label) || 0) < count) return false;
  return true;
}

function solutionPrompt(draft: ImportDraft, repair = false) {
  const labels = subtaskLabels(draft.questionText);
  return `${repair ? "Der vorherige Lösungsversuch war unvollständig. " : ""}Erstelle ausschließlich einen VOLLSTÄNDIGEN Erwartungshorizont mit Musterlösung für genau diese Mathematikaufgabe.

Regeln:
- Löse wirklich jede vorhandene Teilaufgabe vollständig und in derselben Reihenfolge.${labels.length ? ` Erwartete Teilaufgabenfolge: ${labels.map((x) => `${x})`).join(", ")}.` : ""}
- Übernimm Teilaufgabenbezeichnungen sichtbar. Doppelte Bezeichnungen im Original bleiben doppelt und werden als getrennte Positionen gelöst.
- Rechen-/Gleichungsaufgaben: nachvollziehbarer Rechenweg mit sinnvollen Umformungsschritten und eindeutigem Endergebnis.
- Termaufgaben: vollständige Umformung und vereinfachter Endterm.
- Sachaufgaben: Variable(n) definieren, Ansatz/Gleichung aufstellen, vollständig lösen und Antwortsatz angeben.
- Begründungs-/Argumentationsaufgaben: vollständige fachliche Begründung; bei offenen Aufgaben eine konkrete fachlich korrekte Musterlösung bzw. ein vollständiges Bewertungskriterium mit Beispiel.
- Keine bloßen Hinweise, keine Platzhalter wie „individuelle Lösung“, keine ausgelassenen Teilaufgaben.
- Mathematische Ausdrücke als LaTeX in \\(...\\) schreiben.
- Gib NUR die Musterlösung aus, kein JSON, keine Vorrede und den Aufgabentext nicht erneut.

Aufgabe:
${draft.questionText.slice(0, 10500)}`;
}

async function requestSolution(model: string, draft: ImportDraft, repair = false) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqAnalysisError("GROQ_API_KEY ist nicht gesetzt.", 503);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: solutionPrompt(draft, repair) }],
      ...reasoningFields(model),
      temperature: model.startsWith("qwen/") ? 0.1 : undefined,
      max_completion_tokens: 1900,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Musterlösung mit ${model} fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }
  const data = await response.json();
  const text = chatOutput(data);
  if (!text) throw new GroqAnalysisError(`Groq-Musterlösung mit ${model} war leer.`, 502, rateLimitInfo(response));
  return text;
}

export async function generateExpectationWithLlm(draft: ImportDraft): Promise<ImportDraft> {
  if (!process.env.GROQ_API_KEY?.trim()) return draft;
  if (expectationLooksComplete(draft.questionText, draft.expectation)) {
    return { ...draft, expectationStatus: "complete", expectationNote: "Vollständiger Erwartungshorizont bereits vorhanden." };
  }

  const configured = solutionModel();
  const models = Array.from(new Set([configured, "openai/gpt-oss-20b", "openai/gpt-oss-120b"]));
  const rateErrors: GroqAnalysisError[] = [];
  const otherErrors: string[] = [];

  for (const model of models) {
    try {
      let solution = await requestSolution(model, draft, false);
      if (!expectationLooksComplete(draft.questionText, solution)) {
        solution = await requestSolution(model, draft, true);
      }
      if (!expectationLooksComplete(draft.questionText, solution)) {
        otherErrors.push(`${model}: Ausgabe war trotz Reparatur unvollständig.`);
        continue;
      }
      return {
        ...draft,
        expectation: solution.trim(),
        expectationStatus: "complete",
        expectationNote: `Vollständige Musterlösung mit ${model} erzeugt.`,
        confidence: { ...(draft.confidence || { topic: 0, competence: 0, afb: 0, time: 0, expectation: 0 }), expectation: 0.95 },
      };
    } catch (error) {
      if (error instanceof GroqAnalysisError && error.status === 429) {
        rateErrors.push(error);
        continue; // Different Groq models have separate published model limits; try the next one.
      }
      otherErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (rateErrors.length === models.length) {
    const best = [...rateErrors].sort((a, b) => (a.rateLimit.retryAfterSeconds || Number.MAX_SAFE_INTEGER) - (b.rateLimit.retryAfterSeconds || Number.MAX_SAFE_INTEGER))[0];
    throw new GroqAnalysisError("Alle verfügbaren Groq-Modelle für Musterlösungen sind momentan limitiert.", 429, best?.rateLimit || {});
  }
  throw new GroqAnalysisError(`Keine vollständige Musterlösung erzeugt: ${otherErrors.join(" | ") || "unbekannter Fehler"}`, 502);
}

function safePoints(raw: unknown, fallback: string) {
  const value = String(raw || "").replace(/\s+/g, "").replace(/,/g, ".");
  if (/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(value)) return value;
  return fallback;
}

export async function analyzeDraftWithLlm(draft: ImportDraft, defaultClass?: string, defaultTopic?: string): Promise<ImportDraft> {
  if (!process.env.GROQ_API_KEY?.trim()) return draft;
  const prompt = metadataPrompt(draft, defaultClass, defaultTopic);
  let text = "";
  try {
    text = await groqMetadataChat(prompt, true);
  } catch (error) {
    if (!isOutputParseFailure(error)) throw error;
    text = await groqMetadataChat(`${prompt}\n\nAntworte als ein einziges gültiges JSON-Objekt mit exakt den geforderten Metadatenfeldern.`, false);
  }

  let task: any;
  try { task = JSON.parse(text); }
  catch { throw new GroqAnalysisError("Groq hat für die Metadaten kein gültiges JSON geliefert.", 502); }

  const classLevel = defaultClass && LEGACY_TOPICS_BY_CLASS[defaultClass] ? defaultClass : draft.classLevel;
  const allowedTopics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  const fallbackTopic = defaultTopic && allowedTopics.includes(defaultTopic) ? defaultTopic : draft.topic;
  const topic = allowedTopics.includes(String(task.topic)) ? String(task.topic) : (allowedTopics.includes(fallbackTopic) ? fallbackTopic : allowedTopics[0] || "");
  const preserveDocumentPoints = draft.pointsSource === "document" && Boolean(draft.pointsRaw);
  const pointsRaw = preserveDocumentPoints ? draft.pointsRaw : safePoints(task.pointsRaw, draft.pointsRaw || "2");
  const maxPoints = parsePointsSpec(pointsRaw).maxPoints || draft.maxPoints || 0;

  return {
    ...draft,
    title: String(task.title || draft.title).trim() || draft.title,
    classLevel,
    topic,
    competence: (COMPETENCES.includes(task.competence) ? task.competence : draft.competence) as Competence,
    afbRaw: String(task.afbRaw || draft.afbRaw || "AFB 1").trim(),
    pointsRaw,
    maxPoints,
    pointsSource: preserveDocumentPoints ? "document" : "llm",
    estimatedTime: Math.max(0, Number(task.estimatedTime) || draft.estimatedTime || 0),
    // Expectation is generated by its own queue/model and must never be erased by metadata analysis.
    expectation: draft.expectation,
    expectationStatus: draft.expectationStatus,
    expectationNote: draft.expectationNote,
    analysisMode: "llm",
    confidence: {
      topic: Math.max(0, Math.min(1, Number(task.confidenceTopic) || 0)),
      competence: Math.max(0, Math.min(1, Number(task.confidenceCompetence) || 0)),
      afb: Math.max(0, Math.min(1, Number(task.confidenceAfb) || 0)),
      time: Math.max(0, Math.min(1, Number(task.confidenceTime) || 0)),
      expectation: draft.confidence?.expectation || 0,
    },
  };
}

export async function analyzeWithLlm(_sources: unknown[], heuristics: ImportDraft[], defaultClass?: string, defaultTopic?: string) {
  const out: ImportDraft[] = [];
  for (const draft of heuristics) out.push(await analyzeDraftWithLlm(draft, defaultClass, defaultTopic));
  return out;
}

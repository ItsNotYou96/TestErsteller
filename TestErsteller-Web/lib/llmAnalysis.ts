import type { ImportDraft } from "./adminTypes";
import type { Competence } from "./types";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";

const COMPETENCES: Competence[] = ["Argumentieren", "Problemlösen", "Modellieren", "Darstellungen", "Mathematik", "Kommunizieren"];

export function llmConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function llmModel() {
  return process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
}

function outputText(data: any) {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") parts.push(content.text);
    }
  }
  return parts.join("\n");
}

const singleTaskSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    competence: { type: "string", enum: COMPETENCES },
    afbRaw: { type: "string" },
    estimatedTime: { type: "number" },
    expectation: { type: "string" },
    confidenceTopic: { type: "number" },
    confidenceCompetence: { type: "number" },
    confidenceAfb: { type: "number" },
    confidenceTime: { type: "number" },
    confidenceExpectation: { type: "number" },
  },
  required: [
    "title", "topic", "competence", "afbRaw", "estimatedTime", "expectation",
    "confidenceTopic", "confidenceCompetence", "confidenceAfb", "confidenceTime", "confidenceExpectation",
  ],
} as const;

function compactPrompt(draft: ImportDraft, defaultClass?: string, defaultTopic?: string) {
  const classLevel = defaultClass && LEGACY_TOPICS_BY_CLASS[defaultClass] ? defaultClass : draft.classLevel;
  const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  const preferredTopic = defaultTopic && topics.includes(defaultTopic) ? defaultTopic : draft.topic;
  const question = draft.questionText.slice(0, 12000);

  return `Ordne genau EINE Mathematikaufgabe für einen schulischen Aufgabenpool ein. Die Aufgabe wurde bereits zuverlässig aus dem Dokument getrennt. Gib deshalb NICHT den Aufgabentext und NICHT die Punkte erneut aus, sondern nur die Metadaten und einen knappen Erwartungshorizont.

Klasse: ${classLevel}
Zulässige Themen für diese Klasse: ${topics.join(" | ")}
${preferredTopic ? `Bisheriger Themenvorschlag: ${preferredTopic}` : ""}
Zulässige Prozesskompetenzen: ${COMPETENCES.join(", ")}
Bereits erkannte Punkte: ${draft.pointsRaw || "nicht sicher erkannt"}
Bisheriger AFB-Vorschlag: ${draft.afbRaw || "AFB 1"}

Regeln:
- title: kurz und sachlich, möglichst 2-6 Wörter.
- topic: ausschließlich eines der oben genannten Themen.
- competence: die DOMINANTE Prozesskompetenz der gesamten Aufgabe.
- afbRaw: global "AFB 1" oder bei Teilaufgaben z. B. "a: AFB 1, b: AFB 2". AFB 1 = Reproduzieren, AFB 2 = Zusammenhänge herstellen, AFB 3 = Verallgemeinern/Reflektieren.
- estimatedTime: realistische Bearbeitungszeit in Minuten.
- expectation: knapper, fachlich korrekter Erwartungshorizont. Bei Rechenaufgaben Ergebnisse und wesentliche Rechenschritte; bei offenen Aufgaben Bewertungskriterien. Maximal ca. 120 Wörter.
- confidence-Werte jeweils 0 bis 1.

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

export async function analyzeDraftWithLlm(draft: ImportDraft, defaultClass?: string, defaultTopic?: string): Promise<ImportDraft> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return draft;

  const response = await fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: llmModel(),
      input: compactPrompt(draft, defaultClass, defaultTopic),
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "math_task_metadata", strict: true, schema: singleTaskSchema } },
      // The Free Tier has 8K TPM. The old importer reserved 14K output tokens in one request,
      // which alone could make Groq reject the request with HTTP 413. A single task needs far less.
      max_output_tokens: 700,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Analyse fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }

  const data = await response.json();
  const text = outputText(data);
  if (!text) throw new GroqAnalysisError("Groq-Analyse hat keine strukturierte Ausgabe geliefert.", 502, rateLimitInfo(response));
  const task = JSON.parse(text) as any;

  const classLevel = defaultClass && LEGACY_TOPICS_BY_CLASS[defaultClass] ? defaultClass : draft.classLevel;
  const allowedTopics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  const fallbackTopic = defaultTopic && allowedTopics.includes(defaultTopic) ? defaultTopic : draft.topic;
  const topic = allowedTopics.includes(String(task.topic)) ? String(task.topic) : (allowedTopics.includes(fallbackTopic) ? fallbackTopic : allowedTopics[0] || "");

  return {
    ...draft,
    title: String(task.title || draft.title).trim() || draft.title,
    classLevel,
    topic,
    competence: (COMPETENCES.includes(task.competence) ? task.competence : draft.competence) as Competence,
    afbRaw: String(task.afbRaw || draft.afbRaw || "AFB 1").trim(),
    estimatedTime: Math.max(0, Number(task.estimatedTime) || draft.estimatedTime || 0),
    expectation: String(task.expectation || draft.expectation || "").trim(),
    analysisMode: "llm",
    confidence: {
      topic: Math.max(0, Math.min(1, Number(task.confidenceTopic) || 0)),
      competence: Math.max(0, Math.min(1, Number(task.confidenceCompetence) || 0)),
      afb: Math.max(0, Math.min(1, Number(task.confidenceAfb) || 0)),
      time: Math.max(0, Math.min(1, Number(task.confidenceTime) || 0)),
      expectation: Math.max(0, Math.min(1, Number(task.confidenceExpectation) || 0)),
    },
  };
}

// Kept for backwards compatibility with older code paths. New imports analyze one task per request.
export async function analyzeWithLlm(_sources: unknown[], heuristics: ImportDraft[], defaultClass?: string, defaultTopic?: string) {
  const out: ImportDraft[] = [];
  for (const draft of heuristics) out.push(await analyzeDraftWithLlm(draft, defaultClass, defaultTopic));
  return out;
}

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

const singleTaskSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    topic: { type: "string" },
    competence: { type: "string", enum: COMPETENCES },
    afbRaw: { type: "string" },
    pointsRaw: { type: "string" },
    estimatedTime: { type: "number" },
    expectation: { type: "string" },
    confidenceTopic: { type: "number" },
    confidenceCompetence: { type: "number" },
    confidenceAfb: { type: "number" },
    confidenceTime: { type: "number" },
    confidenceExpectation: { type: "number" },
  },
  required: [
    "title", "topic", "competence", "afbRaw", "pointsRaw", "estimatedTime", "expectation",
    "confidenceTopic", "confidenceCompetence", "confidenceAfb", "confidenceTime", "confidenceExpectation",
  ],
} as const;

function compactPrompt(draft: ImportDraft, defaultClass?: string, defaultTopic?: string) {
  const classLevel = defaultClass && LEGACY_TOPICS_BY_CLASS[defaultClass] ? defaultClass : draft.classLevel;
  const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  const preferredTopic = defaultTopic && topics.includes(defaultTopic) ? defaultTopic : draft.topic;
  const question = draft.questionText.slice(0, 10500);
  const pointsKnown = draft.pointsSource === "document" && Boolean(draft.pointsRaw);

  return `Analysiere genau EINE bereits getrennte Mathematikaufgabe für einen schulischen Aufgabenpool. Antworte ausschließlich mit den geforderten strukturierten Metadaten.

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
- pointsRaw: ${pointsKnown ? `EXAKT "${draft.pointsRaw}" zurückgeben; diese Punkte stammen aus dem Dokument und dürfen nicht verändert werden.` : "realistische Bepunktung vorschlagen. Bei Teilaufgaben als Summe wie 2+2+3; sonst eine einzelne Zahl. Nur Zahlen und + verwenden."}
- estimatedTime: realistische Bearbeitungszeit in Minuten.
- expectation: VOLLSTÄNDIGE, direkt nutzbare Musterlösung / Erwartungshorizont. Jede Teilaufgabe aus dem Aufgabentext muss einzeln vollständig gelöst werden; keine Teilaufgabe auslassen und keine Platzhalter wie „individuelle Lösung“ verwenden, sofern die Aufgabe eindeutig lösbar ist.
  * Rechen- und Gleichungsaufgaben: vollständigen Rechenweg mit sinnvollen Umformungsschritten UND eindeutigem Endergebnis angeben.
  * Termaufgaben: geforderte Umformung vollständig durchführen und den vereinfachten Endterm angeben.
  * Sachaufgaben: Variable(n) definieren, passenden mathematischen Ansatz / Gleichung aufstellen, lösen und einen Antwortsatz angeben.
  * Begründungs-/Argumentationsaufgaben: vollständige fachliche Begründung formulieren.
  * Bei mehreren Teilaufgaben die vorhandenen Buchstaben/Bezeichnungen in derselben Reihenfolge verwenden. Wenn eine Bezeichnung im Original doppelt vorkommt, beide Positionen trotzdem getrennt lösen.
  * Mathematische Ausdrücke möglichst in LaTeX mit \\(...\\) notieren.
  * Der Erwartungshorizont darf ausführlich sein; Vollständigkeit und fachliche Korrektheit sind wichtiger als Kürze.
- confidence-Werte: jeweils zwischen 0 und 1.
- Gib keinen Aufgabentext erneut aus.

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
  if (typeof content === "string") return content.trim();
  return "";
}

async function groqChat(prompt: string, strict: boolean) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqAnalysisError("GROQ_API_KEY ist nicht gesetzt.", 503);

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: llmModel(),
      messages: [
        { role: "user", content: `Du analysierst und löst Mathematikaufgaben für einen schulischen Aufgabenpool. Halte dich exakt an das verlangte JSON-Format, löse ausschließlich die übergebene Aufgabe und erfinde keine Informationen aus einem anderen Aufgabentext.\n\n${prompt}` },
      ],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: strict
        ? { type: "json_schema", json_schema: { name: "math_task_metadata", strict: true, schema: singleTaskSchema } }
        : { type: "json_object" },
      max_completion_tokens: 2200,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Analyse fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }
  const data = await response.json();
  const text = chatOutput(data);
  if (!text) throw new GroqAnalysisError("Groq-Analyse hat keine JSON-Ausgabe geliefert.", 502, rateLimitInfo(response));
  return { text, rateLimit: rateLimitInfo(response) };
}

function isOutputParseFailure(error: unknown) {
  return error instanceof GroqAnalysisError && error.status === 400 && /output_parse_failed|parsing failed|could not be parsed|json/i.test(error.message);
}

const expectationOnlySchema = {
  type: "object",
  additionalProperties: false,
  properties: { expectation: { type: "string" } },
  required: ["expectation"],
} as const;

function subtaskLabels(text: string) {
  return Array.from((text || "").matchAll(/(?:^|[\s\n])\*?([a-z])\)\s*/gim)).map((match) => match[1].toLowerCase());
}

function expectationLooksComplete(question: string, expectation: string) {
  const solution = String(expectation || "").trim();
  if (solution.length < 35) return false;
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

async function completeExpectationOnly(draft: ImportDraft) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqAnalysisError("GROQ_API_KEY ist nicht gesetzt.", 503);
  const prompt = `Erstelle ausschließlich die VOLLSTÄNDIGE Musterlösung für die folgende Mathematikaufgabe.

Regeln:
- Löse wirklich jede vorhandene Teilaufgabe vollständig und in derselben Reihenfolge.
- Übernimm die Teilaufgabenbezeichnungen a), b), c) usw. sichtbar in die Lösung. Wenn eine Bezeichnung im Original doppelt vorkommt, müssen auch beide Positionen getrennt gelöst und entsprechend gekennzeichnet werden.
- Rechen-/Gleichungsaufgaben: nachvollziehbarer Rechenweg und eindeutiges Endergebnis.
- Termaufgaben: vollständige Umformung und Endterm.
- Sachaufgaben: Variable(n), Ansatz/Gleichung, Rechenweg, Ergebnis und Antwortsatz.
- Begründungsaufgaben: vollständige fachliche Begründung.
- Keine bloßen Hinweise, keine Platzhalter, keine ausgelassenen Teilaufgaben.
- Mathematische Ausdrücke möglichst als LaTeX mit \\(...\\).
- Erfinde keine zusätzliche Aufgabe und löse ausschließlich den gegebenen Aufgabentext.

Aufgabe:
${draft.questionText.slice(0, 10500)}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: llmModel(),
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: { type: "json_schema", json_schema: { name: "complete_expectation", strict: true, schema: expectationOnlySchema } },
      max_completion_tokens: 2400,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Musterlösung fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }
  const data = await response.json();
  const raw = chatOutput(data);
  if (!raw) throw new GroqAnalysisError("Groq-Musterlösung hat keine JSON-Ausgabe geliefert.", 502, rateLimitInfo(response));
  try { return String(JSON.parse(raw)?.expectation || "").trim(); }
  catch { throw new GroqAnalysisError("Groq-Musterlösung hat ungültiges JSON geliefert.", 502, rateLimitInfo(response)); }
}

function safePoints(raw: unknown, fallback: string) {
  const value = String(raw || "").replace(/\s+/g, "").replace(/,/g, ".");
  if (/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(value)) return value;
  return fallback;
}

export async function analyzeDraftWithLlm(draft: ImportDraft, defaultClass?: string, defaultTopic?: string): Promise<ImportDraft> {
  if (!process.env.GROQ_API_KEY?.trim()) return draft;
  const prompt = compactPrompt(draft, defaultClass, defaultTopic);

  let text = "";
  try {
    text = (await groqChat(prompt, true)).text;
  } catch (error) {
    if (!isOutputParseFailure(error)) throw error;
    // Rare Groq parser failures have occurred with the Responses endpoint. Retry once with
    // JSON Object Mode; the application still validates every field below.
    const fallbackPrompt = `${prompt}\n\nAntworte jetzt als EIN gültiges JSON-Objekt mit exakt diesen Schlüsseln: title, topic, competence, afbRaw, pointsRaw, estimatedTime, expectation, confidenceTopic, confidenceCompetence, confidenceAfb, confidenceTime, confidenceExpectation.`;
    text = (await groqChat(fallbackPrompt, false)).text;
  }

  let task: any;
  try { task = JSON.parse(text); }
  catch { throw new GroqAnalysisError("Groq hat trotz Wiederholungsversuch kein gültiges JSON geliefert.", 502); }

  // The metadata response normally already contains the full solution. If a multi-part task
  // is missing one or more original subtask labels, regenerate ONLY the expectation horizon.
  // This avoids accepting a short grading hint as a "complete solution" while keeping the
  // second, more expensive call exceptional rather than the default.
  if (!expectationLooksComplete(draft.questionText, String(task.expectation || ""))) {
    const completedExpectation = await completeExpectationOnly(draft);
    if (completedExpectation) {
      task.expectation = completedExpectation;
      task.confidenceExpectation = Math.max(0.9, Number(task.confidenceExpectation) || 0);
    }
  }

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

export async function analyzeWithLlm(_sources: unknown[], heuristics: ImportDraft[], defaultClass?: string, defaultTopic?: string) {
  const out: ImportDraft[] = [];
  for (const draft of heuristics) out.push(await analyzeDraftWithLlm(draft, defaultClass, defaultTopic));
  return out;
}

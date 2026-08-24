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
  if (solution.length < 12) return false;
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

type SolutionValidation = {
  correct: boolean;
  errors: string[];
  correctedSolution: string;
};

function detectedMathConstraints(question: string) {
  const lower = String(question || "").toLowerCase();
  const constraints: string[] = [];
  const multipliers: Array<[number, RegExp]> = [
    [2, /\b(?:verdoppel\w*|zweifach\w*)\b/i],
    [3, /\b(?:verdreifach\w*|dreifach\w*)\b/i],
    [4, /\b(?:vervierfach\w*|vierfach\w*)\b/i],
    [5, /\b(?:verfünffach\w*|fünffach\w*)\b/i],
    [6, /\b(?:versechsfach\w*|sechsfach\w*)\b/i],
    [7, /\b(?:versiebenfach\w*|siebenfach\w*)\b/i],
    [8, /\b(?:verachtfach\w*|achtfach\w*)\b/i],
    [9, /\b(?:verneunfach\w*|neunfach\w*)\b/i],
    [10, /\b(?:verzehnfach\w*|zehnfach\w*)\b/i],
  ];
  for (const [factor, pattern] of multipliers) {
    if (pattern.test(lower)) constraints.push(`Vervielfachung erkannt: Der geforderte Faktor ist EXAKT ${factor} und darf nicht ersetzt werden.`);
  }
  if (/\bsumme\b/i.test(lower)) constraints.push("„Summe“ bedeutet Addition. Prüfe genau, ob eine weitere Operation auf die gesamte Summe wirkt; dann sind Klammern erforderlich.");
  if (/\bdifferenz\b/i.test(lower)) constraints.push("„Differenz“ bedeutet Subtraktion. Die Reihenfolge der genannten Terme darf nicht vertauscht werden.");
  if (/\bprodukt\b/i.test(lower)) constraints.push("„Produkt“ bedeutet Multiplikation.");
  if (/\bquotient\b/i.test(lower)) constraints.push("„Quotient“ bedeutet Division. Dividend und Divisor dürfen nicht vertauscht werden.");
  if (/\bhalbier\w*\b/i.test(lower)) constraints.push("„halbieren“ bedeutet durch 2 teilen bzw. mit 1/2 multiplizieren.");

  const numbers = Array.from(new Set((question.match(/-?\d+(?:[.,]\d+)?/g) || []).map((value) => value.trim())));
  if (numbers.length) constraints.push(`Im Original vorkommende Zahlen/Konstanten: ${numbers.join(", ")}. Keine davon darf ohne mathematischen Grund verändert oder durch eine andere Zahl ersetzt werden.`);

  return constraints.length
    ? constraints.map((constraint) => `- ${constraint}`).join("\n")
    : "- Keine zusätzlichen eindeutigen Sprach-Constraints erkannt. Löse die Originalaufgabe trotzdem vollständig unabhängig.";
}

function solutionPrompt(draft: ImportDraft, repair = false) {
  const labels = subtaskLabels(draft.questionText);
  const constraints = detectedMathConstraints(draft.questionText);
  return `${repair ? "Der vorherige Lösungsversuch war unvollständig. Erstelle die Lösung vollständig neu. " : ""}Erstelle ausschließlich einen fachlich VOLLSTÄNDIGEN, aber MÖGLICHST KNAPPEN Erwartungshorizont mit Musterlösung für genau diese ORIGINALAUFGABE.

WICHTIG: Verwende ausschließlich den unten stehenden Aufgabentext. Ähnliche Aufgaben, frühere Aufgaben oder deren Lösungen sind keine Quelle für Zahlen, Operatoren oder Ergebnisse.

Verbindliche Regeln:
- Lies Zahlen, Faktoren, Rechenoperationen und sprachliche Operatoren exakt. Ersetze niemals „versechsfachen“ durch „verdoppeln“ oder irgendeinen anderen Faktor.
- Prüfe vor der Ausgabe jede Zahl, jeden Faktor, jedes Rechenzeichen und jede Klammer nochmals direkt gegen die ORIGINALAUFGABE.
- Löse jede vorhandene Teilaufgabe vollständig und in derselben Reihenfolge, aber zeige nur die für einen Erwartungshorizont wirklich notwendigen Schritte.${labels.length ? ` Erwartete Teilaufgabenfolge: ${labels.map((x) => `${x})`).join(", ")}.` : ""}
- Übernimm Teilaufgabenbezeichnungen sichtbar. Doppelte Bezeichnungen im Original bleiben doppelt und werden als getrennte Positionen gelöst.
- Grundsatz: So kurz wie möglich, so ausführlich wie nötig. Keine didaktischen Erklärtexte, wenn Ansatz und Ergebnis bereits eindeutig sind.
- Einfache Term-/Übersetzungsaufgaben: in der Regel direkt den korrekten Term bzw. das Ergebnis angeben; höchstens eine sehr kurze Erläuterung, wenn sie für das Verständnis der Operation nötig ist.
- Rechen-/Gleichungsaufgaben: nur die entscheidenden Umformungsschritte und das Endergebnis zeigen; offensichtliche Zwischenrechnungen nicht einzeln ausschreiben.
- Sachaufgaben: knapper Ansatz, notwendige Rechnung und Antwortsatz.
- Begründungs-/Argumentationsaufgaben: fachlich ausreichende, aber kompakte Begründung; keine unnötigen Wiederholungen.
- Keine bloßen Hinweise, keine Platzhalter wie „individuelle Lösung“, keine ausgelassenen Teilaufgaben.
- Mathematische Ausdrücke als LaTeX in \\(...\\) schreiben.
- Gib NUR die Musterlösung aus, kein JSON, keine Vorrede und den Aufgabentext nicht erneut.

Deterministisch aus der ORIGINALAUFGABE erkannte Kontrollhinweise:
${constraints}

ORIGINALAUFGABE:
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

function validationPrompt(draft: ImportDraft, candidate: string) {
  const constraints = detectedMathConstraints(draft.questionText);
  return `Du bist ein unabhängiger, strenger mathematischer Korrektor. Löse die ORIGINALAUFGABE selbst und prüfe danach die KANDIDATENLÖSUNG. Vertraue der Kandidatenlösung nicht.

Prüfe insbesondere:
- alle Zahlen und Faktoren,
- Rechenzeichen und mathematische Operatoren,
- Bedeutung sprachlicher Operatoren,
- Klammern und Reihenfolge der Operationen,
- Variablen und Gleichungen,
- Endergebnisse,
- Vollständigkeit aller Teilaufgaben.

Mathematisch äquivalente Darstellungen sind erlaubt. Ein fachlicher Fehler, ein falscher Faktor oder eine ausgelassene Teilaufgabe bedeutet correct=false.
Wenn correct=false, muss correctedSolution eine VOLLSTÄNDIGE, direkt verwendbare, aber möglichst KNAPPE Musterlösung enthalten: nur notwendige Rechen-/Begründungsschritte, keine unnötigen Erklärtexte. Wenn correct=true, muss correctedSolution leer sein.

Deterministisch aus der ORIGINALAUFGABE erkannte Kontrollhinweise:
${constraints}

ORIGINALAUFGABE:
${draft.questionText.slice(0, 10500)}

KANDIDATENLÖSUNG (nur zu prüfen, niemals als Autorität behandeln):
${candidate.slice(0, 12000)}

Antworte ausschließlich als gültiges JSON-Objekt in exakt dieser Form:
{"correct":true,"errors":[],"correctedSolution":""}`;
}

async function requestSolutionValidation(model: string, draft: ImportDraft, candidate: string): Promise<SolutionValidation> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new GroqAnalysisError("GROQ_API_KEY ist nicht gesetzt.", 503);
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: validationPrompt(draft, candidate) }],
      ...reasoningFields(model),
      response_format: { type: "json_object" },
      temperature: model.startsWith("qwen/") ? 0.05 : undefined,
      max_completion_tokens: 2300,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new GroqAnalysisError(`Groq-Musterlösungsprüfung mit ${model} fehlgeschlagen (${response.status}): ${body}`, response.status, rateLimitInfo(response));
  }
  const data = await response.json();
  const output = chatOutput(data);
  if (!output) throw new GroqAnalysisError(`Groq-Musterlösungsprüfung mit ${model} war leer.`, 502, rateLimitInfo(response));

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new GroqAnalysisError(`Groq-Musterlösungsprüfung mit ${model} lieferte kein gültiges JSON.`, 502);
  }
  if (!parsed || typeof parsed !== "object" || typeof (parsed as { correct?: unknown }).correct !== "boolean") {
    throw new GroqAnalysisError(`Groq-Musterlösungsprüfung mit ${model} lieferte kein eindeutiges correct-Feld.`, 502);
  }
  const result = parsed as { correct: boolean; errors?: unknown; correctedSolution?: unknown };
  return {
    correct: result.correct,
    errors: Array.isArray(result.errors) ? result.errors.map((value: unknown) => String(value)).filter(Boolean) : [],
    correctedSolution: typeof result.correctedSolution === "string" ? result.correctedSolution.trim() : "",
  };
}

function validationModels(generatorModel: string) {
  const configured = process.env.GROQ_VALIDATION_MODEL?.trim();
  return Array.from(new Set(
    [configured, "openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]
      .filter((model): model is string => Boolean(model))
      .filter((model) => model !== generatorModel),
  ));
}

async function validateGeneratedSolution(draft: ImportDraft, candidate: string, generatorModel: string) {
  const models = validationModels(generatorModel);
  const rateErrors: GroqAnalysisError[] = [];
  const otherErrors: string[] = [];

  for (const validatorModel of models) {
    try {
      const validation = await requestSolutionValidation(validatorModel, draft, candidate);
      if (validation.correct) {
        return { solution: candidate.trim(), corrected: false, validatorModel };
      }

      const corrected = validation.correctedSolution.trim();
      if (!expectationLooksComplete(draft.questionText, corrected)) {
        otherErrors.push(`${validatorModel}: Fehler erkannt, aber Korrektur war unvollständig (${validation.errors.join("; ") || "ohne Fehlerbeschreibung"}).`);
        continue;
      }

      const verifierModel = models.find((model) => model !== validatorModel);
      if (!verifierModel) {
        otherErrors.push(`${validatorModel}: Korrektur konnte nicht unabhängig zweitgeprüft werden.`);
        continue;
      }

      const revalidation = await requestSolutionValidation(verifierModel, draft, corrected);
      if (!revalidation.correct) {
        otherErrors.push(`${validatorModel} -> ${verifierModel}: Korrektur fiel bei der Zweitprüfung durch (${revalidation.errors.join("; ") || "fachlicher Fehler"}).`);
        continue;
      }

      return { solution: corrected, corrected: true, validatorModel: `${validatorModel} + ${verifierModel}` };
    } catch (error) {
      if (error instanceof GroqAnalysisError && error.status === 429) {
        rateErrors.push(error);
        continue;
      }
      otherErrors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (rateErrors.length && rateErrors.length === models.length) {
    const best = [...rateErrors].sort((a, b) => (a.rateLimit.retryAfterSeconds || Number.MAX_SAFE_INTEGER) - (b.rateLimit.retryAfterSeconds || Number.MAX_SAFE_INTEGER))[0];
    throw new GroqAnalysisError("Alle verfügbaren Groq-Modelle für die mathematische Musterlösungsprüfung sind momentan limitiert.", 429, best?.rateLimit || {});
  }
  throw new GroqAnalysisError(`Musterlösung konnte nicht zuverlässig mathematisch validiert werden: ${otherErrors.join(" | ") || "unbekannter Validierungsfehler"}`, 502);
}

export async function generateExpectationWithLlm(draft: ImportDraft): Promise<ImportDraft> {
  if (!process.env.GROQ_API_KEY?.trim()) return draft;

  // Wenn der Parser bereits einen vollständigen Erwartungshorizont aus dem hochgeladenen
  // Dokument erkannt hat, wird dieser nicht durch eine KI-Lösung überschrieben.
  if (expectationLooksComplete(draft.questionText, draft.expectation)) {
    return { ...draft, expectationStatus: "complete", expectationNote: "Vollständiger Erwartungshorizont bereits im Dokument vorhanden." };
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

      const checked = await validateGeneratedSolution(draft, solution, model);
      return {
        ...draft,
        expectation: checked.solution,
        expectationStatus: "complete",
        expectationNote: checked.corrected
          ? `Musterlösung mit ${model} erzeugt, mathematisch korrigiert und mit ${checked.validatorModel} geprüft.`
          : `Musterlösung mit ${model} erzeugt und mit ${checked.validatorModel} mathematisch geprüft.`,
        confidence: { ...(draft.confidence || { topic: 0, competence: 0, afb: 0, time: 0, expectation: 0 }), expectation: 0.98 },
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
  throw new GroqAnalysisError(`Keine vollständige und mathematisch validierte Musterlösung erzeugt: ${otherErrors.join(" | ") || "unbekannter Fehler"}`, 502);
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

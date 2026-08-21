import { randomUUID } from "node:crypto";
import type { ImportDraft } from "./adminTypes";
import type { ParsedSource } from "./importParsing";
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

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceFile: { type: "string" },
          title: { type: "string" },
          questionText: { type: "string" },
          classLevel: { type: "string", enum: ["7", "8", "9", "10"] },
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
          "sourceFile", "title", "questionText", "classLevel", "topic", "competence", "afbRaw", "pointsRaw",
          "estimatedTime", "expectation", "confidenceTopic", "confidenceCompetence", "confidenceAfb", "confidenceTime", "confidenceExpectation",
        ],
      },
    },
  },
  required: ["tasks"],
} as const;

function prompt(sources: ParsedSource[], heuristics: ImportDraft[], defaultClass?: string, defaultTopic?: string) {
  const topicMap = Object.entries(LEGACY_TOPICS_BY_CLASS)
    .filter(([cls]) => ["7", "8", "9", "10"].includes(cls))
    .map(([cls, topics]) => `Klasse ${cls}: ${topics.join(" | ")}`)
    .join("\n");
  const sourceText = sources.map((source) => `\n===== DATEI: ${source.name} =====\n${(source.text || source.simplified).slice(0, 60000)}`).join("\n");
  const heuristicText = heuristics.length
    ? `\nVorläufig bereits erkannte Aufgaben (nur als Orientierung, korrigiere Fehler):\n${JSON.stringify(heuristics.map((x) => ({ sourceFile: x.sourceFile, title: x.title, questionText: x.questionText, pointsRaw: x.pointsRaw }))).slice(0, 40000)}`
    : "";

  return `Du analysierst Mathematik-Arbeitsblätter/Klassenarbeiten für einen Aufgabenpool. Extrahiere jede eigenständige Aufgabe. Teilaufgaben a), b), c) bleiben gemeinsam in EINER Aufgabe, sofern sie unter derselben Aufgabennummer stehen.

Zulässige Themen sind ausschließlich:
${topicMap}

Zulässige Prozesskompetenzen sind ausschließlich: ${COMPETENCES.join(", ")}.

Regeln:
- Nutze einen kurzen sachlichen Titel. Wenn ein Titel im Dokument vorhanden ist, übernimm ihn.
- questionText enthält den vollständigen Aufgabentext inklusive Teilaufgaben und LaTeX-artiger Schreibweise, aber keine Überschrift "Aufgabe N".
- pointsRaw soll die originale Punktezerlegung enthalten, z. B. "1+1+2" oder "7+3". Erfinde keine Punkte, wenn sie nicht sicher bestimmbar sind; dann leer lassen.
- afbRaw darf global "AFB 1" sein oder pro Teilaufgabe z. B. "a: AFB 1, b: AFB 2". AFB 1 = Reproduzieren, AFB 2 = Zusammenhänge herstellen, AFB 3 = Verallgemeinern/Reflektieren.
- estimatedTime ist eine realistische Bearbeitungszeit in Minuten.
- expectation: Wenn eine Lösungs-/Erwartungshorizont-Datei beigefügt ist, übernimm und ordne sie der richtigen Aufgabe zu. Wenn keine Lösung vorhanden ist, erstelle einen knappen fachlich korrekten Erwartungshorizont. Kennzeichne NICHT im Text, dass er KI-generiert ist; die Oberfläche kennzeichnet das separat.
- classLevel und topic müssen zueinander passen. ${defaultClass ? `Bevorzugter Jahrgang aus der Adminauswahl: ${defaultClass}.` : ""} ${defaultTopic ? `Bevorzugtes Thema aus der Adminauswahl: ${defaultTopic}.` : ""}
- confidence-Werte liegen zwischen 0 und 1.
- Ignoriere Kopfzeilen, Notenspiegel, Hinweise, Namensfelder und reine Bewertungstabellen.
${heuristicText}

Dokumenttext:
${sourceText}`;
}

export async function analyzeWithLlm(sources: ParsedSource[], heuristics: ImportDraft[], defaultClass?: string, defaultTopic?: string): Promise<ImportDraft[]> {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) return heuristics;

  // GPT-OSS 120B on Groq is text-in/text-out. PDF/DOCX text is therefore
  // extracted server-side first and only that extracted text is sent to Groq.
  const content: any[] = [{ type: "input_text", text: prompt(sources, heuristics, defaultClass, defaultTopic) }];

  const response = await fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: llmModel(),
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "math_task_import", strict: true, schema } },
      max_output_tokens: 14000,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Groq-Analyse fehlgeschlagen (${response.status}): ${await response.text()}`);
  const data = await response.json();
  const text = outputText(data);
  if (!text) throw new Error("Groq-Analyse hat keine strukturierte Ausgabe geliefert.");
  const parsed = JSON.parse(text) as { tasks: any[] };

  return (parsed.tasks || []).map((task, index) => {
    const matching = heuristics.find((h) => h.sourceFile === task.sourceFile && h.title.toLowerCase() === String(task.title || "").toLowerCase())
      || heuristics[index];
    const classLevel = LEGACY_TOPICS_BY_CLASS[String(task.classLevel)] ? String(task.classLevel) : (defaultClass || "7");
    const allowedTopics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
    const topic = allowedTopics.includes(task.topic) ? task.topic : (defaultTopic && allowedTopics.includes(defaultTopic) ? defaultTopic : allowedTopics[0] || "");
    const pointsRaw = String(task.pointsRaw || matching?.pointsRaw || "").trim();
    return {
      id: matching?.id || randomUUID(),
      sourceFile: String(task.sourceFile || matching?.sourceFile || sources[0]?.name || "Dokument"),
      title: String(task.title || matching?.title || `Aufgabe ${index + 1}`).trim(),
      questionText: String(task.questionText || matching?.questionText || "").trim(),
      classLevel,
      topic,
      competence: (COMPETENCES.includes(task.competence) ? task.competence : matching?.competence || "Mathematik") as Competence,
      afbRaw: String(task.afbRaw || matching?.afbRaw || "AFB 1").trim(),
      pointsRaw,
      maxPoints: parsePointsSpec(pointsRaw).maxPoints || matching?.maxPoints || 0,
      estimatedTime: Math.max(0, Number(task.estimatedTime) || matching?.estimatedTime || 0),
      expectation: String(task.expectation || matching?.expectation || "").trim(),
      imageDataUrl: matching?.imageDataUrl,
      imageName: matching?.imageName,
      include: matching?.include ?? true,
      analysisMode: "llm" as const,
      confidence: {
        topic: Math.max(0, Math.min(1, Number(task.confidenceTopic) || 0)),
        competence: Math.max(0, Math.min(1, Number(task.confidenceCompetence) || 0)),
        afb: Math.max(0, Math.min(1, Number(task.confidenceAfb) || 0)),
        time: Math.max(0, Math.min(1, Number(task.confidenceTime) || 0)),
        expectation: Math.max(0, Math.min(1, Number(task.confidenceExpectation) || 0)),
      },
    } satisfies ImportDraft;
  }).filter((x) => x.questionText || x.title);
}

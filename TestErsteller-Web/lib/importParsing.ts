import { randomUUID } from "node:crypto";
import type { Competence } from "./types";
import type { ImportDraft } from "./adminTypes";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";
import { parsePointsSpec } from "./taskParsing";
import { parseDocumentFile, type DocumentBlock, type DocumentSource } from "./documentBlocks";
import { segmentDocument, type TaskBlockGroup } from "./taskSegmentation";

export type ParsedSource = DocumentSource;
export { parseDocumentFile as parseUploadedFile };

function normalizeCircled(value: string) {
  const chars = "①②③④⑤⑥⑦⑧⑨⑩";
  return value.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => `${chars.indexOf(c) + 1}.`);
}

function stripTaskPrefix(value: string) {
  return normalizeCircled(value)
    .replace(/^\s*Aufgabe\s*\d{1,2}\s*[:.)\-–]?\s*/i, "")
    .replace(/^\s*\d{1,2}\s*[:.)\-–]\s*/, "")
    .replace(/^\s*\d{1,2}\s+(?=\()/i, "")
    .replace(/^\s*\(\s*(?:je\s*)?\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:BE|P(?:\.|unkte?)?)\s*\)\s*/i, "")
    .trim();
}

function partLabels(text: string) {
  return Array.from(text.matchAll(/(?:^|\s|\n)\*?([a-z])\)\s*/gi)).map((m) => m[1].toLowerCase());
}

function pointsFromTask(text: string, heading: string) {
  const source = text.replace(/\r/g, "");
  const max = source.match(/\(\s*max\.?\s*(\d+(?:[.,]\d+)?)\s*(?:BE|P(?:\.|unkte?)?)?\s*\)/i)?.[1];

  // Exact subtask point labels, independent of spaces/line breaks: a)(1BE), *c) (2 P.), etc.
  const sub = Array.from(source.matchAll(/\*?[a-z]\)\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(?:BE|P(?:\.|unkte?)?)\s*\)?/gi))
    .map((m) => m[1].replace(",", "."));
  if (sub.length >= 2) return `${sub.join("+")}${max ? ` (max. ${max.replace(",", ".")})` : ""}`;

  const each = source.match(/\(\s*je\s*(\d+(?:[.,]\d+)?)\s*(?:BE|P(?:\.|unkte?)?)\s*\)/i)?.[1];
  if (each) {
    const labels = Array.from(new Set(partLabels(text))).sort();
    const maxLabel = labels.reduce((max, label) => Math.max(max, label.charCodeAt(0) - 96), 0);
    const count = maxLabel >= 2 && maxLabel <= 12 ? maxLabel : labels.length;
    if (count > 1) return Array.from({ length: count }, () => each.replace(",", ".")).join("+");
  }

  // A second points block belongs to the same numbered task only when it begins a fresh line.
  // This handles layouts such as task 4 with two unlettered 6-P blocks without accidentally
  // adding trailing document-wide form points like "Mathematische Korrektheit ... (3 BE)".
  const headingPoint = heading.match(/\(\s*(\d+(?:[.,]\d+)?)\s*(?:BE|P(?:\.|unkte?)?)\s*\)/i)?.[1]?.replace(",", ".");
  const standaloneMarkers = Array.from(source.matchAll(/(?:^|\n)\s*\(\s*(?!max\b)(?!je\b)(\d+(?:[.,]\d+)?)\s*(?:BE|P(?:\.|unkte?)?)\s*\)/gi)).map((m) => m[1].replace(",", "."));
  if (headingPoint && standaloneMarkers.length) return [headingPoint, ...standaloneMarkers].join("+");
  if (!headingPoint && standaloneMarkers.length >= 2) return standaloneMarkers.join("+");
  if (headingPoint) return headingPoint;
  if (standaloneMarkers[0]) return standaloneMarkers[0];
  if (max) return max.replace(",", ".");
  if (sub.length === 1) return sub[0];
  return "";
}

function heuristicPointsRaw(text: string) {
  const labels = Array.from(new Set(partLabels(text)));
  if (labels.length) {
    return labels.map((label, index) => {
      const marker = new RegExp(`(?:^|\\n|\\s)\\*?${label}\\)\\s*`, "i");
      const start = text.search(marker);
      const nextLabel = labels[index + 1];
      const rest = start >= 0 ? text.slice(start) : text;
      const end = nextLabel ? rest.search(new RegExp(`(?:^|\\n|\\s)\\*?${nextLabel}\\)\\s*`, "i")) : -1;
      const chunk = (end > 0 ? rest.slice(0, end) : rest).toLowerCase();
      if (/begr(?:ü|u)nd|beweis|beurteil|bewert|erkl(?:ä|a)r|erl(?:ä|a)uter|analys|interpret|modellier/.test(chunk)) return 3;
      if (/zeichn|skizz|konstrui/.test(chunk) || chunk.length > 180) return 2;
      if (/[=+\-*/:^]/.test(chunk) && /\d/.test(chunk)) return 1;
      return 2;
    }).join("+");
  }
  const lower = text.toLowerCase();
  if (/begr(?:ü|u)nd|beweis|beurteil|bewert|analys|interpret|modellier/.test(lower)) return "4";
  if (/zeichn|skizz|konstrui/.test(lower) || text.length > 350) return "3";
  return "2";
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  "Terme": ["term", "variable", "klammer", "ausmultipl", "zusammenfass"],
  "Rationale Zahlen": ["rational", "negative zahl", "zahlengerade", "bruch", "dezimal", "vorzeichen", "betrag"],
  "Gleichungen": ["gleichung", "äquivalenz", "variable", "lösen"],
  "Prozentrechnung": ["prozent", "grundwert", "prozentwert", "prozentsatz", "rabatt"],
  "Zuordnung": ["zuordnung", "proportional", "dreisatz", "tabelle"],
  "Terme & Gleichungen": ["term", "gleichung", "variable", "klammer", "äquivalenz"],
  "Prozent- und Zinsrechnung": ["prozent", "zins", "kapital", "rabatt", "wachstumsfaktor"],
  "Flächen": ["fläche", "flächeninhalt", "umfang", "dreieck", "viereck", "kreis"],
  "Körper": ["volumen", "oberfläche", "prisma", "zylinder", "körper"],
  "Statistik": ["median", "mittelwert", "boxplot", "histogramm", "daten", "diagramm", "säulendiagramm"],
  "Funktionen": ["funktion", "graph", "steigung", "y-achse", "koordinatensystem"],
  "Gleichungssysteme": ["gleichungssystem", "lgs", "einsetz", "additionsverfahren", "zwei gleichungen"],
  "Lineare Funktionen": ["linear", "steigung", "y-achsenabschnitt", "funktionsgleichung", "gerade"],
  "Potenzen": ["potenz", "exponent", "wurzel", "zehnerpotenz", "potenzgesetz"],
  "Dreiecke": ["dreieck", "pythagoras", "thales", "winkel", "kongruenz"],
  "Körper - Fortgeschritten": ["pyramide", "kegel", "kugel", "volumen", "oberfläche"],
  "Quadratische Funktionen": ["quadratisch", "parabel", "scheitel", "nullstelle", "binom"],
  "Exponentialfunktionen": ["exponential", "wachstum", "zerfall", "wachstumsfaktor", "halbwert"],
  "Trigonometrie": ["sinus", "kosinus", "tangens", "trigonom", "winkel"],
  "Wahrscheinlichkeitsrechnung": ["wahrscheinlichkeit", "baumdiagramm", "urne", "ereignis", "vierfelder", "zufall", "boxplot"],
};

function guessClass(text: string, fallback?: string) {
  if (fallback && LEGACY_TOPICS_BY_CLASS[fallback]) return fallback;
  const match = text.match(/(?:klasse|jahrgang(?:sstufe)?|kl\.)\s*[:.]?\s*(7|8|9|10)\b/i);
  return match?.[1] || "7";
}

function guessTopic(text: string, classLevel: string, fallback?: string) {
  const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  if (fallback && topics.includes(fallback)) return fallback;
  const lower = text.toLowerCase();
  const ranked = topics.map((topic) => ({ topic, score: (TOPIC_KEYWORDS[topic] || []).reduce((s, word) => s + (lower.includes(word) ? 1 : 0), 0) })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score ? ranked[0].topic : topics[0] || "";
}

function guessCompetence(text: string): Competence {
  const lower = text.toLowerCase();
  if (/begründe|beweise|widerlege|beurteile|bewerte|argument|analysiere.+aussage/.test(lower)) return "Argumentieren";
  if (/problem|strategie|systematisch probier|finde (?:alle|einen weg)|untersuche verschiedene lösungswege/.test(lower)) return "Problemlösen";
  if (/sachverhalt|alltag|real(?:e|en)? situation|modell|interpretiere.+kontext|architekt|fahrstuhl|geschwindigkeit|kosten|taschengeld|alter/.test(lower)) return "Modellieren";
  if (/zeichne|skizziere|stelle dar|diagramm|graph|koordinatensystem|zahlengerade|tabelle|darstellung|boxplot/.test(lower)) return "Darstellungen";
  if (/erkläre|beschreibe|erläutere|formuliere|präsentiere|kommuniz/.test(lower)) return "Kommunizieren";
  return "Mathematik";
}

function guessAfb(text: string) {
  const lower = text.toLowerCase();
  if (/bewerte|beurteile|begründe|beweise|verallgemein|reflektiere|entwickle/.test(lower)) return "AFB 3";
  if (/analysiere|erläutere|interpretiere|untersuche|vergleiche|übertrage|stelle zusammenhänge/.test(lower)) return "AFB 2";
  return "AFB 1";
}

function estimatedTime(points: number, text: string) {
  const partCount = new Set(partLabels(text)).size;
  return Math.max(2, Math.round((points > 0 ? points * 1.8 : 4) + Math.max(0, partCount - 1)));
}

function titleFromGroup(group: TaskBlockGroup) {
  const first = group.blocks.find((b) => b.kind === "paragraph" || b.kind === "table");
  if (!first) return "Aufgabe";
  let title = stripTaskPrefix(first.text)
    .replace(/\(\s*(?:max\.?\s*)?(?:je\s*)?\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:BE|P(?:\.|unkte?)?)?\s*\)\s*/gi, "")
    .trim();
  const firstSentence = title.split(/(?<=[.!?])\s+/)[0] || title;
  if (firstSentence.length <= 72) return firstSentence.replace(/[.:]+$/, "").trim() || "Aufgabe";
  return `${firstSentence.slice(0, 69).trim()}…`;
}


function rawTextFromGroup(group: TaskBlockGroup) {
  return group.blocks
    .filter((block) => block.kind !== "page-break" && block.kind !== "image")
    .map((block) => `${block.listLabel && (block.listLevel || 0) > 0 ? `${block.listLabel} ` : ""}${block.text}`)
    .join("\n")
    .trim();
}

function questionFromGroup(group: TaskBlockGroup) {
  const lines: string[] = [];
  for (let i = 0; i < group.blocks.length; i++) {
    const block = group.blocks[i];
    if (block.kind === "page-break" || block.kind === "image") continue;
    let text = block.text.trim();
    if (!text) continue;
    if (i === 0 || block.id === group.startBlockId) text = stripTaskPrefix(text);
    else if (block.listLabel && (block.listLevel || 0) > 0) text = `${block.listLabel} ${text}`;
    // Point labels are metadata, not part of the mathematical wording.
    text = text
      .replace(/(\*?[a-z]\))\s*\(\s*\d+(?:[.,]\d+)?\s*(?:BE|P(?:\.|unkte?)?)\s*\)/gi, "$1 ")
      .replace(/\(\s*max\.?\s*\d+(?:[.,]\d+)?\s*(?:BE|P(?:\.|unkte?)?)?\s*\)/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (text) lines.push(text);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function pagesFromGroup(group: TaskBlockGroup) {
  return Array.from(new Set(group.blocks.map((b) => b.page).filter((p): p is number => Number.isInteger(p))));
}

function imageFromGroup(source: DocumentSource, group: TaskBlockGroup) {
  const imageBlock = group.blocks.find((b) => b.kind === "image" && Number.isInteger(b.imageIndex));
  if (imageBlock?.imageIndex !== undefined) return source.images[imageBlock.imageIndex];
  return undefined;
}

export async function draftsFromSources(sources: ParsedSource[], defaultClass?: string, defaultTopic?: string, useLlmStructure = true) {
  const drafts: ImportDraft[] = [];
  const warnings: string[] = [];
  for (const source of sources) {
    const segmented = await segmentDocument(source, useLlmStructure);
    warnings.push(...segmented.warnings.map((warning) => `${source.name}: ${warning}`));
    for (const group of segmented.groups) {
      const rawTaskText = rawTextFromGroup(group);
      const questionText = questionFromGroup(group);
      if (!questionText) continue;
      const title = group.titleHint?.trim() || titleFromGroup(group);
      const firstBlock = group.blocks.find((b) => b.kind !== "page-break" && b.kind !== "image");
      const heading = firstBlock?.text || title;
      const documentPointsRaw = pointsFromTask(rawTaskText, heading);
      const pointsRaw = documentPointsRaw || heuristicPointsRaw(questionText);
      const maxPoints = parsePointsSpec(pointsRaw).maxPoints || 0;
      const classLevel = guessClass(`${source.name}\n${source.text}`, defaultClass);
      const topic = guessTopic(`${title}\n${questionText}`, classLevel, defaultTopic);
      const image = imageFromGroup(source, group);
      drafts.push({
        id: randomUUID(),
        sourceFile: source.name,
        title,
        questionText,
        classLevel,
        topic,
        competence: guessCompetence(questionText),
        afbRaw: guessAfb(questionText),
        pointsRaw,
        maxPoints,
        pointsSource: documentPointsRaw ? "document" : "heuristic",
        estimatedTime: estimatedTime(maxPoints, questionText),
        expectation: "",
        imageDataUrl: image?.dataUrl && image.dataUrl.length <= 350_000 ? image.dataUrl : undefined,
        imageName: image?.name,
        include: true,
        analysisMode: "heuristic",
        sourcePages: pagesFromGroup(group),
        sourceBlockIds: group.blocks.filter((b) => b.kind !== "page-break").map((b) => b.id),
        segmentationMode: group.mode,
        segmentationConfidence: group.confidence,
        mathRepair: "none",
        confidence: { topic: 0.45, competence: 0.4, afb: 0.35, time: 0.45, expectation: 0 },
      });
    }
  }

  const expectationRows = sources.flatMap((source) => source.expectationRows);
  const norm = (value: string) => value.toLowerCase().replace(/[^a-zäöüß0-9]+/gi, " ").trim();
  for (const draft of drafts) {
    const key = norm(draft.title);
    const row = expectationRows.find((candidate) => {
      const other = norm(candidate.title);
      return other === key || (key.length > 3 && (other.includes(key) || key.includes(other)));
    });
    if (!row) continue;
    draft.expectation = row.expectation;
    if (row.pointsRaw && draft.pointsSource !== "document") {
      draft.pointsRaw = row.pointsRaw.replace(/\s+/g, "");
      draft.maxPoints = parsePointsSpec(draft.pointsRaw).maxPoints || draft.maxPoints;
      draft.pointsSource = "document";
    }
    draft.confidence = { ...(draft.confidence || { topic: .45, competence: .4, afb: .35, time: .45, expectation: 0 }), expectation: row.expectation ? .95 : 0 };
  }
  return { drafts, warnings };
}

// Backwards-compatible helper for code/tests that still call the old name. It intentionally uses
// deterministic segmentation only; the admin import route uses draftsFromSources so Groq can be used
// for ambiguous document structures.
export function heuristicDrafts(sources: ParsedSource[], defaultClass?: string, defaultTopic?: string): ImportDraft[] {
  throw new Error("heuristicDrafts wurde in Importer v3 durch draftsFromSources ersetzt.");
}

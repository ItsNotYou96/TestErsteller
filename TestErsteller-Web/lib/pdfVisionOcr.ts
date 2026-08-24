import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { likelyBrokenPdfMath } from "./pdfMathSignals";

export function visionOcrConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function visionOcrModel() {
  return process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.6-27b";
}

export class MathRepairRateLimitError extends Error {
  retryAfterSeconds: number;
  resetTokens?: string;
  constructor(message: string, retryAfterSeconds: number, resetTokens?: string) {
    super(message);
    this.name = "MathRepairRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.resetTokens = resetTokens;
  }
}

function retrySeconds(response: Response) {
  const retry = Number(response.headers.get("retry-after") || "");
  if (Number.isFinite(retry) && retry > 0) return retry;
  const reset = response.headers.get("x-ratelimit-reset-tokens") || "";
  const sec = reset.match(/([0-9.]+)s/i); if (sec) return Math.max(1, Number(sec[1]));
  const ms = reset.match(/([0-9.]+)ms/i); if (ms) return Math.max(1, Number(ms[1]) / 1000);
  return 8;
}

const PROSE_STOP = new Set(["aufgabe", "aufgaben", "punkt", "punkte", "berechne", "bestimme", "gib", "zeichne", "ordne", "löse", "loese", "folgende", "folgenden", "wenn", "dabei", "eine", "einer", "einen", "einem", "eines", "und", "oder", "mit", "die", "der", "das", "den", "dem", "des", "von", "zur", "zum", "ist", "sind"]);

function proseTokens(value: string) {
  return value.toLowerCase().replace(/\\(?:frac|sqrt|cdot|times|div|leq|geq|neq|mathbb|left|right)\b/g, " ")
    .replace(/\\[a-z]+/g, " ").replace(/[0-9]+(?:[.,][0-9]+)?/g, " ").replace(/[=+*/:^_<>−–—-]/g, " ")
    .replace(/[^a-zäöüß]+/gi, " ").split(/\s+/).filter((x) => x.length >= 3 && !PROSE_STOP.has(x));
}

function tokenJaccard(a: string[], b: string[]) {
  const aa = new Set(a), bb = new Set(b);
  if (!aa.size && !bb.size) return 1;
  if (!aa.size || !bb.size) return 0;
  let common = 0; for (const x of aa) if (bb.has(x)) common++;
  return common / (aa.size + bb.size - common);
}

function subtaskLabels(value: string) {
  return Array.from(value.matchAll(/(?:^|\n|\s)(\*?[a-z]\))\s*/gim)).map((m) => m[1].toLowerCase());
}

function numberMultiset(value: string) {
  return Array.from(value.normalize("NFKC").matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => m[0].replace(",", ".")).sort();
}

function numbersBySubtask(value: string) {
  const chunks = splitSubtasks(value);
  if (!chunks.parts.length) return [numberMultiset(value).join("|")];
  const groups: string[] = [];
  if (chunks.prefix.trim()) groups.push(`prefix:${numberMultiset(chunks.prefix).join("|")}`);
  chunks.parts.forEach((part, index) => groups.push(`${index}:${numberMultiset(part.content).join("|")}`));
  return groups;
}

export function validateTaskMathCorrection(original: string, corrected: string) {
  const before = original.trim(), after = corrected.trim();
  if (!before || !after) return { ok: false, reason: "leerer Text" };
  if (subtaskLabels(before).join("|") !== subtaskLabels(after).join("|")) return { ok: false, reason: "Teilaufgaben wurden verändert" };
  if (numbersBySubtask(before).join("||") !== numbersBySubtask(after).join("||")) return { ok: false, reason: "Zahleninhalt einer Teilaufgabe wurde verändert" };
  const prose = tokenJaccard(proseTokens(before), proseTokens(after));
  if (prose < 0.82) return { ok: false, reason: `normaler Aufgabentext wurde zu stark verändert (${Math.round(prose * 100)} % Übereinstimmung)` };
  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.62 || ratio > 1.75) return { ok: false, reason: "Textlänge wurde unplausibel verändert" };
  return { ok: true, reason: "" };
}

export { likelyBrokenPdfMath };

type SubtaskPart = { label: string; content: string };

function splitSubtasks(text: string): { prefix: string; parts: SubtaskPart[] } {
  const source = text.replace(/\r/g, "");
  const matches = Array.from(source.matchAll(/(?:^|\n|\s)(\*?[a-z]\))\s*/gim));
  if (matches.length < 2) return { prefix: source, parts: [] };
  const firstIndex = matches[0].index ?? 0;
  const prefix = source.slice(0, firstIndex).trimEnd();
  const parts: SubtaskPart[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const rawStart = match.index ?? 0;
    const labelOffset = match[0].lastIndexOf(match[1]);
    const contentStart = rawStart + labelOffset + match[1].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    parts.push({ label: match[1], content: source.slice(contentStart, end).trim() });
  }
  return { prefix, parts };
}

function validatePartCorrection(original: string, corrected: string) {
  const before = original.trim(), after = corrected.trim();
  if (!after) return { ok: false, reason: "leere Teilaufgabe" };
  if (numberMultiset(before).join("|") !== numberMultiset(after).join("|")) return { ok: false, reason: "Zahlen wurden verändert" };
  const beforeProse = proseTokens(before);
  const afterProse = proseTokens(after);
  if (beforeProse.length) {
    const prose = tokenJaccard(beforeProse, afterProse);
    if (prose < 0.72) return { ok: false, reason: `Wortlaut weicht ab (${Math.round(prose * 100)} %)` };
  }
  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.35 || ratio > 3.4) return { ok: false, reason: "unplausible Länge" };
  return { ok: true, reason: "" };
}

async function taskImages(bytes: Buffer, pages: number[]) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const unique = Array.from(new Set(pages.filter((p) => p > 0))).slice(0, 2);
    const images: string[] = [];
    for (const page of unique) {
      const shot = await parser.getScreenshot({ partial: [page], desiredWidth: 1900, imageDataUrl: true, imageBuffer: false });
      const dataUrl = String(shot.pages?.[0]?.dataUrl || "");
      if (dataUrl) images.push(dataUrl);
    }
    return images;
  } finally { await parser.destroy(); }
}

async function pageTextEvidence(bytes: Buffer, pages: number[]) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const unique = Array.from(new Set(pages.filter((p) => p > 0))).slice(0, 2);
    const result = await parser.getText({ partial: unique, pageJoiner: "\n", itemJoiner: " " });
    return String(result.text || "").slice(0, 9000);
  } finally { await parser.destroy(); }
}

async function visionJsonRequest(images: string[], prompt: string) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die visuelle Mathekorrektur.");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: visionOcrModel(),
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }],
      reasoning_effort: "none",
      reasoning_format: "hidden",
      temperature: 0,
      response_format: { type: "json_object" },
      max_completion_tokens: 2200,
    }),
    cache: "no-store",
  });
  if (response.status === 429) {
    throw new MathRepairRateLimitError(
      "Groq-Limit bei der visuellen Mathekorrektur erreicht.",
      retrySeconds(response),
      response.headers.get("x-ratelimit-reset-tokens") || undefined,
    );
  }
  const body = await response.text();
  if (!response.ok) throw new Error(`Groq Vision/Mathekorrektur fehlgeschlagen (${response.status}): ${body}`);
  let data: any;
  try { data = JSON.parse(body); } catch { throw new Error("Groq Vision hat keine gültige API-Antwort geliefert."); }
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Groq Vision hat keine Ausgabe geliefert.");
  try { return JSON.parse(raw); } catch { throw new Error("Groq Vision hat kein gültiges JSON geliefert."); }
}

async function repairBySubtaskOrdinal(bytes: Buffer, taskText: string, pages: number[], rawPdfEvidence: string) {
  const split = splitSubtasks(taskText);
  if (split.parts.length < 2) return undefined;
  const images = await taskImages(bytes, pages);
  if (!images.length) throw new Error("Die zugehörige PDF-Seite konnte nicht gerendert werden.");
  const anchor = split.prefix.replace(/\s+/g, " ").trim().slice(0, 220) || taskText.replace(/\s+/g, " ").trim().slice(0, 220);
  const partInventory = split.parts.map((part, index) => `${index + 1}. Original-Label ${part.label} | extrahiert: ${part.content.replace(/\s+/g, " ").slice(0, 650)}`).join("\n");
  const prompt = `Du liest ausschließlich die MATHEMATISCHE NOTATION einer bereits abgegrenzten Aufgabe aus einem Seitenbild eines deutschen Mathematikdokuments.

ZIELAUFGABE beginnt mit:
<<<${anchor}>>>

Die Aufgabe enthält EXAKT ${split.parts.length} Teilaufgaben in visueller Lesereihenfolge. Die Buchstaben/Labels werden vom Programm selbst beibehalten. Du darfst die Labels NICHT ausgeben oder korrigieren. Das ist wichtig, weil ein Originaldokument absichtlich oder versehentlich auch doppelte Labels wie e), e) enthalten kann.

Gib ausschließlich dieses JSON zurück:
{"parts":[{"ordinal":1,"content":"..."},{"ordinal":2,"content":"..."}]}

HARTE REGELN:
- parts muss EXAKT ${split.parts.length} Elemente enthalten, ordinal 1 bis ${split.parts.length}.
- content enthält nur den Inhalt HINTER dem jeweiligen Teilaufgaben-Label, niemals das Label selbst.
- Lies die räumliche Mathematik aus dem BILD. Die extrahierte PDF-Textreihenfolge ist bei Brüchen unzuverlässig.
- Gestapelte Brüche als \\frac{Zähler}{Nenner}; gemischte Zahlen z. B. -5\\frac{1}{2}; Potenzen x^{2}; Wurzeln \\sqrt{x}; Multiplikation \\cdot.
- Formeln/Gleichungen vollständig in \\( ... \\) setzen.
- Zahlen, Variablen, Operatoren und deutscher Wortlaut dürfen NICHT ergänzt, entfernt, gelöst oder inhaltlich geändert werden.
- Wenn eine Teilaufgabe bereits linear korrekt ist, schreibe sie nur sauber als LaTeX ab.
- Andere Aufgaben auf der Seite ignorieren.

EXTRAHIERTE TEILAUFGABEN (nur zur Zuordnung; Layout immer aus dem Bild lesen):
${partInventory}

ROHE PDF-TEXTSPUR (nur als Hinweis):
<<<${rawPdfEvidence.slice(0, 7000)}>>>`;

  const parsed = await visionJsonRequest(images, prompt);
  const parts = Array.isArray(parsed?.parts) ? parsed.parts : [];
  if (parts.length !== split.parts.length) throw new Error(`Visuelle Korrektur verworfen: ${parts.length} statt ${split.parts.length} Teilaufgaben zurückgegeben.`);

  const correctedParts: string[] = [];
  for (let i = 0; i < split.parts.length; i++) {
    const item = parts[i];
    if (Number(item?.ordinal) !== i + 1) throw new Error(`Visuelle Korrektur verworfen: Reihenfolge der Teilaufgaben ist bei Position ${i + 1} ungültig.`);
    const content = String(item?.content || "").trim();
    const validation = validatePartCorrection(split.parts[i].content, content);
    if (!validation.ok) throw new Error(`Visuelle Korrektur verworfen: Teilaufgabe ${i + 1} (${split.parts[i].label}) – ${validation.reason}.`);
    correctedParts.push(content);
  }

  const corrected = [split.prefix.trim(), ...split.parts.map((part, i) => `${part.label} ${correctedParts[i]}`)].filter(Boolean).join("\n").trim();
  const wholeValidation = validateTaskMathCorrection(taskText, corrected);
  if (!wholeValidation.ok) throw new Error(`Visuelle Korrektur verworfen: ${wholeValidation.reason}.`);
  return corrected;
}

async function repairWholeTask(bytes: Buffer, taskText: string, pages: number[], rawPdfEvidence: string) {
  const images = await taskImages(bytes, pages);
  if (!images.length) throw new Error("Die zugehörige PDF-Seite konnte nicht gerendert werden.");
  const anchor = taskText.replace(/\s+/g, " ").trim().slice(0, 220);
  const prompt = `Du reparierst ausschließlich die MATHEMATISCHE SCHREIBWEISE einer bereits erkannten Aufgabe in einem deutschen Mathematikdokument. Das Seitenbild ist für die räumliche Anordnung der Mathematik maßgeblich.

ZIELAUFGABE beginnt mit:
<<<${anchor}>>>

HARTE REGELN:
- Nur diese Zielaufgabe bearbeiten; andere Aufgaben auf der Seite ignorieren.
- Wortlaut, Zahlen, Teilaufgaben und Reihenfolge unverändert lassen. Keine Lösung und keine Ergänzung.
- Bei Mathematik das BILD lesen. Gestapelte Brüche als \\frac{Z}{N}, gemischte Zahlen z. B. -5\\frac{1}{2}, Potenzen x^{2}, Wurzeln \\sqrt{x}.
- Vollständige Formeln möglichst in \\( ... \\) setzen.
- Antworte nur als JSON {"correctedText":"..."}.

ORIGINALTEXT:
<<<${taskText.slice(0, 9000)}>>>

ROHE PDF-TEXTSPUR:
<<<${rawPdfEvidence.slice(0, 7000)}>>>`;
  const parsed = await visionJsonRequest(images, prompt);
  const corrected = String(parsed?.correctedText || "").trim();
  const validation = validateTaskMathCorrection(taskText, corrected);
  if (!validation.ok) throw new Error(`Visuelle Korrektur verworfen: ${validation.reason}.`);
  return corrected;
}

/**
 * Repair mathematical layout only after task segmentation. If a task has several lettered
 * subtasks, the model never gets control over their labels: it returns the content by ordinal,
 * and we splice that content back behind the original labels. This avoids accidental "fixing"
 * of duplicate/missing letters in source worksheets.
 */
export async function repairTaskMathWithGroq(bytes: Buffer, taskText: string, pages: number[], rawPdfEvidence = "") {
  const evidence = rawPdfEvidence || await pageTextEvidence(bytes, pages);
  const split = splitSubtasks(taskText);
  if (split.parts.length >= 2) return await repairBySubtaskOrdinal(bytes, taskText, pages, evidence);
  return await repairWholeTask(bytes, taskText, pages, evidence);
}

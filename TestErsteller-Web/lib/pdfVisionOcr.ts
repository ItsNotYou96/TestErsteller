import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export function visionOcrConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function visionOcrModel() {
  return process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.6-27b";
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

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
  return Array.from(value.matchAll(/(?:^|\n|\s)\*?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase());
}

function numberMultiset(value: string) {
  return Array.from(value.normalize("NFKC").matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => m[0].replace(",", ".")).sort();
}

export function validateTaskMathCorrection(original: string, corrected: string) {
  const before = original.trim(), after = corrected.trim();
  if (!before || !after) return { ok: false, reason: "leerer Text" };
  if (subtaskLabels(before).join("|") !== subtaskLabels(after).join("|")) return { ok: false, reason: "Teilaufgaben wurden verändert" };
  if (numberMultiset(before).join("|") !== numberMultiset(after).join("|")) return { ok: false, reason: "Zahleninhalt wurde verändert" };
  const prose = tokenJaccard(proseTokens(before), proseTokens(after));
  if (prose < 0.84) return { ok: false, reason: `normaler Aufgabentext wurde zu stark verändert (${Math.round(prose * 100)} % Übereinstimmung)` };
  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.68 || ratio > 1.48) return { ok: false, reason: "Textlänge wurde unplausibel verändert" };
  return { ok: true, reason: "" };
}

export function likelyBrokenPdfMath(text: string) {
  const lines = text.replace(/\r/g, "").split("\n");
  const isolatedNumbers = lines.filter((line) => /^\s*[-+]?\d{1,3}\s*$/.test(line)).length;
  return isolatedNumbers > 0 || /[�□]/.test(text) || /\b[xyz]\d\b/i.test(text);
}

async function taskImages(bytes: Buffer, pages: number[]) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const unique = Array.from(new Set(pages.filter((p) => p > 0))).slice(0, 2);
    const images: string[] = [];
    for (const page of unique) {
      const shot = await parser.getScreenshot({ partial: [page], desiredWidth: 1500, imageDataUrl: true, imageBuffer: false });
      const dataUrl = String(shot.pages?.[0]?.dataUrl || "");
      if (dataUrl) images.push(dataUrl);
    }
    return images;
  } finally { await parser.destroy(); }
}

export async function repairTaskMathWithGroq(bytes: Buffer, taskText: string, pages: number[]) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die visuelle Mathekorrektur.");
  const images = await taskImages(bytes, pages);
  if (!images.length) throw new Error("Die zugehörige PDF-Seite konnte nicht gerendert werden.");
  const prompt = `Du transkribierst ausschließlich die mathematische Notation einer BEREITS ERKANNTEN Aufgabe aus einem deutschen Mathematikdokument. Die Seitenbilder dienen nur dazu, Brüche, Potenzen, Wurzeln und Rechenzeichen zu korrigieren.

HARTE REGELN:
- Der unten stehende Aufgabentext ist die verbindliche Quelle. Keine neue Aufgabe und keine Lösung erzeugen.
- Normalen deutschen Wortlaut nicht umformulieren.
- Keine Zahl hinzufügen, löschen oder ändern.
- Teilaufgaben a), b), *c) usw. exakt erhalten.
- Nur mathematische Notation korrigieren, wenn sie auf dem Bild eindeutig zu dieser Aufgabe gehört.
- Brüche als \\frac{a}{b}, Potenzen als x^{2}, Wurzeln als \\sqrt{x}, Multiplikation als \\cdot.
- Bei Unsicherheit Originalstelle unverändert lassen.
- Antworte ausschließlich als JSON-Objekt {"correctedText":"..."}.

VERBINDLICHER AUFGABENTEXT:
<<<
${taskText.slice(0, 9000)}
>>>`;

  for (let attempt = 0; attempt < 4; attempt++) {
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
        max_completion_tokens: 1800,
      }),
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("Groq Vision hat keine Ausgabe geliefert.");
      let parsed: any; try { parsed = JSON.parse(raw); } catch { throw new Error("Groq Vision hat kein gültiges JSON geliefert."); }
      const corrected = String(parsed?.correctedText || "").trim();
      const validation = validateTaskMathCorrection(taskText, corrected);
      if (!validation.ok) throw new Error(`Visuelle Korrektur verworfen: ${validation.reason}.`);
      return corrected;
    }
    const body = await response.text();
    if (response.status === 429 && attempt < 3) { await sleep((retrySeconds(response) + 0.5) * 1000); continue; }
    throw new Error(`Groq Vision/Mathekorrektur fehlgeschlagen (${response.status}): ${body}`);
  }
  throw new Error("Groq Vision/Mathekorrektur konnte nach mehreren Versuchen nicht ausgeführt werden.");
}

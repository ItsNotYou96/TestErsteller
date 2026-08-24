import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { likelyBrokenPdfMath } from "./pdfMathSignals";

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

function numbersBySubtask(value: string) {
  const text = value.replace(/\r/g, "");
  const labels = Array.from(text.matchAll(/(?:^|\n|\s)\*?([a-z])\)\s*/gim));
  if (!labels.length) return [numberMultiset(text).join("|")];
  const groups: string[] = [];
  const prefix = text.slice(0, labels[0].index ?? 0);
  if (prefix.trim()) groups.push(`prefix:${numberMultiset(prefix).join("|")}`);
  for (let i = 0; i < labels.length; i++) {
    const start = (labels[i].index ?? 0) + labels[i][0].length;
    const end = i + 1 < labels.length ? (labels[i + 1].index ?? text.length) : text.length;
    groups.push(`${labels[i][1].toLowerCase()}:${numberMultiset(text.slice(start, end)).join("|")}`);
  }
  return groups;
}

export function validateTaskMathCorrection(original: string, corrected: string) {
  const before = original.trim(), after = corrected.trim();
  if (!before || !after) return { ok: false, reason: "leerer Text" };
  if (subtaskLabels(before).join("|") !== subtaskLabels(after).join("|")) return { ok: false, reason: "Teilaufgaben wurden verändert" };
  if (numbersBySubtask(before).join("||") !== numbersBySubtask(after).join("||")) return { ok: false, reason: "Zahleninhalt einer Teilaufgabe wurde verändert" };
  const prose = tokenJaccard(proseTokens(before), proseTokens(after));
  if (prose < 0.84) return { ok: false, reason: `normaler Aufgabentext wurde zu stark verändert (${Math.round(prose * 100)} % Übereinstimmung)` };
  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.68 || ratio > 1.48) return { ok: false, reason: "Textlänge wurde unplausibel verändert" };
  return { ok: true, reason: "" };
}

export { likelyBrokenPdfMath };

async function taskImages(bytes: Buffer, pages: number[]) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const unique = Array.from(new Set(pages.filter((p) => p > 0))).slice(0, 2);
    const images: string[] = [];
    for (const page of unique) {
      const shot = await parser.getScreenshot({ partial: [page], desiredWidth: 1800, imageDataUrl: true, imageBuffer: false });
      const dataUrl = String(shot.pages?.[0]?.dataUrl || "");
      if (dataUrl) images.push(dataUrl);
    }
    return images;
  } finally { await parser.destroy(); }
}

export async function repairTaskMathWithGroq(bytes: Buffer, taskText: string, pages: number[], rawPdfEvidence = "") {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die visuelle Mathekorrektur.");
  const images = await taskImages(bytes, pages);
  if (!images.length) throw new Error("Die zugehörige PDF-Seite konnte nicht gerendert werden.");
  const anchor = taskText.replace(/\s+/g, " ").trim().slice(0, 220);
  const prompt = `Du reparierst ausschließlich die MATHEMATISCHE SCHREIBWEISE einer bereits erkannten Aufgabe in einem deutschen Mathematikdokument. Das Seitenbild ist für die räumliche Anordnung der Mathematik maßgeblich. PDF-Text kann Zähler und Nenner in falscher Reihenfolge liefern.

ZIELAUFGABE:
Sie beginnt mit diesem Wortlaut:
<<<${anchor}>>>

HARTE REGELN:
- Nur die Zielaufgabe bearbeiten. Andere Aufgaben auf dem Seitenbild vollständig ignorieren.
- Der deutsche Wortlaut des unten stehenden Aufgabentextes bleibt unverändert. Keine neue Aufgabe, Teilaufgabe, Zahl, Erklärung oder Lösung erzeugen.
- Teilaufgaben a), b), *c) usw. in exakt derselben Reihenfolge und Anzahl erhalten. Auch doppelte Buchstaben im Original bleiben doppelt.
- Bei mathematischen Stellen das BILD lesen, nicht die Reihenfolge der extrahierten Zahlentokens erraten.
- Sichtbar übereinander gesetzte Zähler/Nenner als \\frac{Z}{N} schreiben; gemischte Zahlen z. B. -5\\frac{1}{2}.
- Potenzen als x^{2}, Wurzeln als \\sqrt{x}, Multiplikation als \\cdot.
- Vollständige Gleichungen/Formeln möglichst in \\( ... \\) setzen, damit KaTeX die gesamte Formel formatiert.
- Bei Unsicherheit die betreffende Originalstelle unverändert lassen.
- Antworte ausschließlich als JSON-Objekt {"correctedText":"..."}.

WICHTIGES BEISPIEL FÜR PDF-SCHADEN:
Wenn der extrahierte Text etwa "d) 4 3 x+4=25" enthält, im Bild aber die 3 über der 4 steht, ist korrekt: "d) \\(\\frac{3}{4}x+4=25\\)". Das ist nur ein Beispiel für die Leserichtung; übernimm niemals Zahlen aus diesem Beispiel, sondern ausschließlich aus der Zielaufgabe.

VERBINDLICHER AUFGABENTEXT (WORTLAUT UND ZAHLENBESTAND):
<<<
${taskText.slice(0, 9000)}
>>>

ROHE PDF-TEXTSPUREN DERSELBEN AUFGABE (nur als Hinweis auf Extraktionsschäden, niemals als Layout-Quelle):
<<<
${rawPdfEvidence.slice(0, 7000)}
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

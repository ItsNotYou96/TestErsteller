import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export function visionOcrConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function visionOcrModel() {
  return process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.6-27b";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retrySeconds(response: Response) {
  const retry = Number(response.headers.get("retry-after") || "");
  if (Number.isFinite(retry) && retry > 0) return retry;
  const reset = response.headers.get("x-ratelimit-reset-tokens") || "";
  const sec = reset.match(/([0-9.]+)s/i);
  if (sec) return Math.max(1, Number(sec[1]));
  const ms = reset.match(/([0-9.]+)ms/i);
  if (ms) return Math.max(1, Number(ms[1]) / 1000);
  return 8;
}

async function groqVisionBatch(images: string[], firstPage: number, totalPages: number) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die visuelle PDF-Erkennung.");

  const pageLabel = images.length === 1
    ? `Seite ${firstPage}`
    : `Seiten ${firstPage}-${firstPage + images.length - 1}`;
  const prompt = `Du transkribierst ${pageLabel} von insgesamt ${totalPages} Seiten eines deutschen Mathematik-Arbeitsblatts für einen Aufgabenimport.

Gib ausschließlich die vollständige Transkription in natürlicher Lesereihenfolge aus. Nichts erklären und nichts lösen.
- Aufgabenummern (1., 2., ...), Teilaufgaben (a), b), ...) und Überschriften exakt erhalten.
- Mathematische Formeln möglichst als LaTeX schreiben, z. B. \\frac{3}{4}x+4=25, x^2, \\sqrt{5}.
- Dezimalkommas, Minuszeichen, Klammern und Relationszeichen sorgfältig übernehmen.
- Tabellen-/Antwortfelder nur dann als Text übernehmen, wenn sie inhaltlich beschriftet sind.
- Keine fehlenden Inhalte erfinden.
- Beginne jede Bildseite mit einer eigenen Zeile "-- Seite N --".`;

  const content: any[] = [{ type: "text", text: prompt }];
  for (const image of images) content.push({ type: "image_url", image_url: { url: image } });

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionOcrModel(),
        messages: [{ role: "user", content }],
        reasoning_effort: "none",
        temperature: 0.1,
        max_completion_tokens: 2200,
      }),
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text === "string" && text.trim()) return text.trim();
      throw new Error("Groq Vision hat keine Transkription geliefert.");
    }

    const body = await response.text();
    if (response.status === 429 && attempt < 3) {
      await sleep((retrySeconds(response) + 0.5) * 1000);
      continue;
    }
    throw new Error(`Groq Vision/OCR fehlgeschlagen (${response.status}): ${body}`);
  }
  throw new Error("Groq Vision/OCR konnte nach mehreren Versuchen nicht ausgeführt werden.");
}

export async function ocrPdfWithGroq(bytes: Buffer) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    // 1200 px keeps school worksheets readable while keeping image-token usage reasonable.
    const shots = await parser.getScreenshot({ desiredWidth: 1200, imageDataUrl: true, imageBuffer: false });
    const pages = (shots.pages || []).map((page: any) => String(page.dataUrl || "")).filter(Boolean);
    if (!pages.length) throw new Error("PDF-Seiten konnten für die visuelle Erkennung nicht gerendert werden.");

    const chunks: string[] = [];
    // One page per request is deliberate: the Groq Free Tier has an 8K TPM limit and image tokens
    // also count. Small page-wise requests avoid the same 413/token-burst problem as the old importer.
    for (let i = 0; i < pages.length; i += 1) {
      chunks.push(await groqVisionBatch([pages[i]], i + 1, pages.length));
    }
    return chunks.join("\n\n").trim();
  } finally {
    await parser.destroy();
  }
}

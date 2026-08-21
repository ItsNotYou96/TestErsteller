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

function normalizeCircledNumbers(value: string) {
  const chars = "①②③④⑤⑥⑦⑧⑨⑩";
  return value.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => `${chars.indexOf(c) + 1}.`);
}

function taskNumbers(value: string) {
  const text = normalizeCircledNumbers(value).replace(/\r/g, "");
  const out: number[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(?:Aufgabe\s*)?(\d{1,2})\s*(?:[:.)]|\s+\()/i);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > 0 && n <= 50 && !out.includes(n)) out.push(n);
  }
  return out;
}

const PROSE_STOP = new Set([
  "aufgabe", "aufgaben", "punkt", "punkte", "berechne", "bestimme", "gib", "zeichne", "ordne",
  "löse", "loese", "folgende", "folgenden", "wenn", "dabei", "eine", "einer", "einen", "einem", "eines",
  "und", "oder", "mit", "die", "der", "das", "den", "dem", "des", "von", "zur", "zum", "ist", "sind",
]);

function proseTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/\\(?:frac|sqrt|cdot|times|div|leq|geq|neq|mathbb|left|right)\b/g, " ")
    .replace(/\\[a-z]+/g, " ")
    .replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
    .replace(/[=+*/:^_<>−–—-]/g, " ")
    .replace(/[^a-zäöüß]+/gi, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 3 && !PROSE_STOP.has(x));
}

function tokenJaccard(a: string[], b: string[]) {
  const aa = new Set(a);
  const bb = new Set(b);
  if (!aa.size && !bb.size) return 1;
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const x of aa) if (bb.has(x)) common++;
  return common / (aa.size + bb.size - common);
}

function subtaskLabels(value: string) {
  return Array.from(value.matchAll(/(?:^|\n)\s*\*?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase());
}

function numberMultiset(value: string) {
  return Array.from(value.normalize("NFKC").matchAll(/\d+(?:[.,]\d+)?/g))
    .map((m) => m[0].replace(",", "."))
    .sort();
}


export function validateVisualCorrection(original: string, corrected: string) {
  const before = original.trim();
  const after = corrected.trim();
  if (!before || !after) return { ok: false, reason: "leerer Text" };

  const originalTasks = taskNumbers(before);
  const correctedTasks = taskNumbers(after);
  if (originalTasks.join(",") !== correctedTasks.join(",")) {
    return { ok: false, reason: `Aufgabennummern wurden verändert (${originalTasks.join(",")} → ${correctedTasks.join(",")})` };
  }

  const beforeParts = subtaskLabels(before);
  const afterParts = subtaskLabels(after);
  if (beforeParts.join("|") !== afterParts.join("|")) {
    return { ok: false, reason: `Teilaufgaben wurden verändert (${beforeParts.join(",")} → ${afterParts.join(",")})` };
  }

  // Formula repair may rearrange numbers into fractions, but it is not allowed to invent or remove
  // numeric literals. This is a strong anti-hallucination guard for worksheets.
  const beforeNumbers = numberMultiset(before);
  const afterNumbers = numberMultiset(after);
  if (beforeNumbers.join("|") !== afterNumbers.join("|")) {
    return { ok: false, reason: "Zahleninhalt wurde verändert; Korrektur aus Sicherheitsgründen verworfen" };
  }

  const proseScore = tokenJaccard(proseTokens(before), proseTokens(after));
  if (proseScore < 0.78) return { ok: false, reason: `zu große Textabweichung (${Math.round(proseScore * 100)} % Prosa-Übereinstimmung)` };

  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.62 || ratio > 1.55) return { ok: false, reason: `Textlänge unplausibel verändert (${Math.round(ratio * 100)} %)` };

  // A corrected page may repair symbols/formulas, but it must never create a fresh "Aufgabe N" line.
  if ((after.match(/^\s*Aufgabe\s+\d+/gim) || []).length > (before.match(/^\s*Aufgabe\s+\d+/gim) || []).length + 1) {
    return { ok: false, reason: "zusätzliche Aufgabenüberschriften erkannt" };
  }

  return { ok: true, reason: "" };
}

async function groqRepairPage(image: string, pageNumber: number, totalPages: number, authoritativeText: string) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die visuelle Formelkorrektur.");

  const prompt = `Du korrigierst ausschließlich die MATHEMATISCHE SCHREIBWEISE auf Seite ${pageNumber} von ${totalPages} eines deutschen Mathematik-Arbeitsblatts.

WICHTIG: Der unten angegebene PDF-Text ist die verbindliche Quelle für die Aufgabenstruktur und den Wortlaut. Das Bild dient NUR dazu, zerstückelte Formeln, Brüche, Potenzen, Wurzeln, Rechenzeichen und mathematische Sonderzeichen korrekt zu lesen.

HARTE REGELN:
1. Erfinde KEINE Aufgabe, Teilaufgabe, Zahl, Lösung, Überschrift oder Erklärung.
2. Lösche KEINE Aufgabe und formuliere KEINEN normalen Satz um.
3. Aufgabennummern und Teilaufgaben müssen exakt erhalten bleiben.
4. Ändere nur mathematische Notation, die im Bild eindeutig sichtbar ist.
5. Brüche als LaTeX schreiben, z. B. \\frac{3}{4}; Potenzen z. B. x^2; Wurzeln \\sqrt{5}; Multiplikation \\cdot.
6. Wenn eine Stelle visuell nicht eindeutig ist, lasse den Originaltext unverändert. Nicht raten.
7. Gib ausschließlich ein JSON-Objekt mit dem Schlüssel "correctedText" zurück.

VERBINDLICHER PDF-TEXT:
<<<
${authoritativeText.slice(0, 13000)}
>>>`;

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: visionOcrModel(),
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: image } },
          ],
        }],
        reasoning_effort: "none",
        reasoning_format: "hidden",
        temperature: 0,
        response_format: { type: "json_object" },
        max_completion_tokens: 2600,
      }),
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string" || !raw.trim()) throw new Error("Groq Vision hat keine Formelkorrektur geliefert.");
      let parsed: any;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error("Groq Vision hat kein gültiges JSON geliefert."); }
      const corrected = typeof parsed?.correctedText === "string" ? parsed.correctedText.trim() : "";
      if (!corrected) throw new Error("Groq Vision hat correctedText leer zurückgegeben.");
      return corrected;
    }

    const body = await response.text();
    if (response.status === 429 && attempt < 3) {
      await sleep((retrySeconds(response) + 0.5) * 1000);
      continue;
    }
    throw new Error(`Groq Vision/Formelkorrektur fehlgeschlagen (${response.status}): ${body}`);
  }
  throw new Error("Groq Vision/Formelkorrektur konnte nach mehreren Versuchen nicht ausgeführt werden.");
}

export type PdfPageText = { pageNumber: number; text: string };

export async function repairPdfMathWithGroq(bytes: Buffer, pages: PdfPageText[]) {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  const repaired: PdfPageText[] = [];
  const repairedPages: number[] = [];
  const rejectedPages: Array<{ pageNumber: number; reason: string }> = [];
  const skippedPages: number[] = [];

  try {
    for (const page of pages) {
      const authoritative = page.text.trim();
      const numbers = taskNumbers(authoritative);

      // No trustworthy text skeleton = no automatic full-page OCR. This is deliberate: without
      // anchors there is no deterministic way to prove that a vision model did not invent content.
      if (authoritative.length < 120 || numbers.length === 0) {
        repaired.push(page);
        skippedPages.push(page.pageNumber);
        continue;
      }

      const shot = await parser.getScreenshot({ partial: [page.pageNumber], desiredWidth: 1400, imageDataUrl: true, imageBuffer: false });
      const image = String(shot.pages?.[0]?.dataUrl || "");
      if (!image) {
        repaired.push(page);
        rejectedPages.push({ pageNumber: page.pageNumber, reason: "Seite konnte nicht gerendert werden" });
        continue;
      }

      try {
        const corrected = await groqRepairPage(image, page.pageNumber, pages.length, authoritative);
        const validation = validateVisualCorrection(authoritative, corrected);
        if (!validation.ok) {
          repaired.push(page);
          rejectedPages.push({ pageNumber: page.pageNumber, reason: validation.reason });
          continue;
        }
        repaired.push({ pageNumber: page.pageNumber, text: corrected });
        repairedPages.push(page.pageNumber);
      } catch (error) {
        repaired.push(page);
        rejectedPages.push({ pageNumber: page.pageNumber, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    await parser.destroy();
  }

  return { pages: repaired, repairedPages, rejectedPages, skippedPages };
}

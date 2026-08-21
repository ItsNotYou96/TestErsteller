import { randomUUID } from "node:crypto";
import * as mammoth from "mammoth";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import JSZip from "jszip";
import type { Competence } from "./types";
import type { ImportDraft } from "./adminTypes";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";
import { parsePointsSpec } from "./taskParsing";

export interface ParsedSource {
  name: string;
  mimeType: string;
  text: string;
  simplified: string;
  images: Array<{ dataUrl: string; name: string; decorative?: boolean }>;
  expectationRows: Array<{ title: string; expectation: string; pointsRaw: string }>;
  bytes: Buffer;
}

function xmlText(fragment: string) {
  return decodeEntities(
    fragment
      .replace(/<(?:w:t|m:t)\b[^>]*>([\s\S]*?)<\/(?:w:t|m:t)>/gi, "$1")
      .replace(/<w:tab\b[^>]*\/?>(?:<\/w:tab>)?/gi, "\t")
      .replace(/<w:br\b[^>]*\/?>(?:<\/w:br>)?/gi, "\n")
      .replace(/<[^>]+>/g, "")
  );
}

function mathAwareParagraph(fragment: string) {
  let value = fragment;
  // Preserve the most common OMML structures in a readable, LaTeX-like form before stripping XML.
  value = value.replace(/<m:f\b[^>]*>([\s\S]*?)<\/m:f>/gi, (_all, inner) => {
    const num = inner.match(/<m:num\b[^>]*>([\s\S]*?)<\/m:num>/i)?.[1] || "";
    const den = inner.match(/<m:den\b[^>]*>([\s\S]*?)<\/m:den>/i)?.[1] || "";
    return `\\frac{${xmlText(num)}}{${xmlText(den)}}`;
  });
  value = value.replace(/<m:sSup\b[^>]*>([\s\S]*?)<\/m:sSup>/gi, (_all, inner) => {
    const base = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || "";
    const sup = inner.match(/<m:sup\b[^>]*>([\s\S]*?)<\/m:sup>/i)?.[1] || "";
    return `${xmlText(base)}^{${xmlText(sup)}}`;
  });
  value = value.replace(/<m:sSub\b[^>]*>([\s\S]*?)<\/m:sSub>/gi, (_all, inner) => {
    const base = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || "";
    const sub = inner.match(/<m:sub\b[^>]*>([\s\S]*?)<\/m:sub>/i)?.[1] || "";
    return `${xmlText(base)}_{${xmlText(sub)}}`;
  });
  value = value.replace(/<m:rad\b[^>]*>([\s\S]*?)<\/m:rad>/gi, (_all, inner) => {
    const body = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || inner;
    return `\\sqrt{${xmlText(body)}}`;
  });
  return xmlText(value).replace(/[ \t]+/g, " ").trim();
}

async function docxTextWithMath(bytes: Buffer) {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")?.async("string");
    if (!xml) return "";
    const paragraphs = Array.from(xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi));
    return paragraphs.map((match) => mathAwareParagraph(match[1])).filter(Boolean).join("\n");
  } catch { return ""; }
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)));
}

function stripHtml(value: string) {
  return decodeEntities(value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim());
}

function expectationRowsFromHtml(html: string) {
  const tables = Array.from(html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi));
  for (const table of tables) {
    const rows = Array.from(table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
      Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => stripHtml(cell[1])),
    );
    if (!rows.length) continue;
    const header = rows[0].join(" ").toLowerCase();
    if (!header.includes("erwartung") || !header.includes("punkte")) continue;
    return rows.slice(1).filter((r) => r.length >= 2 && r[0]).map((r) => ({ title: r[0].trim(), expectation: (r[1] || "").trim(), pointsRaw: (r[2] || "").trim() }));
  }
  return [] as Array<{ title: string; expectation: string; pointsRaw: string }>;
}

function htmlToSimplified(html: string) {
  return decodeEntities(
    html
      .replace(/<img\b[^>]*data-import-image=["'](\d+)["'][^>]*>/gi, "\n[[IMG:$1]]\n")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

export async function parseUploadedFile(file: File): Promise<ParsedSource> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name || "Dokument";
  const ext = name.toLowerCase().split(".").pop();

  if (ext === "docx" || file.type.includes("wordprocessingml")) {
    const images: Array<{ dataUrl: string; name: string; decorative?: boolean }> = [];
    const htmlResult = await mammoth.convertToHtml(
      { buffer: bytes },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const index = images.length;
          const base64 = await image.read("base64");
          const contentType = image.contentType || "image/png";
          const imageName = `${name.replace(/\.docx$/i, "")}-bild-${index + 1}.${contentType.includes("jpeg") ? "jpg" : contentType.split("/")[1] || "png"}`;
          images.push({ dataUrl: `data:${contentType};base64,${base64}`, name: imageName });
          return { src: `about:blank`, "data-import-image": String(index) } as any;
        }),
      },
    );
    const counts = new Map<string, number>();
    for (const image of images) counts.set(image.dataUrl, (counts.get(image.dataUrl) || 0) + 1);
    for (const image of images) image.decorative = (counts.get(image.dataUrl) || 0) > 1;
    const raw = await mammoth.extractRawText({ buffer: bytes });
    const mathText = await docxTextWithMath(bytes);
    return {
      name,
      mimeType: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      text: mathText.length >= (raw.value || "").length * 0.8 ? mathText : (raw.value || ""),
      simplified: htmlToSimplified(htmlResult.value || "") || raw.value || "",
      images,
      expectationRows: expectationRowsFromHtml(htmlResult.value || ""),
      bytes,
    };
  }

  if (ext === "pdf" || file.type === "application/pdf") {
    const parser = new PDFParse({ data: Uint8Array.from(bytes) });
    try {
      const parsed = await parser.getText();
      const imageResult = await parser.getImage({ imageThreshold: 80, imageDataUrl: true, imageBuffer: false }).catch(() => undefined);
      const images = (imageResult?.pages || []).flatMap((page: any) => (page.images || []).map((image: any, index: number) => ({
        dataUrl: String(image.dataUrl || ""),
        name: `${name.replace(/\.pdf$/i, "")}-seite-${page.pageNumber || 1}-bild-${index + 1}.png`,
        decorative: false,
      }))).filter((image: any) => image.dataUrl && image.dataUrl.length <= 350_000);
      const text = (parsed.text || "").replace(/[\u200B\uFEFF]/g, "");
      return { name, mimeType: "application/pdf", text, simplified: text, images, expectationRows: [], bytes };
    } finally {
      await parser.destroy();
    }
  }

  throw new Error(`${name}: Nur PDF- und DOCX-Dateien werden unterstützt.`);
}

function taskNumberFromHeading(raw: string) {
  const normal = raw.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => String("①②③④⑤⑥⑦⑧⑨⑩".indexOf(c) + 1));
  const match = normal.match(/^\s*(?:Aufgabe\s*)?(\d{1,2})\b/i);
  return match?.[1] || "";
}

function cleanTaskHeading(raw: string) {
  return raw
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => String("①②③④⑤⑥⑦⑧⑨⑩".indexOf(c) + 1))
    .replace(/^\s*(?:Aufgabe\s*)?\d{1,2}\s*[:.)\-–]?\s*/i, "")
    .replace(/^\s*\(\s*(?:je\s*)?\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:P\.?|BE)\s*\)\s*/i, "")
    .replace(/\s*\(\s*\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:P\.?|BE)\s*\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromChunk(chunk: string, heading: string, taskNumber: string) {
  const cleanedHeading = cleanTaskHeading(heading);
  const cleanedChunk = cleanTaskHeading(chunk.replace(/\n+/g, " "));
  const source = cleanedHeading.length >= 5 ? cleanedHeading : cleanedChunk;
  const lower = source.toLowerCase();
  const combinedLower = cleanedChunk.toLowerCase();

  if (/magisch(?:es|en)?\s+quadrat/.test(combinedLower)) return "Magisches Quadrat";
  if (/subtraktionsmauer/.test(combinedLower)) return "Subtraktionsmauer";
  if (/gemischte aufgaben/.test(combinedLower)) return "Gemischte Aufgaben";
  if (/ordne der größe nach/.test(combinedLower)) return "Zahlen der Größe nach ordnen";
  if (/beträge/.test(combinedLower) && /ordne/.test(combinedLower)) return "Beträge ordnen";
  if (/säulendiagramm/.test(combinedLower) && /boxplot/.test(combinedLower)) return "Säulendiagramm und Boxplot";
  if (/boxplot/.test(combinedLower)) return "Boxplot";

  const firstSentence = source.split(/(?<=[.!?])\s+/)[0]
    .replace(/^(?:bei|ergänze|berechne|bestimme|ordne|gib|zeichne|untersuche|löse)\s+/i, "")
    .trim();
  if (firstSentence.length >= 4 && firstSentence.length <= 70) return firstSentence.replace(/[.:;!?]+$/, "");
  if (firstSentence.length > 70) return `${firstSentence.slice(0, 67).trim()}…`;
  return `Aufgabe ${taskNumber || ""}`.trim();
}

function pointsFromChunk(chunk: string, heading: string) {
  const normalized = chunk.replace(/\r/g, "");
  const lineMarkers = Array.from(normalized.matchAll(/(?:^|\n)\s*(?:Aufgabe\s*)?\d{0,2}\s*[:.)\-–]?\s*\(\s*(je\s*)?(\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*)\s*(?:P\.?|BE)\s*\)/gi));
  const markers = lineMarkers.map((m) => ({ each: Boolean(m[1]), raw: m[2].replace(/\s+/g, "") }));

  if (markers.length) {
    const first = markers[0];
    if (first.each && !first.raw.includes("+")) {
      const count = new Set(Array.from(chunk.matchAll(/^[\s\u200B\uFEFF]*[*]?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase())).size;
      if (count > 1) return Array.from({ length: count }, () => first.raw).join("+");
    }
    // A later line such as "(6 P.) ..." usually denotes another subpart of the same numbered task.
    // Keep all such point blocks so task 4 in the sample becomes 6+6 and task 5 becomes 3+10.
    return markers.map((m) => m.raw).join("+");
  }

  const inline = normalized.match(/\((\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*)\s*(?:P\.?|BE)?\)/i)
    || normalized.match(/(\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*)\s*(?:P\.|BE)\b/i);
  return inline ? inline[1].replace(/\s+/g, "") : "";
}

function topicScores(text: string, classLevel: string) {
  const keywords: Record<string, string[]> = {
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
  const lower = text.toLowerCase();
  return (LEGACY_TOPICS_BY_CLASS[classLevel] || []).map((topic) => ({
    topic,
    score: (keywords[topic] || []).reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
}

function guessClass(text: string, fallback?: string) {
  if (fallback && LEGACY_TOPICS_BY_CLASS[fallback]) return fallback;
  const match = text.match(/(?:klasse|jahrgang(?:sstufe)?|kl\.)\s*[:.]?\s*(7|8|9|10)\b/i);
  return match?.[1] || "7";
}

function guessTopic(text: string, classLevel: string, fallback?: string) {
  if (fallback && (LEGACY_TOPICS_BY_CLASS[classLevel] || []).includes(fallback)) return fallback;
  const scores = topicScores(text, classLevel);
  return scores[0]?.score ? scores[0].topic : (LEGACY_TOPICS_BY_CLASS[classLevel] || [""])[0] || "";
}

function guessCompetence(text: string): Competence {
  const lower = text.toLowerCase();
  if (/begründe|beweise|widerlege|beurteile|bewerte|argument|analysiere.+aussage/.test(lower)) return "Argumentieren";
  if (/problem|strategie|systematisch probier|finde (?:alle|einen weg)|untersuche verschiedene lösungswege/.test(lower)) return "Problemlösen";
  if (/sachverhalt|alltag|real(?:e|en)? situation|modell|interpretiere.+kontext|architekt|fahrstuhl|geschwindigkeit|kosten/.test(lower)) return "Modellieren";
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
  const partCount = (text.match(/^\s*[*]?[a-z]\)\s*/gim) || []).length;
  return Math.max(2, Math.round((points > 0 ? points * 1.8 : 4) + Math.max(0, partCount - 1)));
}

function normalizeCircledNumbers(value: string) {
  const chars = "①②③④⑤⑥⑦⑧⑨⑩";
  return value.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => String(chars.indexOf(c) + 1));
}

function isTaskStartLine(line: string) {
  const value = normalizeCircledNumbers(line).trim();
  if (/^Aufgabe\s*\d{1,2}\s*[:.)\-–]?/i.test(value)) return true;
  // Common worksheet/PDF layout: "1    (7 P.) ..." or "3 (Je 2 P.) ...".
  // Requiring the point marker avoids misreading headings such as "4. Klassenarbeit" as task 4.
  if (/^\d{1,2}\s*[:.)\-–]?\s*\(\s*(?:je\s*)?\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:P\.?|BE)\s*\)/i.test(value)) return true;
  return false;
}

function taskChunks(text: string) {
  const lines = normalizeCircledNumbers(text).replace(/\r/g, "").split("\n");
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (isTaskStartLine(lines[i])) starts.push(i);
  if (!starts.length) return [];
  return starts
    .map((start, index) => lines.slice(start, starts[index + 1] ?? lines.length).join("\n").trim())
    .map((chunk) => chunk
      // Remove recurring page footer/header debris that otherwise becomes part of the final task.
      .replace(/^\s*Mathematik\s+.*Seite\s+\d+\/\d+\s*$/gim, "")
      .replace(/^\s*Angaben zu den Urhebern.*$/gim, "")
      .replace(/^\s*https?:\/\/www\.tutory\.de\/.*$/gim, "")
      .replace(/^\s*Name:\s+.*$/gim, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim())
    .filter(Boolean);
}

function stripImageMarkers(text: string) {
  const indices = Array.from(text.matchAll(/\[\[IMG:(\d+)\]\]/g)).map((m) => Number(m[1]));
  return { text: text.replace(/\n?\[\[IMG:\d+\]\]\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), indices };
}

export function heuristicDrafts(sources: ParsedSource[], defaultClass?: string, defaultTopic?: string): ImportDraft[] {
  const drafts: ImportDraft[] = [];
  for (const source of sources) {
    const chunks = taskChunks(source.simplified || source.text);
    for (const chunk of chunks) {
      const firstLine = chunk.split("\n").find((x) => x.trim()) || "Aufgabe";
      const { text, indices } = stripImageMarkers(chunk);
      const bodyLines = text.split("\n");
      const heading = bodyLines.shift() || firstLine;
      const taskNumber = taskNumberFromHeading(heading);
      const pointsRaw = pointsFromChunk(text, heading);
      const maxPoints = parsePointsSpec(pointsRaw).maxPoints || 0;
      const classLevel = guessClass(`${source.name}\n${text}`, defaultClass);
      const topic = guessTopic(`${source.name}\n${text}`, classLevel, defaultTopic);
      const title = titleFromChunk(text, heading, taskNumber) || `Aufgabe ${taskNumber || drafts.length + 1}`;
      const cleanedFirstLine = cleanTaskHeading(heading);
      const explicitHeading = /^\s*Aufgabe\s*\d+/i.test(heading);
      const questionText = ([explicitHeading ? "" : cleanedFirstLine, ...bodyLines].join("\n")
        .replace(/(?:^|\n)\s*\(\s*(?:je\s*)?\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*\s*(?:P\.?|BE)\s*\)\s*/gi, "\n")
        .replace(/^\s+|\s+$/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()) || cleanTaskHeading(text);
      const imageIndex = indices.find((i) => source.images[i] && !source.images[i].decorative);
      const visualHint = /zeichne|skizziere|abbild|diagramm|zahlengerade|koordinatensystem|graph|bild/i.test(`${title} ${questionText}`);
      const foundImage = Number.isInteger(imageIndex)
        ? source.images[imageIndex as number]
        : (source.mimeType === "application/pdf" && source.images.length === 1 && visualHint ? source.images[0] : undefined);
      // Keep the API response safely below Vercel's 4.5 MB response limit. Larger images can still be selected manually in review.
      const image = foundImage && foundImage.dataUrl.length <= 350_000 ? foundImage : undefined;
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
        estimatedTime: estimatedTime(maxPoints, questionText),
        expectation: "",
        imageDataUrl: image?.dataUrl,
        imageName: image?.name,
        include: true,
        analysisMode: "heuristic",
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
    if (!draft.pointsRaw && row.pointsRaw) {
      draft.pointsRaw = row.pointsRaw.replace(/\s+/g, "");
      draft.maxPoints = parsePointsSpec(draft.pointsRaw).maxPoints || draft.maxPoints;
    }
    draft.confidence = { ...(draft.confidence || { topic: .45, competence: .4, afb: .35, time: .45, expectation: 0 }), expectation: row.expectation ? .95 : 0 };
  }
  return drafts;
}

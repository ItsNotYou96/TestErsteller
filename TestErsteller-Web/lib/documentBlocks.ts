import JSZip from "jszip";
import * as mammoth from "mammoth";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export type DocumentBlockKind = "paragraph" | "table" | "image" | "page-break";

export interface DocumentBlock {
  id: string;
  order: number;
  kind: DocumentBlockKind;
  text: string;
  page?: number;
  listLevel?: number;
  listIndex?: number;
  listLabel?: string;
  style?: string;
  bold?: boolean;
  fontSizePt?: number;
  imageIndex?: number;
  tableCells?: string[];
}

export interface SourceImage {
  dataUrl: string;
  name: string;
  decorative?: boolean;
}

export interface DocumentSource {
  name: string;
  mimeType: string;
  bytes: Buffer;
  text: string;
  blocks: DocumentBlock[];
  images: SourceImage[];
  expectationRows: Array<{ title: string; expectation: string; pointsRaw: string }>;
  pages?: Array<{ pageNumber: number; text: string }>;
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

function stripXml(value: string) {
  return decodeEntities(
    value
      .replace(/<w:tab\b[^>]*\/?>(?:<\/w:tab>)?/gi, "\t")
      .replace(/<w:br\b[^>]*\/?>(?:<\/w:br>)?/gi, "\n")
      .replace(/<(?:w:t|m:t)\b[^>]*>([\s\S]*?)<\/(?:w:t|m:t)>/gi, "$1")
      .replace(/<[^>]+>/g, ""),
  );
}


function encodeXmlText(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replaceOmml(fragment: string) {
  let value = fragment;
  value = value.replace(/<m:f\b[^>]*>([\s\S]*?)<\/m:f>/gi, (_all, inner) => {
    const num = inner.match(/<m:num\b[^>]*>([\s\S]*?)<\/m:num>/i)?.[1] || "";
    const den = inner.match(/<m:den\b[^>]*>([\s\S]*?)<\/m:den>/i)?.[1] || "";
    return `<w:t>${encodeXmlText(`\\frac{${stripXml(num)}}{${stripXml(den)}}`)}</w:t>`;
  });
  value = value.replace(/<m:sSup\b[^>]*>([\s\S]*?)<\/m:sSup>/gi, (_all, inner) => {
    const base = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || "";
    const sup = inner.match(/<m:sup\b[^>]*>([\s\S]*?)<\/m:sup>/i)?.[1] || "";
    return `<w:t>${encodeXmlText(`${stripXml(base)}^{${stripXml(sup)}}`)}</w:t>`;
  });
  value = value.replace(/<m:sSub\b[^>]*>([\s\S]*?)<\/m:sSub>/gi, (_all, inner) => {
    const base = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || "";
    const sub = inner.match(/<m:sub\b[^>]*>([\s\S]*?)<\/m:sub>/i)?.[1] || "";
    return `<w:t>${encodeXmlText(`${stripXml(base)}_{${stripXml(sub)}}`)}</w:t>`;
  });
  value = value.replace(/<m:rad\b[^>]*>([\s\S]*?)<\/m:rad>/gi, (_all, inner) => {
    const body = inner.match(/<m:e\b[^>]*>([\s\S]*?)<\/m:e>/i)?.[1] || inner;
    return `<w:t>${encodeXmlText(`\\sqrt{${stripXml(body)}}`)}</w:t>`;
  });
  return value;
}

function wordParagraphText(fragment: string) {
  let value = replaceOmml(fragment);
  value = value.replace(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi, (_all, run) => {
    const text = stripXml(run);
    if (!text) return "";
    if (/<w:vertAlign\b[^>]*w:val=["']superscript["']/i.test(run)) return `<w:t>${encodeXmlText(`^{${text}}`)}</w:t>`;
    if (/<w:vertAlign\b[^>]*w:val=["']subscript["']/i.test(run)) return `<w:t>${encodeXmlText(`_{${text}}`)}</w:t>`;
    return `<w:t>${encodeXmlText(text)}</w:t>`;
  });
  return stripXml(value).replace(/[ \t]+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function paragraphFormatting(fragment: string) {
  const style = fragment.match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i)?.[1];
  const runs = Array.from(fragment.matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/gi));
  let textRuns = 0;
  let boldRuns = 0;
  let maxHalfPoints = 0;
  for (const run of runs) {
    const text = stripXml(run[1]);
    if (!text.trim()) continue;
    textRuns++;
    if (/<w:b\b/i.test(run[1])) boldRuns++;
    const sizes = Array.from(run[1].matchAll(/<w:sz\b[^>]*w:val=["'](\d+)["']/gi)).map((m) => Number(m[1]));
    if (sizes.length) maxHalfPoints = Math.max(maxHalfPoints, ...sizes);
  }
  return {
    style,
    bold: textRuns > 0 ? boldRuns / textRuns >= 0.5 : false,
    fontSizePt: maxHalfPoints > 0 ? maxHalfPoints / 2 : undefined,
  };
}

type NumberLevel = { format: string; start: number; text: string };

function numberingDefinitions(xml: string) {
  const abstract = new Map<string, Map<number, NumberLevel>>();
  for (const match of xml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/w:abstractNum>/gi)) {
    const levels = new Map<number, NumberLevel>();
    for (const lvl of match[2].matchAll(/<w:lvl\b[^>]*w:ilvl=["'](\d+)["'][^>]*>([\s\S]*?)<\/w:lvl>/gi)) {
      levels.set(Number(lvl[1]), {
        format: lvl[2].match(/<w:numFmt\b[^>]*w:val=["']([^"']+)["']/i)?.[1] || "decimal",
        start: Number(lvl[2].match(/<w:start\b[^>]*w:val=["'](\d+)["']/i)?.[1] || 1),
        text: lvl[2].match(/<w:lvlText\b[^>]*w:val=["']([^"']+)["']/i)?.[1] || "%1.",
      });
    }
    abstract.set(match[1], levels);
  }
  const numToAbstract = new Map<string, string>();
  for (const match of xml.matchAll(/<w:num\b[^>]*w:numId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/w:num>/gi)) {
    const abs = match[2].match(/<w:abstractNumId\b[^>]*w:val=["']([^"']+)["']/i)?.[1];
    if (abs) numToAbstract.set(match[1], abs);
  }
  return { abstract, numToAbstract };
}

function listMeta(fragment: string, defs: ReturnType<typeof numberingDefinitions>, counters: Map<string, number[]>) {
  const numPr = fragment.match(/<w:numPr>([\s\S]*?)<\/w:numPr>/i)?.[1];
  if (!numPr) return {};
  const numId = numPr.match(/<w:numId\b[^>]*w:val=["']([^"']+)["']/i)?.[1];
  const level = Number(numPr.match(/<w:ilvl\b[^>]*w:val=["'](\d+)["']/i)?.[1] || 0);
  if (!numId) return { listLevel: level };
  const abs = defs.numToAbstract.get(numId);
  const levelDef = abs ? defs.abstract.get(abs)?.get(level) : undefined;
  const key = numId;
  const state = counters.get(key) || [];
  const initial = levelDef?.start || 1;
  state[level] = (state[level] ?? initial - 1) + 1;
  for (let i = level + 1; i < state.length; i++) state[i] = 0;
  counters.set(key, state);
  const index = state[level];
  const numeric = ["decimal", "decimalZero"].includes(levelDef?.format || "decimal") ? index : undefined;
  const label = levelDef?.text
    ? levelDef.text.replace(/%(\d+)/g, (_m, n) => String(state[Number(n) - 1] || index))
    : numeric ? `${numeric}.` : undefined;
  return { listLevel: level, listIndex: numeric, listLabel: label };
}

function relationships(xml: string) {
  const map = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b[^>]*Id=["']([^"']+)["'][^>]*Target=["']([^"']+)["'][^>]*\/?>(?:<\/Relationship>)?/gi)) {
    map.set(match[1], match[2]);
  }
  return map;
}

function mimeForName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "image/png";
}

function expectationRowsFromHtml(html: string) {
  const strip = (value: string) => decodeEntities(value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]+>/g, "").trim());
  for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows = Array.from(table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
      Array.from(row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((cell) => strip(cell[1])),
    );
    if (!rows.length) continue;
    const header = rows[0].join(" ").toLowerCase();
    if (!header.includes("erwartung") || !header.includes("punkte")) continue;
    return rows.slice(1).filter((r) => r.length >= 2 && r[0]).map((r) => ({ title: r[0].trim(), expectation: (r[1] || "").trim(), pointsRaw: (r[2] || "").trim() }));
  }
  return [] as Array<{ title: string; expectation: string; pointsRaw: string }>;
}

async function parseDocx(name: string, mimeType: string, bytes: Buffer): Promise<DocumentSource> {
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error(`${name}: word/document.xml fehlt.`);
  const numberingXml = await zip.file("word/numbering.xml")?.async("string") || "";
  const relsXml = await zip.file("word/_rels/document.xml.rels")?.async("string") || "";
  const defs = numberingDefinitions(numberingXml);
  const rels = relationships(relsXml);
  const counters = new Map<string, number[]>();
  const blocks: DocumentBlock[] = [];
  const images: SourceImage[] = [];
  const imageByRel = new Map<string, number>();
  let order = 0;

  const body = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/i)?.[1] || documentXml;
  const children: RegExpMatchArray[] = Array.from(body.matchAll(/<w:(p|tbl)\b[^>]*>([\s\S]*?)<\/w:\1>/gi));
  for (const child of children) {
    const type = child[1].toLowerCase();
    const fragment = child[2];
    if (type === "p") {
      const text = wordParagraphText(fragment);
      const formatting = paragraphFormatting(fragment);
      const list = listMeta(fragment, defs, counters);
      if (text) {
        blocks.push({ id: `B${String(++order).padStart(4, "0")}`, order, kind: "paragraph", text, ...formatting, ...list });
      }
      for (const img of fragment.matchAll(/<a:blip\b[^>]*r:embed=["']([^"']+)["']/gi)) {
        const relId = img[1];
        let imageIndex = imageByRel.get(relId);
        if (imageIndex === undefined) {
          const target = rels.get(relId);
          if (!target) continue;
          const normalized = target.replace(/^\.\.\//, "");
          const path = normalized.startsWith("word/") ? normalized : `word/${normalized}`;
          const file = zip.file(path);
          if (!file) continue;
          const base64 = await file.async("base64");
          imageIndex = images.length;
          images.push({ dataUrl: `data:${mimeForName(path)};base64,${base64}`, name: `${name.replace(/\.docx$/i, "")}-bild-${imageIndex + 1}.${path.split(".").pop() || "png"}` });
          imageByRel.set(relId, imageIndex);
        }
        blocks.push({ id: `B${String(++order).padStart(4, "0")}`, order, kind: "image", text: `[Bild ${imageIndex + 1}]`, imageIndex });
      }
    } else {
      let rowIndex = 0;
      for (const row of fragment.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)) {
        const cells = Array.from(row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi) as IterableIterator<RegExpMatchArray>).map((cell: RegExpMatchArray) => {
          const paras = Array.from(cell[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi) as IterableIterator<RegExpMatchArray>).map((p: RegExpMatchArray) => wordParagraphText(p[1])).filter(Boolean);
          return paras.join("\n").trim();
        });
        if (cells.some(Boolean)) {
          rowIndex++;
          blocks.push({ id: `B${String(++order).padStart(4, "0")}`, order, kind: "table", text: cells.join(" | "), tableCells: cells, style: `table-row-${rowIndex}` });
        }
      }
    }
  }

  // Mammoth remains useful for locating expectation-horizon tables; it is not used to decide task boundaries.
  const html = await mammoth.convertToHtml({ buffer: bytes }).catch(() => ({ value: "", messages: [] as any[] }));
  const expectationRows = expectationRowsFromHtml(html.value || "");
  const text = blocks.filter((b) => b.kind !== "image" && b.kind !== "page-break").map((b) => `${b.listLabel ? `${b.listLabel} ` : ""}${b.text}`).join("\n");
  return { name, mimeType, bytes, text, blocks, images, expectationRows };
}

function normalizePdfText(value: string) {
  return value
    .replace(/[⋅×]/g, " \\cdot ")
    .replace(/÷/g, " \\div ")
    .replace(/[−–—]/g, "-")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

async function parsePdf(name: string, bytes: Buffer): Promise<DocumentSource> {
  const parser = new PDFParse({ data: Uint8Array.from(bytes) });
  try {
    const initial = await parser.getText({ pageJoiner: "", itemJoiner: " " });
    const rawPages = Array.isArray((initial as any).pages) ? (initial as any).pages : [];
    const pages: Array<{ pageNumber: number; text: string }> = rawPages.length
      ? rawPages.map((page: any, index: number) => ({ pageNumber: Number(page.num || index + 1), text: String(page.text || "").trim() }))
      : [{ pageNumber: 1, text: String((initial as any).text || "").trim() }];
    const blocks: DocumentBlock[] = [];
    let order = 0;
    for (const page of pages) {
      if (blocks.length) blocks.push({ id: `B${String(++order).padStart(4, "0")}`, order, kind: "page-break", text: "", page: page.pageNumber });
      const lines = page.text.replace(/\r/g, "").split("\n").map(normalizePdfText).filter(Boolean);
      for (const line of lines) blocks.push({ id: `B${String(++order).padStart(4, "0")}`, order, kind: "paragraph", text: line, page: page.pageNumber });
    }

    const imageResult = await parser.getImage({ imageThreshold: 80, imageDataUrl: true, imageBuffer: false }).catch(() => undefined);
    const images = (imageResult?.pages || []).flatMap((page: any) => (page.images || []).map((image: any, index: number) => ({
      dataUrl: String(image.dataUrl || ""),
      name: `${name.replace(/\.pdf$/i, "")}-seite-${page.pageNumber || 1}-bild-${index + 1}.png`,
      decorative: false,
    }))).filter((image: any) => image.dataUrl && image.dataUrl.length <= 350_000);
    const text = pages.map((p) => p.text).join("\n\n");
    return { name, mimeType: "application/pdf", bytes, text, blocks, images, expectationRows: [], pages };
  } finally {
    await parser.destroy();
  }
}

export async function parseDocumentFile(file: File): Promise<DocumentSource> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = file.name || "Dokument";
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "docx" || file.type.includes("wordprocessingml")) {
    return parseDocx(name, file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes);
  }
  if (ext === "pdf" || file.type === "application/pdf") return parsePdf(name, bytes);
  throw new Error(`${name}: Nur PDF- und DOCX-Dateien werden unterstützt.`);
}

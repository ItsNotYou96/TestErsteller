import { NextResponse } from "next/server";
import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeightRule,
  ImageRun,
  Math as WordMath,
  MathFraction,
  MathRadical,
  MathRun,
  MathSubScript,
  MathSuperScript,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from "docx";
import type { TaskItem, TestMetadata } from "@/lib/types";

export const runtime = "nodejs";

type ExportPayload = { tasks: TaskItem[]; metadata: TestMetadata };

const LEGACY_ASSETS: Record<string, string> = {
  "fro_icon.png": "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",
  "pictogramm_extrablatt.png": "iVBORw0KGgoAAAANSUhEUgAAACQAAAAkBAMAAAATLoWrAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAqUExURQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAoTzogAAAAOdFJOUwCf/7/PIK9A7zCAYI8QHa1scwAAAAlwSFlzAAAOwwAADsMBx2+oZAAAAIBJREFUKM9jYKAACCmBgQGmkEoAklB6ORAoKXUiCQmASKUkpQJ0oSolbXShgkVKC9CFuJQU0YS2hgrBHQIVAgEdTCFFuNDV0FiGUCAIQwgFKSmDWYwIodu7t6MLXQ0Fg1hGZI1goIqiEQz2Dk2NsPDFK2ReDgVlcCElOMAjRBYAAGV9Smju8pR/AAAAAElFTkSuQmCC",
  "piktogramm_aufgabenblatt.png": "iVBORw0KGgoAAAANSUhEUgAAAB4AAAAfCAMAAADHso01AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAACrUExURQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADQ1tEQAAAA5dFJOUwAYv8841//bBO8o34Dn+7frCGjzDDx0VGyPeJ+rQMNElyzLSc27OiAcrzW5KgGKcFCnL7P3WDDjEMPB4p0AAAAJcEhZcwAADsMAAA7DAcdvqGQAAADcSURBVDhPtdHbUoMwFIXhpMICYwnagEilrfUIHrHn93+yzk7p0NmTxiv/y/UNDCRC/EtycBHwrU+GQBTz9RgpLs+xugKAIZ+7VAJAp9c3HGxWMRqZjAuVW70t9B0XKjekZaHHXKiD3he65ELFEWk1cWsg6bumM/PAhcpNKOfmMTOV60SenoGX10CKN5fW9o8aPne9f5CmZ+7ps/FpNiUNJd8PxZVPv759bxY/vmdFq30qJgPgd8HXrnipVFI5754qkajadYy2Flit+djXINrwrW++He74dtLOh3+0B5TEDLu2ggHgAAAAAElFTkSuQmCC",
};

const gradeThresholds = [
  [0, 0], [9, 1], [18, 2], [27, 3], [36, 4], [45, 5], [50, 6], [60, 7],
  [65, 8], [70, 9], [75, 10], [80, 11], [85, 12], [90, 13], [95, 14], [100, 15],
] as const;

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "000000" } as const;
const allBorders = {
  top: thinBorder,
  bottom: thinBorder,
  left: thinBorder,
  right: thinBorder,
  insideHorizontal: thinBorder,
  insideVertical: thinBorder,
};

function textLines(text: string) {
  return (text || "").replace(/\r/g, "").split("\n");
}

function formPointsNumber(metadata: TestMetadata) {
  const value = Number(String(metadata.formPoints || "").replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function totalPoints(tasks: TaskItem[], metadata: TestMetadata) {
  return tasks.reduce((sum, task) => sum + task.maxPoints, 0) + formPointsNumber(metadata);
}

function formatDate(value?: string) {
  if (!value) return "";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

const latexSymbols: Record<string, string> = {
  "\\cdot": "·", "\\times": "×", "\\div": "÷", "\\pm": "±", "\\mp": "∓",
  "\\le": "≤", "\\leq": "≤", "\\ge": "≥", "\\geq": "≥", "\\neq": "≠",
  "\\approx": "≈", "\\infty": "∞", "\\pi": "π", "\\alpha": "α", "\\beta": "β",
  "\\gamma": "γ", "\\delta": "δ", "\\theta": "θ", "\\lambda": "λ", "\\mu": "μ",
  "\\sigma": "σ", "\\omega": "ω", "\\rightarrow": "→", "\\Rightarrow": "⇒",
};

function readBraceGroup(input: string, open: number) {
  if (input[open] !== "{") return { content: input[open] || "", next: open + 1 };
  let depth = 0;
  for (let i = open; i < input.length; i++) {
    if (input[i] === "{") depth++;
    else if (input[i] === "}") {
      depth--;
      if (depth === 0) return { content: input.slice(open + 1, i), next: i + 1 };
    }
  }
  return { content: input.slice(open + 1), next: input.length };
}

function normalizeLatexText(text: string) {
  let out = text;
  for (const [cmd, symbol] of Object.entries(latexSymbols)) out = out.split(cmd).join(symbol);
  out = out.replace(/\\,/g, " ").replace(/\\;/g, " ").replace(/\\!/g, "");
  out = out.replace(/\\left|\\right/g, "");
  out = out.replace(/\\text\{([^}]*)\}/g, "$1");
  return out;
}

function mathComponents(input: string): any[] {
  const src = normalizeLatexText(input.trim());
  const components: any[] = [];
  let buffer = "";
  const flush = () => { if (buffer) { components.push(new MathRun(buffer)); buffer = ""; } };

  for (let i = 0; i < src.length;) {
    if (src.startsWith("\\frac", i)) {
      flush();
      let pos = i + 5;
      while (src[pos] === " ") pos++;
      const num = readBraceGroup(src, pos); pos = num.next;
      while (src[pos] === " ") pos++;
      const den = readBraceGroup(src, pos);
      components.push(new MathFraction({ numerator: mathComponents(num.content), denominator: mathComponents(den.content) }));
      i = den.next; continue;
    }
    if (src.startsWith("\\sqrt", i)) {
      flush();
      let pos = i + 5;
      while (src[pos] === " ") pos++;
      const rad = readBraceGroup(src, pos);
      components.push(new MathRadical({ children: mathComponents(rad.content) }));
      i = rad.next; continue;
    }
    if (src[i] === "^" || src[i] === "_") {
      const isSup = src[i] === "^";
      const base = buffer.slice(-1) || " ";
      buffer = buffer.slice(0, -1);
      flush();
      const pos = i + 1;
      const script = src[pos] === "{" ? readBraceGroup(src, pos) : { content: src[pos] || "", next: pos + 1 };
      const opts = { children: [new MathRun(base)], ...(isSup ? { superScript: mathComponents(script.content) } : { subScript: mathComponents(script.content) }) };
      components.push(isSup ? new MathSuperScript(opts as any) : new MathSubScript(opts as any));
      i = script.next; continue;
    }
    if (src[i] === "\\") {
      const command = src.slice(i).match(/^\\[A-Za-z]+/)?.[0];
      if (command) {
        flush();
        components.push(new MathRun(latexSymbols[command] || command.slice(1)));
        i += command.length; continue;
      }
    }
    if (src[i] === "{" || src[i] === "}") { i++; continue; }
    buffer += src[i++];
  }
  flush();
  return components.length ? components : [new MathRun(src)];
}

function wordMath(latex: string) {
  const clean = latex
    .replace(/^\$\$|\$\$$/g, "")
    .replace(/^\$|\$$/g, "")
    .replace(/^\\\(|\\\)$/g, "")
    .replace(/^\\\[|\\\]$/g, "");
  return new WordMath({ children: mathComponents(clean) });
}

function inlineChildrenWithMath(text: string, italics = false): any[] {
  const delimiter = /(\$\$[^$]+?\$\$|\$[^$]+?\$|\\\([^)]*?\\\)|\\\[[^\]]*?\\\])/g;
  const children: any[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = delimiter.exec(text)) !== null) {
    if (match.index > last) children.push(new TextRun({ text: text.slice(last, match.index), italics, font: "Aptos", size: 22 }));
    children.push(wordMath(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) children.push(new TextRun({ text: text.slice(last), italics, font: "Aptos", size: 22 }));
  if (children.length) return children;

  const standalone = /(\\frac\{[^}]+\}\{[^}]+\}|\\sqrt\{[^}]+\}|\\[A-Za-z]+|\b(?:\d+)?[A-Za-z]\^\{?[-+A-Za-z0-9]+\}?)/g;
  last = 0;
  while ((match = standalone.exec(text)) !== null) {
    if (match.index > last) children.push(new TextRun({ text: text.slice(last, match.index), italics, font: "Aptos", size: 22 }));
    children.push(wordMath(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) children.push(new TextRun({ text: text.slice(last), italics, font: "Aptos", size: 22 }));
  return children.length ? children : [new TextRun({ text, italics, font: "Aptos", size: 22 })];
}

function questionParagraphs(text: string) {
  return textLines(text).map((line) => new Paragraph({
    children: inlineChildrenWithMath(line),
    spacing: { before: 0, after: 0 },
  }));
}

function mathParagraphs(text: string) {
  return textLines(text || "–").map((line) => new Paragraph({
    children: inlineChildrenWithMath(line),
    spacing: { before: 0, after: 100 },
  }));
}

async function legacyAsset(name: string) {
  const encoded = LEGACY_ASSETS[name];
  return encoded ? new Uint8Array(Buffer.from(encoded, "base64")) : null;
}

function imageKind(data: Uint8Array, contentType = ""): "png" | "jpg" | null {
  const lower = contentType.toLowerCase();
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  return null;
}

function imageDimensions(data: Uint8Array, type: "png" | "jpg") {
  if (type === "png" && data.length >= 24) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
  }
  if (type === "jpg") {
    let pos = 2;
    while (pos + 9 < data.length) {
      if (data[pos] !== 0xff) { pos++; continue; }
      const marker = data[pos + 1];
      const len = (data[pos + 2] << 8) + data[pos + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: (data[pos + 5] << 8) + data[pos + 6], width: (data[pos + 7] << 8) + data[pos + 8] };
      }
      if (len < 2) break;
      pos += 2 + len;
    }
  }
  return { width: 640, height: 360 };
}

/** The WPF generator inserted task images at their original pixel dimensions. */
async function imageParagraph(url?: string) {
  if (!url) return null;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = new Uint8Array(await res.arrayBuffer());
    const type = imageKind(data, res.headers.get("content-type") || "");
    if (!type) return null;
    const raw = imageDimensions(data, type);
    return new Paragraph({
      children: [new ImageRun({ data, transformation: { width: raw.width, height: raw.height }, type })],
      alignment: AlignmentType.LEFT,
      spacing: { before: 0, after: 0 },
    });
  } catch {
    return null;
  }
}

function aptosRun(text: string, options: { bold?: boolean; italics?: boolean; underline?: boolean; size?: number } = {}) {
  return new TextRun({
    text,
    font: "Aptos",
    size: options.size ?? 22,
    bold: options.bold,
    italics: options.italics,
    underline: options.underline ? { type: UnderlineType.SINGLE } : undefined,
  });
}

function verdanaRun(text: string, size = 16) {
  return new TextRun({ text, font: "Verdana", size });
}

function blankParagraph() {
  return new Paragraph({ children: [aptosRun("")] });
}

function studentCell(runs: TextRun[]) {
  return new TableCell({
    children: [new Paragraph({ children: runs, spacing: { before: 0, after: 0 } })],
  });
}

function scoreCell(label: string, points: number | string) {
  return studentCell([
    aptosRun(` ${label}: `, { size: 20 }),
    aptosRun("     ", { underline: true, size: 20 }),
    aptosRun(` ______/ ${points} BE`, { size: 20 }),
  ]);
}

function underlinedLabelCell(label: string, tail = "") {
  return studentCell([
    aptosRun(` ${label}: `, { size: 20 }),
    aptosRun("           ", { underline: true, size: 20 }),
    ...(tail ? [aptosRun(tail, { size: 20 })] : []),
  ]);
}

function parseFormPointSplit(metadata: TestMetadata) {
  const total = formPointsNumber(metadata);
  if (total <= 0) return { total: 0, language: 0, handwriting: 0, mathForm: 0 };
  const language = Math.min(1, total);
  const handwriting = Math.min(1, Math.max(0, total - language));
  const mathForm = Math.max(0, total - language - handwriting);
  return { total, language, handwriting, mathForm };
}

async function legacyHeader(metadata: TestMetadata) {
  const logo = await legacyAsset("fro_icon.png");
  const left = new TableCell({
    width: { size: 32, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({ children: [verdanaRun("Fritz-Reuter-Oberschule")], spacing: { before: 0, after: 0, line: 200 } }),
      new Paragraph({ children: [verdanaRun(metadata.classLevel || "")], spacing: { before: 0, after: 0, line: 200 } }),
      new Paragraph({ children: [verdanaRun(metadata.teacher?.trim() || "Lehrkraft")], spacing: { before: 0, after: 0, line: 200 } }),
    ],
  });
  const center = new TableCell({
    width: { size: 46, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [aptosRun(metadata.title || "Klassenarbeit", { bold: true, size: 28 })],
        spacing: { before: 0, after: 20 },
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [aptosRun(metadata.topic || "", { size: 18 })],
        spacing: { before: 0, after: 0 },
      }),
    ],
  });
  const logoCell = new TableCell({
    width: { size: 6, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: logo ? [new ImageRun({ data: logo, transformation: { width: 132, height: 29 }, type: "png" })] : [],
      spacing: { before: 0, after: 0 },
    })],
  });
  const date = new TableCell({
    width: { size: 24, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [verdanaRun(formatDate(metadata.date) || "")],
      spacing: { before: 0, after: 0 },
    })],
  });

  return new Header({
    children: [new Table({
      width: { size: 99.6, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.AUTOFIT,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 8 },
        bottom: { style: BorderStyle.SINGLE, size: 8 },
        left: { style: BorderStyle.SINGLE, size: 8 },
        right: { style: BorderStyle.SINGLE, size: 8 },
        insideHorizontal: { style: BorderStyle.NONE, size: 0 },
        insideVertical: { style: BorderStyle.NONE, size: 0 },
      },
      margins: { top: 100, bottom: 100, left: 150, right: 150 },
      rows: [new TableRow({ children: [left, center, logoCell, date] })],
    })],
  });
}

function studentOverview(tasks: TaskItem[], metadata: TestMetadata) {
  const rows: TableRow[] = [
    new TableRow({ children: [
      underlinedLabelCell("Vorname"),
      underlinedLabelCell("Name"),
      studentCell([
        aptosRun(` Hilfsmittel: ${metadata.tools?.trim() || "/"}`, { size: 20 }),
        aptosRun("           ", { underline: true, size: 20 }),
      ]),
    ] }),
  ];

  for (let i = 0; i < tasks.length; i += 3) {
    const cells: TableCell[] = [];
    for (let j = 0; j < 3; j++) {
      const task = tasks[i + j];
      cells.push(task ? scoreCell(`Aufgabe ${i + j + 1}`, task.maxPoints) : studentCell([aptosRun("", { size: 20 })]));
    }
    rows.push(new TableRow({ children: cells }));
  }

  const form = parseFormPointSplit(metadata);
  if (form.total > 0) {
    rows.push(new TableRow({ children: [
      underlinedLabelCell("Sprache", `_____/ ${form.language} BE`),
      underlinedLabelCell("Schriftbild", `_____/ ${form.handwriting} BE`),
      underlinedLabelCell("Mathematische Form", `_____/ ${form.mathForm} BE`),
    ] }));
  }

  rows.push(new TableRow({ children: [
    studentCell([
      aptosRun(` Punktzahl: ______/${totalPoints(tasks, metadata)} BE`, { size: 20 }),
      aptosRun("           ", { underline: true, size: 20 }),
    ]),
    underlinedLabelCell("Notenpunkte"),
    underlinedLabelCell("Note"),
  ] }));

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    borders: allBorders,
    margins: { top: 40, bottom: 40, left: 120, right: 120 },
    rows,
  });
}

function mirrorCell(text: string, bold = false) {
  return new TableCell({
    width: { size: 725, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [aptosRun(text, { bold, size: 22 })],
      spacing: { before: 0, after: 0 },
    })],
  });
}

function notenspiegel() {
  const thick = { style: BorderStyle.SINGLE, size: 8, color: "000000" } as const;
  const borders = { top: thick, bottom: thick, left: thick, right: thick, insideHorizontal: thick, insideVertical: thick };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    columnWidths: [650, 725, 725, 725, 725, 725, 725],
    borders,
    rows: [
      new TableRow({ height: { value: 300, rule: HeightRule.EXACT }, children: [
        mirrorCell("Note", true), mirrorCell("1"), mirrorCell("2"), mirrorCell("3"), mirrorCell("4"), mirrorCell("5"), mirrorCell("6"),
      ] }),
      new TableRow({ height: { value: 300, rule: HeightRule.EXACT }, children: [
        mirrorCell("Anzahl", true), mirrorCell(""), mirrorCell(""), mirrorCell(""), mirrorCell(""), mirrorCell(""), mirrorCell(""),
      ] }),
    ],
  });
}

async function hintParagraphs() {
  const extra = await legacyAsset("pictogramm_extrablatt.png");
  const sheet = await legacyAsset("piktogramm_aufgabenblatt.png");
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [aptosRun("Hinweise", { italics: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        ...(extra ? [new ImageRun({ data: extra, transformation: { width: 30, height: 30 }, type: "png" })] : []),
        aptosRun(" "),
        aptosRun("Aufgaben mit diesem Symbol müssen auf einem Extrablatt erledigt werden."),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        ...(sheet ? [new ImageRun({ data: sheet, transformation: { width: 29, height: 30 }, type: "png" })] : []),
        aptosRun(" "),
        aptosRun("Aufgaben mit diesem Symbol sollen auf dem Aufgabenblatt erledigt werden."),
      ],
    }),
    blankParagraph(),
    new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 8, color: "000000" } },
      children: [],
    }),
  ];
}

function pointsHeading(task: TaskItem) {
  const raw = (task.pointsRaw || "").trim();
  return raw || String(task.maxPoints);
}

async function taskHeading(index: number, task: TaskItem) {
  const icon = await legacyAsset(task.onExtraSheet ? "pictogramm_extrablatt.png" : "piktogramm_aufgabenblatt.png");
  const children: any[] = [aptosRun(`Aufgabe ${index + 1}: ${task.title || "Aufgabe"} (${pointsHeading(task)} P.)`, { bold: true })];
  if (icon) {
    children.push(
      aptosRun(" "),
      new ImageRun({
        data: icon,
        transformation: task.onExtraSheet ? { width: 21, height: 22 } : { width: 21, height: 22 },
        type: "png",
      }),
    );
  }
  return new Paragraph({ children, spacing: { before: 0, after: 0 } });
}

async function createTest(tasks: TaskItem[], metadata: TestMetadata) {
  const children: any[] = [blankParagraph(), studentOverview(tasks, metadata), blankParagraph()];

  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [aptosRun("Notenspiegel", { italics: true })],
  }));
  children.push(notenspiegel(), blankParagraph());
  children.push(...await hintParagraphs());

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    children.push(await taskHeading(i, task));
    children.push(...questionParagraphs(task.questionText));
    children.push(blankParagraph());
    const image = await imageParagraph(task.imageUrl);
    if (image) children.push(image);
  }

  const header = await legacyHeader(metadata);
  return Packer.toBuffer(new Document({
    styles: { default: { document: { run: { font: "Aptos", size: 22 } } } },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 720, footer: 720 } },
      },
      headers: { default: header },
      children,
    }],
  }));
}

function expectationCell(text: string, bold = false) {
  return new TableCell({
    children: [new Paragraph({
      children: [aptosRun(text, { bold })],
      spacing: { before: 0, after: 0 },
    })],
  });
}

function horizontalGradeTable(total: number) {
  const firstRow = [expectationCell("Prozent"), ...gradeThresholds.map(([percent]) => expectationCell(`${percent}%`))];
  const secondRow = [expectationCell("Notenpunkte"), ...gradeThresholds.map(([, np]) => expectationCell(String(np)))];
  const thirdRow = [expectationCell("Punkte ab"), ...gradeThresholds.map(([percent]) => expectationCell(String(Math.ceil(total * percent / 100))))];
  return new Table({
    layout: TableLayoutType.AUTOFIT,
    borders: allBorders,
    rows: [
      new TableRow({ children: firstRow }),
      new TableRow({ children: secondRow }),
      new TableRow({ children: thirdRow }),
    ],
  });
}

async function createExpectation(tasks: TaskItem[], metadata: TestMetadata) {
  const rows: TableRow[] = [new TableRow({ children: [
    expectationCell("Aufgabe"),
    expectationCell("Erwartungshorizont"),
    expectationCell("Punkte"),
  ] })];

  for (const task of tasks) {
    rows.push(new TableRow({ children: [
      expectationCell(task.title || "Aufgabe"),
      new TableCell({ children: mathParagraphs(task.expectation || "") }),
      expectationCell(task.pointsRaw || String(task.maxPoints)),
    ] }));
  }

  const total = totalPoints(tasks, metadata);
  const children: any[] = [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      layout: TableLayoutType.AUTOFIT,
      borders: allBorders,
      rows,
    }),
    new Paragraph({ children: [aptosRun("Notenpunkte-Tabelle:")] }),
    horizontalGradeTable(total),
  ];

  return Packer.toBuffer(new Document({
    styles: { default: { document: { run: { font: "Aptos", size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children,
    }],
  }));
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ExportPayload;
    if (!payload.tasks?.length) return NextResponse.json({ error: "Keine Aufgaben ausgewählt." }, { status: 400 });

    const [test, expectation] = await Promise.all([
      createTest(payload.tasks, payload.metadata),
      createExpectation(payload.tasks, payload.metadata),
    ]);

    const zip = new JSZip();
    const safe = (payload.metadata.title || "Klassenarbeit").replace(/[\\/:*?"<>|]+/g, "-");
    zip.file(`${safe}.docx`, test);
    zip.file(`${safe}_Erwartung.docx`, expectation);
    const out = await zip.generateAsync({ type: "uint8array" });
    const body = Uint8Array.from(out).buffer;

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safe)}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

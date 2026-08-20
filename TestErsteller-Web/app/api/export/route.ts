import { NextResponse } from "next/server";
import JSZip from "jszip";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
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
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { TaskItem, TestMetadata } from "@/lib/types";

export const runtime = "nodejs";

type ExportPayload = { tasks: TaskItem[]; metadata: TestMetadata };

const gradeThresholds = [
  [0, 0], [9, 1], [18, 2], [27, 3], [36, 4], [45, 5], [50, 6], [60, 7],
  [65, 8], [70, 9], [75, 10], [80, 11], [85, 12], [90, 13], [95, 14], [100, 15],
] as const;

function textLines(text: string) {
  return (text || "").replace(/\r/g, "").split("\n");
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
      let pos = i + 1;
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
    if (match.index > last) children.push(new TextRun({ text: text.slice(last, match.index), italics }));
    children.push(wordMath(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) children.push(new TextRun({ text: text.slice(last), italics }));
  if (children.length) return children;

  // Legacy behavior also recognized common LaTeX/power terms without delimiters.
  const standalone = /(\\frac\{[^}]+\}\{[^}]+\}|\\sqrt\{[^}]+\}|\\[A-Za-z]+|\b(?:\d+)?[A-Za-z]\^\{?[-+A-Za-z0-9]+\}?)/g;
  last = 0;
  while ((match = standalone.exec(text)) !== null) {
    if (match.index > last) children.push(new TextRun({ text: text.slice(last, match.index), italics }));
    children.push(wordMath(match[0]));
    last = match.index + match[0].length;
  }
  if (last < text.length) children.push(new TextRun({ text: text.slice(last), italics }));
  return children.length ? children : [new TextRun({ text, italics })];
}

function questionParagraphs(text: string) {
  // Keep the original star marker (* / ⋆ / ✱) visible. It carries the
  // same choice/alternative meaning as in the WPF source data.
  return textLines(text).map((line) => new Paragraph({
    children: inlineChildrenWithMath(line),
    spacing: { after: 80 },
  }));
}

function mathParagraphs(text: string) {
  return textLines(text || "–").map((line) => new Paragraph({ children: inlineChildrenWithMath(line) }));
}

async function imageParagraph(url?: string) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const data = new Uint8Array(await res.arrayBuffer());
    const type = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : contentType.includes("png") ? "png" : null;
    if (!type) return null;
    return new Paragraph({
      children: [new ImageRun({ data, transformation: { width: 420, height: 250 }, type })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    });
  } catch {
    return null;
  }
}

function headerTable(metadata: TestMetadata) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: metadata.title || "Mathematik-Test", bold: true, size: 28 })] })], columnSpan: 2 }),
      ]}),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph(`Klasse: ${metadata.classLevel || ""}`)] }),
        new TableCell({ children: [new Paragraph(`Thema: ${metadata.topic || ""}`)] }),
      ]}),
      new TableRow({ children: [
        new TableCell({ children: [new Paragraph(`Hilfsmittel: ${metadata.tools || "–"}`)] }),
        new TableCell({ children: [new Paragraph(`Formelpunkte: ${metadata.formPoints || "–"}`)] }),
      ]}),
    ],
  });
}

function gradeTable(totalPoints: number) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "ab %", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Notenpunkte", bold: true })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "ab Rohpunkten", bold: true })] })] }),
      ]}),
      ...gradeThresholds.map(([percent, np]) => new TableRow({ children: [
        new TableCell({ children: [new Paragraph(`${percent}%`)] }),
        new TableCell({ children: [new Paragraph(`${np} NP`)] }),
        new TableCell({ children: [new Paragraph(String(Math.ceil(totalPoints * percent / 100)))] }),
      ]})),
    ],
  });
}

async function createTest(tasks: TaskItem[], metadata: TestMetadata) {
  const children: any[] = [headerTable(metadata), new Paragraph({ text: "", spacing: { after: 120 } })];
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun({ text: `${i + 1}. ${task.title}`, bold: true }), new TextRun({ text: `   (${task.maxPoints} P)`, bold: true })],
      spacing: { before: 180, after: 100 },
    }));
    children.push(...questionParagraphs(task.questionText));
    const img = await imageParagraph(task.imageUrl);
    if (img) children.push(img);
    children.push(new Paragraph({ text: "", spacing: { after: 220 } }));
  }
  const total = tasks.reduce((s, t) => s + t.maxPoints, 0);
  children.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Gesamt: ${total} Punkte`, bold: true })] }));

  return Packer.toBuffer(new Document({ sections: [{ properties: {}, children }] }));
}

async function createExpectation(tasks: TaskItem[], metadata: TestMetadata) {
  const rows: TableRow[] = [new TableRow({ tableHeader: true, children: [
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Aufgabe", bold: true })] })] }),
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Erwartung", bold: true })] })] }),
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "AFB", bold: true })] })] }),
    new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "P", bold: true })] })] }),
  ]})];

  tasks.forEach((task, index) => {
    const afb = task.afbRaw || Object.entries(task.pointsByAfb).map(([k, v]) => `${k}: ${v}`).join(" · ");
    rows.push(new TableRow({ children: [
      new TableCell({ children: [new Paragraph(`${index + 1}. ${task.title}`)] }),
      new TableCell({ children: mathParagraphs(task.expectation || "–") }),
      new TableCell({ children: [new Paragraph(afb || "–")] }),
      new TableCell({ children: [new Paragraph(task.pointsRaw || String(task.maxPoints))] }),
    ]}));
  });

  const total = tasks.reduce((s, t) => s + t.maxPoints, 0);
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `Erwartungshorizont – ${metadata.title || "Mathematik-Test"}`, bold: true })] }),
    new Paragraph(`Klasse ${metadata.classLevel || ""} · ${metadata.topic || ""}`),
    new Paragraph({ text: "", spacing: { after: 100 } }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows, borders: {
      top: { style: BorderStyle.SINGLE, size: 1 }, bottom: { style: BorderStyle.SINGLE, size: 1 },
      left: { style: BorderStyle.SINGLE, size: 1 }, right: { style: BorderStyle.SINGLE, size: 1 },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 1 }, insideVertical: { style: BorderStyle.SINGLE, size: 1 },
    }}),
    new Paragraph({ spacing: { before: 260, after: 120 }, children: [new TextRun({ text: `Gesamtpunktzahl: ${total}`, bold: true })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, text: "Notenpunkte-Tabelle" }),
    gradeTable(total),
  ]}] });
  return Packer.toBuffer(doc);
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
    const safe = (payload.metadata.title || "Mathematik-Test").replace(/[\\/:*?"<>|]+/g, "-");
    zip.file(`${safe}.docx`, test);
    zip.file(`${safe}-Erwartungshorizont.docx`, expectation);
    const out = await zip.generateAsync({ type: "uint8array" });

    return new NextResponse(out, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(safe)}.zip"`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

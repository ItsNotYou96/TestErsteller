import type { DocumentBlock, DocumentSource } from "./documentBlocks";

export type SegmentationMode = "deterministic" | "llm";

export interface TaskBlockGroup {
  startBlockId: string;
  endBlockId: string;
  blocks: DocumentBlock[];
  confidence: number;
  mode: SegmentationMode;
  titleHint?: string;
}

export interface SegmentationResult {
  groups: TaskBlockGroup[];
  warnings: string[];
}

type OrdinalCandidate = { blockIndex: number; number: number; strength: number; source: "list" | "aufgabe" | "plain" | "colon" };

function normalizeCircled(value: string) {
  const chars = "①②③④⑤⑥⑦⑧⑨⑩";
  return value.replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, (c) => `${chars.indexOf(c) + 1}.`);
}

function ordinalCandidate(block: DocumentBlock, blockIndex: number): OrdinalCandidate | undefined {
  if (block.kind !== "paragraph") return undefined;
  if ((block.listLevel ?? -1) === 0 && Number.isInteger(block.listIndex) && (block.listIndex || 0) > 0 && (block.listIndex || 0) <= 99) {
    return { blockIndex, number: block.listIndex!, strength: 4, source: "list" };
  }
  const value = normalizeCircled(block.text).trim();
  const explicit = value.match(/^Aufgabe\s*(\d{1,2})\b/i);
  if (explicit) return { blockIndex, number: Number(explicit[1]), strength: 3, source: "aufgabe" };
  const plain = value.match(/^(\d{1,2})\s*([.):])\s*(?=\S)/);
  const parenthetical = value.match(/^(\d{1,2})\s+(?=\()/);
  if (!plain && !parenthetical) return undefined;
  const number = Number((plain || parenthetical)![1]);
  if (number <= 0 || number > 99) return undefined;
  if (parenthetical && !plain) return { blockIndex, number, strength: 2, source: "plain" };
  const punctuation = plain![2];
  return { blockIndex, number, strength: punctuation === ":" ? 1 : 2, source: punctuation === ":" ? "colon" : "plain" };
}

function bestConsecutiveChain(blocks: DocumentBlock[]) {
  const all = blocks.map(ordinalCandidate).filter((x): x is OrdinalCandidate => Boolean(x));
  const listCandidates = all.filter((x) => x.source === "list");
  const candidates = listCandidates.length >= 2 ? listCandidates : all;
  if (candidates.length < 2) return { chain: [] as OrdinalCandidate[], confidence: 0 };

  type State = { score: number; length: number; prev: number };
  const states: State[] = candidates.map((candidate) => ({ score: 10 + candidate.strength, length: 1, prev: -1 }));
  for (let j = 0; j < candidates.length; j++) {
    for (let i = 0; i < j; i++) {
      if (candidates[i].number + 1 !== candidates[j].number) continue;
      // Prefer strong structural markers and modest jumps, but do not assume a fixed task length.
      const gapPenalty = Math.min(2.5, Math.max(0, candidates[j].blockIndex - candidates[i].blockIndex - 25) / 40);
      const score = states[i].score + 10 + candidates[j].strength - gapPenalty;
      if (score > states[j].score) states[j] = { score, length: states[i].length + 1, prev: i };
    }
  }
  let best = 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i].length > states[best].length || (states[i].length === states[best].length && states[i].score > states[best].score)) best = i;
  }
  if (states[best].length < 2) return { chain: [] as OrdinalCandidate[], confidence: 0 };
  const chain: OrdinalCandidate[] = [];
  let cursor = best;
  while (cursor >= 0) {
    chain.push(candidates[cursor]);
    cursor = states[cursor].prev;
  }
  chain.reverse();
  const listRatio = chain.filter((x) => x.source === "list").length / chain.length;
  const weakRatio = chain.filter((x) => x.source === "colon").length / chain.length;
  let confidence = chain.length >= 4 ? 0.96 : chain.length === 3 ? 0.91 : 0.82;
  if (listRatio >= 0.8) confidence = Math.max(confidence, 0.99);
  if (weakRatio > 0.5) confidence -= 0.12;
  return { chain, confidence: Math.max(0, Math.min(1, confidence)) };
}

function boilerplateIds(blocks: DocumentBlock[]) {
  const occurrences = new Map<string, { ids: string[]; pages: Set<number> }>();
  for (const block of blocks) {
    if (block.kind !== "paragraph" || !block.page) continue;
    const key = block.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
    if (key.length < 8) continue;
    const row = occurrences.get(key) || { ids: [], pages: new Set<number>() };
    row.ids.push(block.id);
    row.pages.add(block.page);
    occurrences.set(key, row);
  }
  const ids = new Set<string>();
  for (const row of occurrences.values()) if (row.pages.size >= 2) row.ids.forEach((id) => ids.add(id));
  for (const block of blocks) {
    if (block.kind !== "paragraph") continue;
    if (/^https?:\/\//i.test(block.text) || /\bseite\s+\d+\s*\/\s*\d+\b/i.test(block.text) || /^angaben zu den urhebern/i.test(block.text)) ids.add(block.id);
  }
  return ids;
}

function groupsFromBoundaries(source: DocumentSource, boundaryIndexes: number[], confidence: number, mode: SegmentationMode, titleHints?: Map<string, string>) {
  const boilerplate = boilerplateIds(source.blocks);
  const groups: TaskBlockGroup[] = [];
  for (let i = 0; i < boundaryIndexes.length; i++) {
    const start = boundaryIndexes[i];
    const endExclusive = boundaryIndexes[i + 1] ?? source.blocks.length;
    let slice = source.blocks.slice(start, endExclusive);
    // Repeated page headers/footers are not task content. Keep page breaks so sourcePages remain correct.
    slice = slice.filter((block) => block.kind === "page-break" || !boilerplate.has(block.id));
    const substantive = slice.filter((b) => b.kind !== "page-break");
    if (!substantive.length) continue;
    groups.push({
      startBlockId: substantive[0].id,
      endBlockId: substantive[substantive.length - 1].id,
      blocks: slice,
      confidence,
      mode,
      titleHint: titleHints?.get(substantive[0].id),
    });
  }
  return groups;
}

function deterministicSegmentation(source: DocumentSource) {
  const { chain, confidence } = bestConsecutiveChain(source.blocks);
  if (!chain.length) return { groups: [] as TaskBlockGroup[], confidence: 0 };
  return { groups: groupsFromBoundaries(source, chain.map((x) => x.blockIndex), confidence, "deterministic"), confidence };
}

function structureModel() {
  return process.env.GROQ_STRUCTURE_MODEL?.trim() || "openai/gpt-oss-20b";
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

function blockPromptLine(block: DocumentBlock) {
  if (block.kind === "page-break") return `${block.id} | PAGE_BREAK | Seite ${block.page || "?"}`;
  if (block.kind === "image") return `${block.id} | IMAGE | ${block.text}`;
  const meta = [
    block.page ? `p${block.page}` : "",
    block.listLevel !== undefined ? `listLevel=${block.listLevel}` : "",
    block.listIndex !== undefined ? `listIndex=${block.listIndex}` : "",
    block.bold ? "bold" : "",
    block.style ? `style=${block.style}` : "",
  ].filter(Boolean).join(",");
  return `${block.id} | ${block.kind.toUpperCase()}${meta ? ` [${meta}]` : ""} | ${block.text.replace(/\s+/g, " ").slice(0, 700)}`;
}

const SEGMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          startBlockId: { type: "string" },
          endBlockId: { type: "string" },
          confidence: { type: "number" },
          titleHint: { type: "string" },
        },
        required: ["startBlockId", "endBlockId", "confidence", "titleHint"],
      },
    },
  },
  required: ["tasks"],
} as const;

async function groqSegmentChunk(blocks: DocumentBlock[], context: string) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY fehlt für die semantische Blockgruppierung.");
  const lines = blocks.map(blockPromptLine).join("\n");
  const prompt = `Du segmentierst ein deutsches Mathematikdokument in Aufgaben. Du darfst KEINEN Inhalt erzeugen oder umschreiben. Jeder Inhalt liegt bereits als unveränderlicher Block mit ID vor.

Deine einzige Aufgabe: Gib für jede VOLLSTÄNDIGE mathematische Aufgabe den ersten und letzten Block an. Überschriften, Kopfzeilen, Hinweise, Bewertungsfelder und Fußzeilen sind keine Aufgaben. Unteraufgaben, Rechenschritte, Tabellen und Bilder bleiben Bestandteil derselben Aufgabe. Nummern innerhalb einer Aufgabe (z. B. 1: Schritt, 2: Schritt) sind keine neuen Aufgaben, wenn sie semantisch zur Aufgabe gehören.

HARTE REGELN:
- Verwende ausschließlich Block-IDs aus der Liste.
- Keine erfundenen IDs.
- Bereiche dürfen sich nicht überlappen.
- startBlockId muss vor endBlockId liegen.
- titleHint ist nur eine kurze Beschreibung aus vorhandenem Wortlaut, keine neue Aufgabe.
- Wenn am Anfang/Ende des Ausschnitts nur ein unvollständiger Aufgabenteil sichtbar ist, lasse ihn weg.

${context}

BLÖCKE:
${lines}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: structureModel(),
        messages: [{ role: "user", content: prompt }],
        reasoning_effort: "low",
        reasoning_format: "hidden",
        response_format: { type: "json_schema", json_schema: { name: "task_block_ranges", strict: true, schema: SEGMENT_SCHEMA } },
        max_completion_tokens: 800,
      }),
      cache: "no-store",
    });
    if (response.ok) {
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") throw new Error("Groq-Strukturanalyse hat keine Ausgabe geliefert.");
      return JSON.parse(raw) as { tasks: Array<{ startBlockId: string; endBlockId: string; confidence: number; titleHint: string }> };
    }
    const body = await response.text();
    if (response.status === 429 && attempt < 3) { await sleep((retrySeconds(response) + 0.5) * 1000); continue; }
    throw new Error(`Groq-Strukturanalyse fehlgeschlagen (${response.status}): ${body}`);
  }
  throw new Error("Groq-Strukturanalyse konnte nach mehreren Versuchen nicht ausgeführt werden.");
}

function promptChunks(blocks: DocumentBlock[]) {
  const chunks: DocumentBlock[][] = [];
  let current: DocumentBlock[] = [];
  let chars = 0;
  for (const block of blocks) {
    const cost = blockPromptLine(block).length + 1;
    if (current.length && chars + cost > 12000) {
      chunks.push(current);
      current = current.slice(-5); // overlap protects tasks crossing a chunk boundary
      chars = current.reduce((sum, b) => sum + blockPromptLine(b).length + 1, 0);
    }
    current.push(block);
    chars += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function validateLlmRanges(source: DocumentSource, ranges: Array<{ startBlockId: string; endBlockId: string; confidence: number; titleHint: string }>) {
  const indexById = new Map(source.blocks.map((b, i) => [b.id, i]));
  const valid = ranges.map((range) => {
    const start = indexById.get(range.startBlockId);
    const end = indexById.get(range.endBlockId);
    if (start === undefined || end === undefined || start > end) return undefined;
    const substantive = source.blocks.slice(start, end + 1).filter((b) => b.kind !== "page-break");
    if (!substantive.length) return undefined;
    return { ...range, start, end, confidence: Math.max(0, Math.min(1, Number(range.confidence) || 0.5)) };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((a, b) => a.start - b.start);
  const deduped: typeof valid = [];
  for (const range of valid) {
    const prev = deduped[deduped.length - 1];
    if (prev && range.start <= prev.end) {
      // Same range returned because of chunk overlap: keep the stronger one. Genuine overlapping task
      // ranges are invalid and therefore not accepted as separate tasks.
      const sameStart = range.start === prev.start;
      const overlap = Math.min(range.end, prev.end) - Math.max(range.start, prev.start) + 1;
      const smaller = Math.min(range.end - range.start + 1, prev.end - prev.start + 1);
      if (sameStart || overlap / Math.max(1, smaller) >= 0.7) {
        if (range.confidence > prev.confidence) deduped[deduped.length - 1] = range;
      }
      continue;
    }
    deduped.push(range);
  }
  return deduped;
}

async function llmSegmentation(source: DocumentSource) {
  const allRanges: Array<{ startBlockId: string; endBlockId: string; confidence: number; titleHint: string }> = [];
  const chunks = promptChunks(source.blocks);
  for (let i = 0; i < chunks.length; i++) {
    const result = await groqSegmentChunk(chunks[i], `Datei: ${source.name}. Ausschnitt ${i + 1} von ${chunks.length}.`);
    allRanges.push(...result.tasks);
  }
  const ranges = validateLlmRanges(source, allRanges);
  if (!ranges.length) return [] as TaskBlockGroup[];
  const indexById = new Map(source.blocks.map((b, i) => [b.id, i]));
  const titleHints = new Map(ranges.map((x) => [x.startBlockId, x.titleHint]));
  // Each LLM range is authoritative; unlike deterministic numbering, there can be deliberate gaps
  // for headings/instructions between tasks.
  const boilerplate = boilerplateIds(source.blocks);
  return ranges.map((range) => {
    const start = indexById.get(range.startBlockId)!;
    const end = indexById.get(range.endBlockId)!;
    const blocks = source.blocks.slice(start, end + 1).filter((b) => b.kind === "page-break" || !boilerplate.has(b.id));
    const substantive = blocks.filter((b) => b.kind !== "page-break");
    return {
      startBlockId: substantive[0]?.id || range.startBlockId,
      endBlockId: substantive[substantive.length - 1]?.id || range.endBlockId,
      blocks,
      confidence: range.confidence,
      mode: "llm" as const,
      titleHint: titleHints.get(range.startBlockId),
    };
  }).filter((g) => g.blocks.some((b) => b.kind !== "page-break"));
}

export async function segmentDocument(source: DocumentSource, allowLlm = true): Promise<SegmentationResult> {
  const deterministic = deterministicSegmentation(source);
  // High-confidence structural signals are preferable to spending tokens and are more reproducible.
  if (deterministic.groups.length >= 2 && deterministic.confidence >= 0.88) {
    return { groups: deterministic.groups, warnings: [] };
  }

  if (allowLlm && process.env.GROQ_API_KEY?.trim()) {
    try {
      const groups = await llmSegmentation(source);
      if (groups.length) return { groups, warnings: deterministic.groups.length ? ["Die Dokumentstruktur war nicht eindeutig; die Aufgaben wurden anhand unveränderlicher Dokumentblöcke semantisch gruppiert."] : [] };
    } catch (error) {
      if (deterministic.groups.length) return { groups: deterministic.groups, warnings: [`Semantische Blockgruppierung nicht verfügbar; deterministische Struktur verwendet. ${error instanceof Error ? error.message : String(error)}`] };
      return { groups: [], warnings: [`Aufgabenstruktur konnte nicht sicher bestimmt werden. ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  if (deterministic.groups.length) return { groups: deterministic.groups, warnings: ["Die Aufgabenstruktur ist nur mittel sicher erkannt. Bitte die Aufgaben im Prüfschritt besonders kontrollieren."] };
  return { groups: [], warnings: ["Es wurden keine verlässlichen Aufgabengrenzen gefunden. Mit aktivierter KI kann die Blockstruktur semantisch gruppiert werden, ohne neuen Aufgabentext zu erzeugen."] };
}

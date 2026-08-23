import type { ImportDraft, DuplicateCandidate } from "./adminTypes";
import { loadTasks } from "./notion";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";

const STOPWORDS = new Set([
  "aufgabe", "aufgaben", "berechne", "bestimme", "ermittle", "gib", "zeichne", "skizziere", "ordne", "löse", "loese",
  "vereinfache", "folgende", "folgenden", "möglich", "moeglich", "wenn", "dabei", "nutze", "notiere", "begründe", "begrunde",
  "eine", "einer", "einen", "einem", "eines", "die", "der", "das", "den", "dem", "des", "und", "oder", "mit", "von", "für",
  "fuer", "zur", "zum", "im", "in", "an", "auf", "aus", "ist", "sind", "wird", "werden", "kann", "soll", "alle", "jeweils",
]);

function canonical(text: string) {
  return (text || "").normalize("NFKC").toLowerCase()
    .replace(/[−–—]/g, "-").replace(/[·⋅×]/g, "*").replace(/÷/g, "/")
    .replace(/\\cdot|\\times/g, "*").replace(/\\div/g, "/").replace(/\\left|\\right/g, "")
    .replace(/\s+/g, " ").trim();
}

function stem(word: string) {
  let w = word.toLowerCase();
  if (w.length > 7) w = w.replace(/(?:ungen|ung|keiten|keit|lichen|liche|lich)$/i, "");
  if (w.length > 6) w = w.replace(/(?:enden|ende|ern|en|es|em)$/i, "");
  if (w.length > 5) w = w.replace(/(?:er|e|n|s)$/i, "");
  return w;
}

function semanticNormalize(text: string) {
  return canonical(text)
    .replace(/dr(?:ü|ue)cke[^.!?\n]{0,90}?mit (?:einem )?term aus/g, " term_bilden ")
    .replace(/(?:stelle|stell)[^.!?\n]{0,80}?(?:als|durch|einen passenden) (?:einen )?term (?:dar|auf)?/g, " term_bilden ")
    .replace(/formuliere[^.!?\n]{0,60}?term/g, " term_bilden ")
    .replace(/fasse[^.!?\n]{0,50}?zusammen/g, " term_vereinfachen ")
    .replace(/vereinfache[^.!?\n]{0,50}?term/g, " term_vereinfachen ")
    .replace(/löse[^.!?\n]{0,60}?gleichung/g, " gleichung_loesen ")
    .replace(/multipliziere|multiplizieren|malnehmen/g, " mult ")
    .replace(/dividiere|dividieren|teile durch/g, " div ")
    .replace(/subtrahiere|subtrahieren/g, " sub ")
    .replace(/addiere|addieren/g, " add ")
    .replace(/summe aus/g, " summe ").replace(/differenz aus/g, " differenz ")
    .replace(/produkt aus/g, " produkt ").replace(/quotient(?:en)? aus/g, " quotient ")
    .replace(/gleichung(?:en)?/g, " gleichung ").replace(/terme?/g, " term ")
    .replace(/\s+/g, " ").trim();
}

function proseTokens(text: string) {
  return semanticNormalize(text).replace(/\\[a-z]+/g, " ").replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
    .replace(/[=+*/:^_<>-]/g, " ").replace(/[^a-zäöüß_]+/gi, " ").split(/\s+/).map(stem)
    .filter((x) => x.length >= 3 && !STOPWORDS.has(x));
}

function mathTokens(text: string) {
  const value = canonical(text).replace(/\\frac/g, " frac ").replace(/\\sqrt/g, " sqrt ");
  return Array.from(value.matchAll(/(?:[-+]?\d+(?:[.,]\d+)?)|(?:\b[a-z]\b)|(?:frac|sqrt)|(?:<=|>=|!=|=|\+|-|\*|\/|\^|<|>)/gi)).map((m) => m[0].replace(",", "."));
}

function setJaccard(a: string[], b: string[]) {
  const aa = new Set(a), bb = new Set(b);
  if (!aa.size && !bb.size) return 1;
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const x of aa) if (bb.has(x)) common++;
  return common / (aa.size + bb.size - common);
}

function trigrams(value: string) {
  const text = `  ${canonical(value)}  `;
  const out: string[] = [];
  for (let i = 0; i < text.length - 2; i++) out.push(text.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string) {
  const aa = trigrams(a), bb = trigrams(b);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  aa.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
  let common = 0;
  for (const x of bb) { const n = counts.get(x) || 0; if (n) { common++; counts.set(x, n - 1); } }
  return 2 * common / (aa.length + bb.length);
}

function subtaskCount(value: string) {
  return new Set(Array.from(value.matchAll(/(?:^|\n|\s)\*?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase())).size;
}

export function similarity(a: string, b: string, titleA = "", titleB = "") {
  const ca = canonical(a), cb = canonical(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;
  const prose = setJaccard(proseTokens(a), proseTokens(b));
  const mathA = mathTokens(a), mathB = mathTokens(b);
  const math = mathA.length && mathB.length ? setJaccard(mathA, mathB) : 0.35;
  const chars = dice(a, b);
  const title = titleA || titleB ? 0.6 * setJaccard(proseTokens(titleA), proseTokens(titleB)) + 0.4 * dice(titleA, titleB) : 0.35;
  let score = 0.46 * prose + 0.24 * math + 0.18 * chars + 0.12 * title;
  if (prose >= 0.72) score = Math.max(score, 0.62 + 0.22 * prose);
  if (prose >= 0.88) score = Math.max(score, 0.78 + 0.14 * math);
  const partsA = subtaskCount(a), partsB = subtaskCount(b);
  if (partsA && partsB && Math.abs(partsA - partsB) >= 2) score *= 0.88;
  const ratio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
  if (ratio < 0.35) score *= 0.72; else if (ratio < 0.55) score *= 0.86;
  return Math.max(0, Math.min(1, score));
}

async function allTasksForClass(classLevel: string, cache: Map<string, Awaited<ReturnType<typeof loadTasks>>>) {
  const out: Awaited<ReturnType<typeof loadTasks>> = [];
  const topics = LEGACY_TOPICS_BY_CLASS[classLevel] || [];
  // Load topics sequentially. Each topic already queries six competency databases; firing every
  // topic in parallel creates a large Notion burst and made the old similarity check appear flaky.
  for (const topic of topics) {
    const key = `${classLevel}::${topic}`;
    if (!cache.has(key)) {
      try { cache.set(key, await loadTasks(classLevel, topic)); }
      catch { cache.set(key, []); }
    }
  }
  for (const topic of topics) out.push(...(cache.get(`${classLevel}::${topic}`) || []));
  return out;
}

function localCandidates(draft: ImportDraft, tasks: Awaited<ReturnType<typeof loadTasks>>) {
  return tasks.map((task) => ({
    id: task.id,
    title: task.title,
    questionText: task.questionText,
    classLevel: draft.classLevel,
    topic: task.topic,
    competence: task.competence,
    localScore: similarity(draft.questionText, task.questionText, draft.title, task.title),
    score: similarity(draft.questionText, task.questionText, draft.title, task.title),
  } as DuplicateCandidate)).sort((a, b) => (b.localScore || 0) - (a.localScore || 0)).slice(0, 14);
}

const RERANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          candidateId: { type: "string" },
          relation: { type: "string", enum: ["near_duplicate", "same_skill", "related", "not_related"] },
          score: { type: "number" },
          reason: { type: "string" },
        },
        required: ["candidateId", "relation", "score", "reason"],
      },
    },
  },
  required: ["matches"],
} as const;

async function rerankWithGroq(draft: ImportDraft, candidates: DuplicateCandidate[]) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || !candidates.length) return candidates;
  const prompt = `Vergleiche EINE neue Mathematikaufgabe mit bestehenden Aufgaben. Entscheide didaktisch, ob es praktisch dieselbe Aufgabe/Variante ist, nur dieselbe mathematische Fertigkeit prüft, lediglich thematisch verwandt ist oder nicht verwandt ist.

Bewerte NICHT nach identischen Zahlen allein. Andere Zahlen bei ansonsten gleicher Handlung/Struktur können eine near_duplicate-Variante sein. Gleicher Themenbegriff ohne gleiche Aufgabenhandlung reicht nicht. Gib für jeden Kandidaten eine score zwischen 0 und 1 und eine sehr kurze Begründung. Verwende ausschließlich die gelieferten candidateId-Werte.

NEUE AUFGABE:
Titel: ${draft.title}
${draft.questionText.slice(0, 2600)}

KANDIDATEN:
${candidates.map((c, i) => `#${i + 1} candidateId=${c.id}\nTitel: ${c.title}\nThema: ${c.topic}; Kompetenz: ${c.competence}\n${c.questionText.slice(0, 1000)}`).join("\n\n")}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_DUPLICATE_MODEL?.trim() || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: { type: "json_schema", json_schema: { name: "duplicate_rerank", strict: true, schema: RERANK_SCHEMA } },
      max_completion_tokens: 1200,
    }),
    cache: "no-store",
  });
  if (!response.ok) return candidates;
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") return candidates;
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch { return candidates; }
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const match of parsed.matches || []) {
    const candidate = byId.get(String(match.candidateId));
    if (!candidate) continue;
    candidate.relation = match.relation;
    candidate.reason = String(match.reason || "").slice(0, 240);
    const modelScore = Math.max(0, Math.min(1, Number(match.score) || 0));
    // The semantic model is the final judge, while the local score still guards against an
    // isolated overconfident answer.
    candidate.score = Math.max(0, Math.min(1, 0.82 * modelScore + 0.18 * (candidate.localScore || 0)));
  }
  return candidates.sort((a, b) => b.score - a.score);
}

export async function addDuplicateCandidates(drafts: ImportDraft[], options: { llmRerank?: boolean } = {}) {
  const cache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();
  const classCache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();
  for (const draft of drafts) {
    if (!draft.classLevel) continue;
    if (!classCache.has(draft.classLevel)) classCache.set(draft.classLevel, await allTasksForClass(draft.classLevel, cache));
    let candidates = localCandidates(draft, classCache.get(draft.classLevel) || []);
    draft.duplicatePool = candidates.slice(0, 12);
    if (options.llmRerank && process.env.GROQ_API_KEY?.trim()) candidates = await rerankWithGroq(draft, candidates);
    const visible = candidates.filter((candidate) => candidate.score >= (candidate.relation ? 0.45 : 0.42)).slice(0, 5);
    draft.duplicates = visible;
    draft.duplicate = visible[0];
    if (draft.duplicate?.relation === "near_duplicate" && draft.duplicate.score >= 0.97) draft.include = false;
    else if (!draft.duplicate?.relation && (draft.duplicate?.score || 0) >= 0.98) draft.include = false;
  }
  return drafts;
}

export async function rerankDuplicateCandidates(draft: ImportDraft) {
  const existing = (draft.duplicatePool?.length ? draft.duplicatePool : draft.duplicates || []).map((candidate) => ({ ...candidate }));
  if (!existing.length) return draft;
  const candidates = process.env.GROQ_API_KEY?.trim() ? await rerankWithGroq(draft, existing) : existing;
  const visible = candidates.filter((candidate) => candidate.score >= (candidate.relation ? 0.45 : 0.42)).slice(0, 5);
  draft.duplicatePool = candidates.slice(0, 12);
  draft.duplicates = visible;
  draft.duplicate = visible[0];
  if (draft.duplicate?.relation === "near_duplicate" && draft.duplicate.score >= 0.97) draft.include = false;
  return draft;
}

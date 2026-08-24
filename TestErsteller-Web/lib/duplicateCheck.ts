import { LOCAL_RELEVANCE_THRESHOLD, type ImportDraft, type DuplicateCandidate } from "./adminTypes";
import { loadTasks } from "./notion";
import { LEGACY_TOPICS_BY_CLASS } from "./wpfDatabaseMap";

const STOPWORDS = new Set([
  "aufgabe", "aufgaben", "berechne", "bestimme", "ermittle", "gib", "zeichne", "skizziere", "ordne", "löse", "loese",
  "vereinfache", "folgende", "folgenden", "möglich", "moeglich", "wenn", "dabei", "nutze", "notiere", "begründe", "begrunde",
  "eine", "einer", "einen", "einem", "eines", "die", "der", "das", "den", "dem", "des", "und", "oder", "mit", "von", "für",
  "fuer", "zur", "zum", "im", "in", "an", "auf", "aus", "ist", "sind", "wird", "werden", "kann", "soll", "alle", "jeweils",
]);

// Duplicate analysis is intentionally two-stage: cheap local retrieval over the whole class,
// then Groq only for genuinely ambiguous/suspicious candidates. This keeps the Free Tier usable
// even when many documents are imported in one session.
// The local score is only a retrieval score. It must favor recall, not pretend to be a
// semantic similarity percentage. Groq is the semantic judge for plausible candidates.
const LOCAL_GROQ_TRIGGER = 0.38;
const LOCAL_CONFIDENT_DUPLICATE = 0.98;
const RERANK_CANDIDATE_FLOOR = 0.30;
const MAX_RERANK_CANDIDATES = 3;
const MAX_LOCAL_POOL = 16;

export type DuplicateRateLimitInfo = {
  retryAfterSeconds?: number;
  remainingTokens?: number;
  resetTokens?: string;
};

export class DuplicateRerankError extends Error {
  status: number;
  rateLimit: DuplicateRateLimitInfo;
  constructor(message: string, status: number, rateLimit: DuplicateRateLimitInfo = {}) {
    super(message);
    this.name = "DuplicateRerankError";
    this.status = status;
    this.rateLimit = rateLimit;
  }
}

function duplicateRateLimitInfo(response: Response): DuplicateRateLimitInfo {
  const retry = Number(response.headers.get("retry-after") || "");
  const remaining = Number(response.headers.get("x-ratelimit-remaining-tokens") || "");
  return {
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    remainingTokens: Number.isFinite(remaining) ? remaining : undefined,
    resetTokens: response.headers.get("x-ratelimit-reset-tokens") || undefined,
  };
}

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
  // Subtask labels such as "a)" and "b)" are document structure, not mathematical
  // variables. Treating them as math tokens made unrelated multi-part tasks look
  // artificially similar simply because both happened to contain a) and b).
  const value = canonical(text)
    .replace(/(?:^|\s)\*?[a-z]\)\s*/gim, " ")
    .replace(/\\frac/g, " frac ")
    .replace(/\\sqrt/g, " sqrt ");
  return Array.from(value.matchAll(/(?:[-+]?\d+(?:[.,]\d+)?)|(?:frac|sqrt)|(?:<=|>=|!=|=|\+|-|\*|\/|\^|<|>)|(?<!\p{L})[a-z](?!\p{L})/giu)).map((m) => m[0].replace(",", "."));
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



type DidacticFingerprint = { concepts: string[]; actions: string[]; };
type TaskFamily =
  | "verbal_term_translation"
  | "context_term_modeling"
  | "term_simplification"
  | "equation_solving"
  | "context_equation_modeling"
  | "statement_reasoning"
  | "geometry_calculation"
  | "data_analysis"
  | "function_graph"
  | "generic";
type RepresentationMode = "abstract" | "verbal_math" | "contextual" | "graphical";
type TaskProfile = DidacticFingerprint & {
  family: TaskFamily;
  mode: RepresentationMode;
  outputs: string[];
  confidence: number;
};

const CONCEPT_PATTERNS: Array<[string, RegExp]> = [
  ["square", /\bquadrat(?:e|en|s)?\b/i],
  ["rectangle", /\brechteck(?:e|en|s)?\b/i],
  ["triangle", /\bdreieck(?:e|en|s)?\b/i],
  ["circle", /\bkreis(?:e|en|es)?\b/i],
  ["perimeter", /\bumfang(?:s)?\b/i],
  ["area", /\bflächeninhalt|\bflaecheninhalt|\bfläche(?:n)?\b|\bflaeche(?:n)?\b/i],
  ["volume", /\bvolumen\b|\brauminhalt\b/i],
  ["surface", /\boberfläche(?:n)?\b|\boberflaeche(?:n)?\b/i],
  ["equation", /\bgleichung(?:en)?\b|[a-z]\s*=\s*[-+]?\d/iu],
  ["term", /\bterm(?:e|en|s)?\b/i],
  ["linear_system", /\bgleichungssystem(?:e|en|s)?\b|\blgs\b/i],
  ["fraction", /\bbruch|\bbrüche|\bbrueche|\bzähler|\bzaehler|\bnenner|\\frac\b/i],
  ["negative_numbers", /\bnegative[nrsm]?\s+zahl|\bminuszahl|\bvorzeichen\b/i],
  ["rational_numbers", /\brationale[nrsm]?\s+zahl|\bgrundmenge\b.*\b[QZNR]\b/i],
  ["percentage", /\bprozent|%|\bprozentsatz|\bgrundwert|\bprozentwert/i],
  ["interest", /\bzins(?:en|satz)?|\bkapital\b/i],
  ["proportionality", /\bproportional|\bantiproportional|\bzuordnung/i],
  ["linear_function", /\blineare[nrsm]?\s+funktion|\bsteigung|\by-?achsenabschnitt/i],
  ["quadratic_function", /\bquadratische[nrsm]?\s+funktion|\bparabel|\bscheitelpunkt/i],
  ["exponential_function", /\bexponential(?:funktion|es|e)?|\bwachstumsfaktor/i],
  ["coordinate_system", /\bkoordinatensystem|\bkoordinate(?:n)?|\bx-achse|\by-achse/i],
  ["statistics", /\bmittelwert|\bmedian|\bquartil|\bboxplot|\bhäufigkeit|\bhaeufigkeit|\bspannweite/i],
  ["probability", /\bwahrscheinlichkeit|\bzufall|\bereignis|\bbaumdiagramm/i],
  ["diagram", /\bdiagramm|\bsäulendiagramm|\bsaeulendiagramm|\bbalkendiagramm/i],
  ["pythagoras", /\bpythagoras|\bhypotenuse|\bkathete/i],
  ["power", /\bpotenz|\bexponent|\bhochzahl/i],
  ["root", /\bwurzel|√|\\sqrt/i],
  ["unit", /\beinheit(?:en)?|\bumrechnen|\bmm\b|\bcm\b|\bdm\b|\bkm\b|\bkg\b|\bg\b/i],
];

const ACTION_PATTERNS: Array<[string, RegExp]> = [
  ["solve_equation", /\blöse|\bloese|\blösen|\bloesen|\bnach\s+[a-z]\s+auf/i],
  ["simplify", /\bvereinfache|\bfasse.*zusammen|\bklammern?\s+auf|\bmultipliziere\s+aus/i],
  ["form_term", /\b(?:stelle|stell|gib).*\bterm\b.*(?:auf|an)?|\bdrücke.*\bterm\b.*aus|\bdruecke.*\bterm\b.*aus|\bformuliere.*\bterm\b/i],
  ["form_equation", /\b(?:stelle|stell|gib).*\bgleichung\b.*(?:auf|an)?|\bformuliere.*\bgleichung\b/i],
  ["calculate", /\bberechne|\brechne|\bermittle|\bbestimme/i],
  ["justify", /\bbegründe|\bbegrunde|\bbegründen|\bbegrunden|\bweise.*nach|\bbeweis/i],
  ["check_statement", /\büberprüfe|\bueberpruefe|\bprüfe|\bpruefe.*(?:richtig|wahr)|\baussage.*richtig/i],
  ["compare", /\bvergleiche|\bordne|\bgrößer|\bgroesser|\bkleiner|\breihenfolge/i],
  ["draw", /\bzeichne|\bskizziere|\bkonstruiere|\btrage.*ein/i],
  ["interpret", /\binterpretiere|\bdeute|\bbeschreibe.*(?:diagramm|graph|verlauf)/i],
  ["read_off", /\blies.*ab|\bentnimm.*(?:diagramm|graph|tabelle)/i],
  ["convert", /\bwandle.*um|\brechne.*(?:einheit|cm|m|km|g|kg).*um/i],
];

const VERBAL_MATH_RX = /\b(summe|differenz|produkt|quotient)\s+aus\b|\b(?:doppelte|dreifache|vierfache|fünffache|fuenffache|sechsfache|versechsfache|vielfache)\b|\b(?:addiere|subtrahiere|multipliziere|dividiere)\b/i;
const CONTEXT_RX = /(?:€|\beuro\b|\bcent\b|\bkg\b|\bgramm\b|\bg\b|\bcm\b|\bm²\b|\bm2\b|\bkm\b|\bliter\b|\bjahre?\b|\bmonate?\b|\bstunden?\b|\bminuten?\b|\bpreis\b|\bkosten\b|\bkostet\b|\bgewicht\b|\bverkauf\w*\b|\bkauf\w*\b|\btaschengeld\b|\banzahl\b|\bstück\b|\bstueck\b|\bschalen?\b|\bpackung\b|\btore?\b|\balter\b|\bstrecke\b|\bgeschwindigkeit\b|\bfläche(?:n)?\b|\bflaeche(?:n)?\b|\bumfang\b)/i;
const GRAPHICAL_RX = /\bdiagramm|\bgraph|\bkoordinatensystem|\btabelle|\bzeichnung|\bskizze/i;

function didacticFingerprint(text: string, title = ""): DidacticFingerprint {
  const value = canonical(`${title} ${text}`);
  const concepts = CONCEPT_PATTERNS.filter(([, rx]) => rx.test(value)).map(([name]) => name);
  const actions = ACTION_PATTERNS.filter(([, rx]) => rx.test(value)).map(([name]) => name);
  return { concepts, actions };
}

function taskProfile(text: string, title = ""): TaskProfile {
  const value = canonical(`${title} ${text}`);
  const fp = didacticFingerprint(text, title);
  const contextual = CONTEXT_RX.test(value);
  const verbalMath = VERBAL_MATH_RX.test(value);
  const graphical = GRAPHICAL_RX.test(value);
  const asksTerm = fp.actions.includes("form_term");
  const asksEquation = fp.actions.includes("form_equation");
  const solvesEquation = fp.actions.includes("solve_equation");
  const simplifies = fp.actions.includes("simplify");
  const reasons = fp.actions.includes("justify") || fp.actions.includes("check_statement");
  const geometry = fp.concepts.some((c) => ["square", "rectangle", "triangle", "circle", "perimeter", "area", "volume", "surface", "pythagoras"].includes(c));
  const data = fp.concepts.some((c) => ["statistics", "probability", "diagram"].includes(c));
  const fn = fp.concepts.some((c) => ["linear_function", "quadratic_function", "exponential_function", "coordinate_system"].includes(c));

  let family: TaskFamily = "generic";
  let confidence = 0.45;
  if (asksTerm && verbalMath && !contextual) { family = "verbal_term_translation"; confidence = 0.95; }
  else if (asksTerm && contextual) { family = "context_term_modeling"; confidence = 0.94; }
  else if (simplifies) { family = "term_simplification"; confidence = 0.92; }
  else if (solvesEquation && !contextual) { family = "equation_solving"; confidence = 0.94; }
  else if ((asksEquation || solvesEquation || /\bgleichung\b/.test(value)) && contextual) { family = "context_equation_modeling"; confidence = 0.90; }
  else if (reasons) { family = "statement_reasoning"; confidence = 0.90; }
  else if (geometry && fp.actions.includes("calculate")) { family = "geometry_calculation"; confidence = 0.88; }
  else if (data) { family = "data_analysis"; confidence = 0.82; }
  else if (fn && graphical) { family = "function_graph"; confidence = 0.82; }

  let mode: RepresentationMode = "abstract";
  if (graphical) mode = "graphical";
  else if (contextual) mode = "contextual";
  else if (verbalMath) mode = "verbal_math";

  const outputs: string[] = [];
  if (asksTerm) outputs.push("term");
  if (asksEquation || solvesEquation) outputs.push("equation");
  if (fp.actions.includes("calculate")) outputs.push("number");
  if (reasons) outputs.push("reasoning");
  if (fp.actions.includes("draw")) outputs.push("drawing");
  return { ...fp, family, mode, outputs, confidence };
}

function fingerprintSimilarity(a: DidacticFingerprint, b: DidacticFingerprint) {
  const concept = setJaccard(a.concepts, b.concepts);
  const action = setJaccard(a.actions, b.actions);
  if (concept <= 0) return action > 0 ? 0.08 * action : 0;
  return Math.min(1, 0.72 * concept + 0.28 * action);
}

function profileCompatibility(a: TaskProfile, b: TaskProfile) {
  const sameFamily = a.family !== "generic" && a.family === b.family;
  const strongMismatch = a.family !== "generic" && b.family !== "generic" && a.family !== b.family;
  const modeMismatch = a.mode !== b.mode && a.mode !== "abstract" && b.mode !== "abstract";
  const outputOverlap = setJaccard(a.outputs, b.outputs);
  const conceptOverlap = setJaccard(a.concepts, b.concepts);
  const actionOverlap = setJaccard(a.actions, b.actions);

  if (sameFamily) return { factor: 1, boost: 0.46, compatible: true };

  // These pairs share surface vocabulary but represent different didactic tasks. They must not
  // enter the expensive semantic duplicate queue merely because both ultimately produce a term
  // or equation.
  const modelingVsAbstract = new Set([a.family, b.family]);
  if (modelingVsAbstract.has("verbal_term_translation") && modelingVsAbstract.has("context_term_modeling")) {
    return { factor: 0.28, boost: 0, compatible: false };
  }
  if (modelingVsAbstract.has("equation_solving") && modelingVsAbstract.has("context_equation_modeling")) {
    return { factor: 0.32, boost: 0, compatible: false };
  }
  if (strongMismatch && modeMismatch) return { factor: 0.30, boost: 0, compatible: false };
  if (strongMismatch && actionOverlap === 0) return { factor: 0.35, boost: 0, compatible: false };
  if (a.family !== "generic" && b.family !== "generic" && conceptOverlap === 0) return { factor: 0.42, boost: 0, compatible: false };
  if (modeMismatch && outputOverlap === 0) return { factor: 0.55, boost: 0, compatible: false };
  return { factor: 1, boost: 0, compatible: true };
}

export function retrievalSimilarity(a: string, b: string, titleA = "", titleB = "") {
  const lexical = similarity(a, b, titleA, titleB);
  const pa = taskProfile(a, titleA), pb = taskProfile(b, titleB);
  const fp = fingerprintSimilarity(pa, pb);
  const compat = profileCompatibility(pa, pb);
  let score = Math.max(lexical, 0.72 * fp + 0.28 * lexical);
  if (pa.family === pb.family && pa.family !== "generic") {
    // Same didactic family rescues differently worded variants without opening the Groq gate for
    // every vaguely related task in the same topic.
    score = Math.max(score, compat.boost + 0.28 * lexical + 0.18 * fp);
  } else {
    score *= compat.factor;
  }
  return Math.max(0, Math.min(1, score));
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
    localScore: retrievalSimilarity(draft.questionText, task.questionText, draft.title, task.title),
    score: retrievalSimilarity(draft.questionText, task.questionText, draft.title, task.title),
  } as DuplicateCandidate)).sort((a, b) => (b.localScore || 0) - (a.localScore || 0)).slice(0, MAX_LOCAL_POOL);
}


function localComparisonNote(candidates: DuplicateCandidate[], pendingSemantic = false) {
  const best = [...candidates].sort((a, b) => (b.localScore || b.score || 0) - (a.localScore || a.score || 0))[0];
  if (!best) return pendingSemantic
    ? "Lokale Vorauswahl abgeschlossen; semantische Prüfung ausstehend."
    : "Vollständig lokal geprüft; keine bestehenden Vergleichsaufgaben gefunden.";
  const raw = best.localScore ?? best.score ?? 0;
  const score = Math.round(raw * 100);
  if (raw < LOCAL_RELEVANCE_THRESHOLD) {
    return pendingSemantic
      ? `Lokale Kandidatensuche abgeschlossen. Bester Suchwert: ${score} %. Semantische Prüfung ausstehend.`
      : `Vollständig lokal geprüft; kein relevanter ähnlicher Treffer gefunden. Höchster lokaler Suchwert: ${score} %.`;
  }
  const target = `„${best.title}“ · ${best.topic} · ${best.competence} (Suchwert ${score} %)`;
  return pendingSemantic
    ? `Lokale Vorauswahl: relevanter Kandidat ${target}. Semantische Prüfung ausstehend.`
    : `Vollständig lokal geprüft. Relevanter lokaler Vergleich: ${target}.`;
}

function rerankSelection(candidates: DuplicateCandidate[]) {
  const sorted = [...candidates].sort((a, b) => (b.localScore || 0) - (a.localScore || 0));
  const best = sorted[0]?.localScore || 0;

  // Near-identical local matches do not need an LLM to tell us that they are near duplicates.
  // This is both cheaper and more deterministic.
  if (best >= LOCAL_CONFIDENT_DUPLICATE) {
    const first = sorted[0];
    first.relation = "near_duplicate";
    first.score = Math.max(first.score, best);
    first.reason ||= "Nahezu identischer Wortlaut bzw. mathematische Struktur (lokaler Vergleich).";
    return { shouldCallGroq: false, candidates: [] as DuplicateCandidate[] };
  }

  // The local value is retrieval only. Even a 20-30 % lexical hit can be a strong semantic
  // variant, so the gate is intentionally permissive. Only truly implausible pools skip Groq.
  if (best < LOCAL_GROQ_TRIGGER) return { shouldCallGroq: false, candidates: [] as DuplicateCandidate[] };

  const selected = sorted
    .filter((candidate) => (candidate.localScore || 0) >= RERANK_CANDIDATE_FLOOR)
    .slice(0, MAX_RERANK_CANDIDATES);
  return { shouldCallGroq: selected.length > 0, candidates: selected };
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
  if (!apiKey || !candidates.length) return { candidates, usedGroq: false };
  const selection = rerankSelection(candidates);
  if (!selection.shouldCallGroq) return { candidates: candidates.sort((a, b) => b.score - a.score), usedGroq: false };
  const rerankCandidates = selection.candidates;
  const prompt = `Vergleiche EINE neue Mathematikaufgabe mit bestehenden Aufgaben. Die lokale Stufe hat nur Kandidaten gesucht; DU bist die eigentliche semantische Ähnlichkeitsbewertung.

Bewerte streng auf DUPLIKATÄHNLICHKEIT, nicht bloß auf dasselbe Thema.

Prüfe in dieser Reihenfolge:
1. Gleicher Aufgabentyp / gleiche didaktische Funktion?
2. Gleiche geforderte Schülerhandlung?
3. Gleiche Repräsentation: rein symbolisch/sprachlich, Sachsituation/Modellierung oder grafisch?
4. Im Wesentlichen derselbe Lösungsweg bzw. dieselbe mathematische Struktur?
5. Vergleichbare Teilaufgabenstruktur?

HARTE REGELN:
- „Einen Term aus einer mathematisch formulierten Aussage bilden“ ist NICHT derselbe Aufgabentyp wie „eine Sachsituation durch einen Term modellieren“. Auch wenn beide einen Term als Ergebnis haben: höchstens related, normalerweise not_related.
- „Eine vorgegebene Gleichung lösen“ ist NICHT derselbe Aufgabentyp wie „aus einer Sachsituation erst eine Gleichung aufstellen und lösen“.
- Gemeinsame Wörter wie Term, Gleichung, berechne oder gleiche a)/b)-Struktur reichen niemals für same_skill.
- near_duplicate nur, wenn Aufgaben durch Austausch von Zahlen/Namen/kleinen Kontextdetails praktisch als Varianten derselben Vorlage gelten könnten.
- same_skill nur, wenn ein Lehrer beide Aufgaben als austauschbare Übungsvarianten für genau dieselbe Teilkompetenz einsetzen könnte.

Kalibriere score streng: near_duplicate 0.88-1.00; same_skill 0.72-0.87; related 0.40-0.69; not_related 0.00-0.39. Gib für jeden Kandidaten eine kurze fachliche Begründung. Verwende ausschließlich die gelieferten candidateId-Werte.

NEUE AUFGABE:
Titel: ${draft.title}
${draft.questionText.slice(0, 1800)}

KANDIDATEN:
${rerankCandidates.map((c, i) => `#${i + 1} candidateId=${c.id}\nTitel: ${c.title}\nThema: ${c.topic}; Kompetenz: ${c.competence}\n${c.questionText.slice(0, 650)}`).join("\n\n")}`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_DUPLICATE_MODEL?.trim() || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: { type: "json_schema", json_schema: { name: "duplicate_rerank", strict: true, schema: RERANK_SCHEMA } },
      max_completion_tokens: 380,
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new DuplicateRerankError(
      `Groq-Ähnlichkeitsanalyse fehlgeschlagen (${response.status}): ${body}`,
      response.status,
      duplicateRateLimitInfo(response),
    );
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new DuplicateRerankError("Groq-Ähnlichkeitsanalyse hat keine JSON-Ausgabe geliefert.", 502, duplicateRateLimitInfo(response));
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { throw new DuplicateRerankError("Groq-Ähnlichkeitsanalyse hat ungültiges JSON geliefert.", 502, duplicateRateLimitInfo(response)); }
  const byId = new Map(rerankCandidates.map((c) => [c.id, c]));
  for (const match of parsed.matches || []) {
    const candidate = byId.get(String(match.candidateId));
    if (!candidate) continue;
    candidate.relation = match.relation;
    candidate.reason = String(match.reason || "").slice(0, 240);
    const rawModelScore = Math.max(0, Math.min(1, Number(match.score) || 0));
    // Keep score and relation internally consistent even if the model gives a borderline number.
    const relationRange: Record<string, [number, number]> = {
      near_duplicate: [0.88, 1],
      same_skill: [0.72, 0.87],
      related: [0.40, 0.69],
      not_related: [0, 0.39],
    };
    const [minScore, maxScore] = relationRange[String(match.relation)] || [0, 1];
    const modelScore = Math.max(minScore, Math.min(maxScore, rawModelScore));
    // The semantic model is the final judge. The local value is only a retrieval score and must
    // not drag down a genuinely similar task that happens to use different wording.
    candidate.score = modelScore;
  }
  return { candidates: candidates.sort((a, b) => b.score - a.score), usedGroq: true };
}

function visibleCandidates(candidates: DuplicateCandidate[], usedGroq: boolean) {
  // Once Groq has judged the shortlist, only semantically judged candidates may be shown as
  // similarity results. Unreranked retrieval candidates are kept in duplicatePool for diagnostics
  // but must not masquerade as semantic matches.
  return candidates
    .filter((candidate) => usedGroq ? (candidate.relation === "near_duplicate" || candidate.relation === "same_skill") && candidate.score >= 0.72 : candidate.score >= 0.52)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export async function addDuplicateCandidates(drafts: ImportDraft[], options: { llmRerank?: boolean } = {}) {
  const cache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();
  const classCache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();
  for (const draft of drafts) {
    if (!draft.classLevel) continue;
    if (!classCache.has(draft.classLevel)) classCache.set(draft.classLevel, await allTasksForClass(draft.classLevel, cache));
    let candidates = localCandidates(draft, classCache.get(draft.classLevel) || []);
    draft.duplicatePool = candidates.slice(0, MAX_LOCAL_POOL);
    const localSelection = rerankSelection(candidates);
    draft.duplicateNeedsRerank = localSelection.shouldCallGroq;
    draft.duplicateCheckStatus = localSelection.shouldCallGroq ? "pending" : "local";
    draft.duplicateCheckNote = localComparisonNote(candidates, localSelection.shouldCallGroq);
    if (options.llmRerank && process.env.GROQ_API_KEY?.trim()) {
      const reranked = await rerankWithGroq(draft, candidates);
      candidates = reranked.candidates;
      draft.duplicateCheckStatus = reranked.usedGroq ? "groq" : "local";
      draft.duplicateNeedsRerank = false;
      draft.duplicateCheckNote = reranked.usedGroq
        ? "Lokale Vorauswahl und semantische Groq-Prüfung abgeschlossen."
        : localComparisonNote(candidates, false);
    }
    const visible = visibleCandidates(candidates, draft.duplicateCheckStatus === "groq");
    draft.duplicates = visible;
    draft.duplicate = visible[0];
    if (draft.duplicate?.relation === "near_duplicate" && draft.duplicate.score >= 0.97) draft.include = false;
    else if (!draft.duplicate?.relation && (draft.duplicate?.score || 0) >= 0.98) draft.include = false;
  }
  return drafts;
}

export async function rerankDuplicateCandidates(draft: ImportDraft) {
  const existing = (draft.duplicatePool?.length ? draft.duplicatePool : draft.duplicates || []).map((candidate) => ({ ...candidate }));
  if (!existing.length) {
    draft.duplicateNeedsRerank = false;
    draft.duplicateCheckStatus = "local";
    draft.duplicateCheckNote = localComparisonNote([], false);
    return draft;
  }
  const reranked = process.env.GROQ_API_KEY?.trim()
    ? await rerankWithGroq(draft, existing)
    : { candidates: existing, usedGroq: false };
  const candidates = reranked.candidates;
  const visible = visibleCandidates(candidates, reranked.usedGroq);
  draft.duplicatePool = candidates.slice(0, MAX_LOCAL_POOL);
  draft.duplicates = visible;
  draft.duplicate = visible[0];
  draft.duplicateNeedsRerank = false;
  draft.duplicateCheckStatus = reranked.usedGroq ? "groq" : "local";
  draft.duplicateCheckNote = reranked.usedGroq
    ? "Lokale Vorauswahl und semantische Groq-Prüfung abgeschlossen."
    : localComparisonNote(candidates, false);
  if (draft.duplicate?.relation === "near_duplicate" && draft.duplicate.score >= 0.97) draft.include = false;
  return draft;
}

const BATCH_RERANK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          draftId: { type: "string" },
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
        required: ["draftId", "matches"],
      },
    },
  },
  required: ["results"],
} as const;

function clampSemanticScore(relation: string, rawScore: unknown) {
  const relationRange: Record<string, [number, number]> = {
    near_duplicate: [0.88, 1],
    same_skill: [0.72, 0.87],
    related: [0.40, 0.69],
    not_related: [0, 0.39],
  };
  const [minScore, maxScore] = relationRange[relation] || [0, 1];
  const raw = Math.max(0, Math.min(1, Number(rawScore) || 0));
  return Math.max(minScore, Math.min(maxScore, raw));
}

/**
 * Reranks up to four ambiguous tasks in one Groq request. The repeated semantic instructions are
 * therefore paid once per batch instead of once per task. Only the top two locally compatible
 * candidates per task are sent to the model.
 */
export async function rerankDuplicateCandidatesBatch(inputDrafts: ImportDraft[]) {
  const drafts = inputDrafts.slice(0, 4).map((draft) => ({ ...draft }));
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || !drafts.length) return drafts.map((draft) => ({ ...draft, duplicateNeedsRerank: false, duplicateCheckStatus: "local" as const }));

  const prepared = drafts.map((draft) => {
    const existing = (draft.duplicatePool?.length ? draft.duplicatePool : draft.duplicates || []).map((candidate) => ({ ...candidate }));
    const selection = rerankSelection(existing);
    return { draft, existing, selection, selected: selection.candidates.slice(0, 2) };
  });

  const active = prepared.filter((item) => item.selection.shouldCallGroq && item.selected.length);
  if (!active.length) {
    return prepared.map(({ draft, existing }) => {
      const visible = visibleCandidates(existing, false);
      return {
        ...draft,
        duplicatePool: existing.slice(0, MAX_LOCAL_POOL),
        duplicates: visible,
        duplicate: visible[0],
        duplicateNeedsRerank: false,
        duplicateCheckStatus: "local" as const,
        duplicateCheckNote: localComparisonNote(existing, false),
      };
    });
  }

  const prompt = `Prüfe mehrere Mathematikaufgaben auf DUPLIKATÄHNLICHKEIT. Die lokale Stufe hat bereits unpassende Datenbankaufgaben verworfen. Bewerte NICHT bloß Themenverwandtschaft.

Für jeden neuen Task gelten streng diese Kriterien:
1. gleicher Aufgabentyp / gleiche didaktische Funktion,
2. gleiche geforderte Schülerhandlung,
3. gleiche Repräsentation (symbolisch/sprachlich vs. Sachsituation/Modellierung vs. grafisch),
4. im Wesentlichen derselbe Lösungsweg bzw. dieselbe mathematische Struktur,
5. vergleichbare Teilaufgabenstruktur.

Harte Regeln:
- Mathematische Aussagen in einen Term übersetzen != Sachsituation durch einen Term modellieren.
- Vorgegebene Gleichung lösen != aus einer Sachsituation eine Gleichung aufstellen und lösen.
- Gemeinsame Wörter wie Term, Gleichung, berechne oder gleiche a)/b)-Struktur reichen nie für same_skill.
- near_duplicate: praktisch dieselbe Vorlage mit anderen Zahlen/Namen/kleinen Kontextdetails.
- same_skill: als Übungsvarianten für genau dieselbe Teilkompetenz austauschbar.
- related: nur fachlich verwandt; dies ist KEIN Ähnlichkeitstreffer.

Scores: near_duplicate 0.88-1.00; same_skill 0.72-0.87; related 0.40-0.69; not_related 0.00-0.39.
Verwende ausschließlich die gelieferten draftId- und candidateId-Werte.

${active.map(({ draft, selected }, taskIndex) => `TASK ${taskIndex + 1} draftId=${draft.id}\nNEU: ${draft.title}\n${draft.questionText.slice(0, 700)}\nKANDIDATEN:\n${selected.map((candidate, i) => `${i + 1}. candidateId=${candidate.id}\n${candidate.title} · ${candidate.topic} · ${candidate.competence}\n${candidate.questionText.slice(0, 350)}`).join("\n")}`).join("\n\n---\n\n")}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_DUPLICATE_MODEL?.trim() || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: { type: "json_schema", json_schema: { name: "duplicate_batch_rerank", strict: true, schema: BATCH_RERANK_SCHEMA } },
      max_completion_tokens: 520,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new DuplicateRerankError(
      `Groq-Ähnlichkeitsanalyse fehlgeschlagen (${response.status}): ${body}`,
      response.status,
      duplicateRateLimitInfo(response),
    );
  }
  const data = await response.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new DuplicateRerankError("Groq-Ähnlichkeitsanalyse hat keine JSON-Ausgabe geliefert.", 502, duplicateRateLimitInfo(response));
  let parsed: any;
  try { parsed = JSON.parse(raw); }
  catch { throw new DuplicateRerankError("Groq-Ähnlichkeitsanalyse hat ungültiges JSON geliefert.", 502, duplicateRateLimitInfo(response)); }

  const resultsByDraft = new Map<string, any>((parsed.results || []).map((result: any) => [String(result.draftId), result]));
  for (const { draft, selected } of active) {
    const result = resultsByDraft.get(draft.id);
    if (!result) throw new DuplicateRerankError(`Groq hat für Aufgabe ${draft.id} kein Vergleichsergebnis geliefert.`, 502);
    const returnedIds = new Set((result.matches || []).map((match: any) => String(match.candidateId)));
    const missing = selected.filter((candidate) => !returnedIds.has(candidate.id));
    if (missing.length) throw new DuplicateRerankError(`Groq hat nicht alle Vergleichskandidaten für Aufgabe ${draft.id} bewertet.`, 502);
  }
  return prepared.map(({ draft, existing, selection, selected }) => {
    if (!selection.shouldCallGroq || !selected.length) {
      const visible = visibleCandidates(existing, false);
      return {
        ...draft,
        duplicatePool: existing.slice(0, MAX_LOCAL_POOL),
        duplicates: visible,
        duplicate: visible[0],
        duplicateNeedsRerank: false,
        duplicateCheckStatus: "local" as const,
        duplicateCheckNote: localComparisonNote(existing, false),
      };
    }

    const result = resultsByDraft.get(draft.id);
    const byId = new Map(selected.map((candidate) => [candidate.id, candidate]));
    for (const match of result?.matches || []) {
      const candidate = byId.get(String(match.candidateId));
      if (!candidate) continue;
      candidate.relation = match.relation;
      candidate.reason = String(match.reason || "").slice(0, 240);
      candidate.score = clampSemanticScore(String(match.relation), match.score);
    }
    const sorted = existing.sort((a, b) => b.score - a.score);
    const visible = visibleCandidates(sorted, true);
    const duplicate = visible[0];
    return {
      ...draft,
      duplicatePool: sorted.slice(0, MAX_LOCAL_POOL),
      duplicates: visible,
      duplicate,
      duplicateNeedsRerank: false,
      duplicateCheckStatus: "groq" as const,
      duplicateCheckNote: "Lokale Vorauswahl und semantische Groq-Prüfung abgeschlossen.",
      include: duplicate?.relation === "near_duplicate" && duplicate.score >= 0.97 ? false : draft.include,
    };
  });
}

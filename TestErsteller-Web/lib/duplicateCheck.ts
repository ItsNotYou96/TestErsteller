import type { ImportDraft, DuplicateCandidate } from "./adminTypes";
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
// v4.4 keeps the stable text retrieval from v3.7 but adds a deterministic mathematical
// structure layer: constants are abstracted, equation shapes are compared, and explicit
// learning goals such as "solve linear equation + determine solution set" can establish a
// strong local match without spending Groq tokens. Weak candidates remain visible from 18%.
const LOCAL_GROQ_TRIGGER = 0.34;
const LOCAL_CONFIDENT_DUPLICATE = 0.96;
const RERANK_CANDIDATE_FLOOR = 0.18;
const MAX_RERANK_CANDIDATES = 3;
const MAX_LOCAL_POOL = 12;
const LOCAL_DISPLAY_THRESHOLD = 0.18;

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

function subtaskCount(value: string) {
  return new Set(Array.from(value.matchAll(/(?:^|\n|\s)\*?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase())).size;
}

type MathFingerprint = {
  goals: string[];
  actions: string[];
  representations: string[];
  equationShapes: string[];
  equationOperators: string[];
  equationCount: number;
  subtasks: number;
};

const GOAL_LABELS: Record<string, string> = {
  solve_linear_equation: "lineare Gleichungen lösen",
  solution_set: "Lösungsmenge bestimmen",
  domain_restriction: "Grundmenge berücksichtigen",
  verbal_to_term: "sprachliche Aussage in einen Term übersetzen",
  context_to_term: "Sachkontext durch einen Term modellieren",
  simplify_term: "Terme vereinfachen",
  explain_procedure: "mathematisches Verfahren erklären",
  verify_statement: "Aussagen prüfen und begründen",
  geometry_calculation: "geometrische Größen berechnen",
  context_equation: "Sachkontext mit einer Gleichung modellieren",
};

const ACTION_LABELS: Record<string, string> = {
  solve: "gleiche Schülerhandlung: lösen",
  determine_set: "gleiche Schülerhandlung: Lösungsmenge angeben",
  form_term: "gleiche Schülerhandlung: Term bilden",
  simplify: "gleiche Schülerhandlung: vereinfachen",
  explain: "gleiche Schülerhandlung: erklären",
  verify: "gleiche Schülerhandlung: prüfen/begründen",
  calculate: "gleiche Schülerhandlung: berechnen",
  model: "gleiche Schülerhandlung: modellieren",
};

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function hasContextSignals(value: string) {
  const text = canonical(value);
  return /\b(?:euro|€|jahre?|monat(?:e|lich)?|preis|kostet|gewicht|schalen?|obststand|tablet|taschengeld|tore?|fußball|fussball|mutter|vater|brüder|brueder|nadja|maria|j(?:ö|oe)rg|martin|oliver|packung|pralinen|verkauft|seitenlänge|seitenlaenge|umfang|flächeninhalt|flaecheninhalt)\b/.test(text)
    || /\bwie (?:viele|alt|teuer|lang|groß|gross)\b/.test(text);
}

function normalizeEquationShape(raw: string) {
  return canonical(raw)
    .replace(/g\s*=\s*(?:in|n|z|q|r|ℕ|ℤ|ℚ|ℝ)\b/gi, "")
    .replace(/\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g, "#/#")
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/(?<!\p{L})[a-z](?!\p{L})/giu, "V")
    .replace(/\p{L}{2,}/gu, "")
    .replace(/\s+/g, "")
    .replace(/#V/g, "#*V")
    .replace(/V#/g, "V*#");
}

function equationFragments(value: string) {
  const text = canonical(value)
    .replace(/(?:^|\s)\*?[a-z]\)\s*/gim, " | ")
    .replace(/[;\n]+/g, " | ");
  return text.split("|")
    .map((part) => part.trim())
    .filter((part) => part.includes("=") && !/^g\s*=\s*(?:in|n|z|q|r|ℕ|ℤ|ℚ|ℝ)\b/i.test(part))
    .map((part) => {
      const eqIndex = part.indexOf("=");
      // Keep only a compact mathematical neighbourhood. This avoids prose before an equation
      // from dominating the structural signature while preserving both sides of the equation.
      const left = part.slice(Math.max(0, eqIndex - 48), eqIndex);
      const right = part.slice(eqIndex + 1, eqIndex + 49);
      return `${left}=${right}`.trim();
    });
}

function mathFingerprint(value: string): MathFingerprint {
  const text = canonical(value);
  const context = hasContextSignals(text);
  const equations = equationFragments(text);
  const goals: string[] = [];
  const actions: string[] = [];
  const representations: string[] = [];

  const mentionsSolutionSet = /l(?:ö|oe)sungsmenge/.test(text);
  const mentionsDomain = /grundmenge/.test(text) || /\bg\s*=\s*(?:in|n|z|q|r|ℕ|ℤ|ℚ|ℝ)\b/i.test(text);
  const asksSolve = /(?:l(?:ö|oe)se|umformen?|forme[^.!?]{0,35}um)/.test(text) || mentionsSolutionSet;
  const linearEquations = equations.length > 0 && equations.every((eq) => !/\^\s*[2-9]|v\s*\*\s*v/i.test(normalizeEquationShape(eq)));

  if (asksSolve && linearEquations) { goals.push("solve_linear_equation"); actions.push("solve"); representations.push("symbolic"); }
  if (mentionsSolutionSet) { goals.push("solution_set"); actions.push("determine_set"); }
  if (mentionsDomain) goals.push("domain_restriction");

  const explains = /\b(?:erkl(?:ä|ae)re|beschreibe|mit eigenen worten)\b/.test(text);
  if (explains) { goals.push("explain_procedure"); actions.push("explain"); }

  const verifies = /\b(?:überprüfe|ueberpruefe|prüfe|pruefe)\b/.test(text) && /\b(?:aussage|richtig|richtigkeit|begr(?:ü|ue)nde)\b/.test(text);
  if (verifies) { goals.push("verify_statement"); actions.push("verify"); }

  const termBuild = /(?:dr(?:ü|ue)cke|formuliere|stelle|stell)[^.!?\n]{0,100}\bterm\b/.test(text) || /\bgib[^.!?\n]{0,80}\beinen term\b/.test(text);
  if (termBuild && context) { goals.push("context_to_term"); actions.push("form_term", "model"); representations.push("context"); }
  else if (termBuild) { goals.push("verbal_to_term"); actions.push("form_term"); representations.push("verbal"); }

  if (/\b(?:fasse|vereinfache)[^.!?\n]{0,60}(?:term|zusammen)/.test(text)) { goals.push("simplify_term"); actions.push("simplify"); representations.push("symbolic"); }

  if (context && (/(?:gleichung|gleichung:)/.test(text) || (equations.length > 0 && /\bwie\b/.test(text)))) {
    goals.push("context_equation"); actions.push("model", "solve"); representations.push("context");
  }

  if (/\b(?:quadrat|rechteck|dreieck|umfang|fl(?:ä|ae)cheninhalt|seitenl(?:ä|ae)nge)\b/.test(text) && /\b(?:berechne|bestimme|ermittle|wie (?:wächst|waechst))\b/.test(text)) {
    goals.push("geometry_calculation"); actions.push("calculate"); representations.push(context ? "context" : "symbolic");
  }

  if (context) representations.push("context");
  if (equations.length) representations.push("symbolic");

  const equationShapes = equations.map(normalizeEquationShape).filter(Boolean);
  const equationOperators = unique(equationShapes.flatMap((shape) => Array.from(shape.matchAll(/=|\+|-|\*|\/|\^|\(|\)/g)).map((m) => m[0])));

  return {
    goals: unique(goals),
    actions: unique(actions),
    representations: unique(representations),
    equationShapes,
    equationOperators,
    equationCount: equations.length,
    subtasks: subtaskCount(value),
  };
}

function averageBestDice(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  const scoreOneWay = (left: string[], right: string[]) => left.reduce((sum, item) => sum + Math.max(...right.map((other) => dice(item, other))), 0) / left.length;
  return (scoreOneWay(a, b) + scoreOneWay(b, a)) / 2;
}

function structuralComparison(a: string, b: string) {
  const fa = mathFingerprint(a), fb = mathFingerprint(b);
  const goalScore = setJaccard(fa.goals, fb.goals);
  const actionScore = setJaccard(fa.actions, fb.actions);
  const representationScore = setJaccard(fa.representations, fb.representations);
  const equationShapeScore = averageBestDice(fa.equationShapes, fb.equationShapes);
  const operatorScore = setJaccard(fa.equationOperators, fb.equationOperators);
  const equationCountScore = fa.equationCount && fb.equationCount
    ? Math.min(fa.equationCount, fb.equationCount) / Math.max(fa.equationCount, fb.equationCount)
    : fa.equationCount === fb.equationCount ? 1 : 0;
  const subtaskScore = fa.subtasks && fb.subtasks
    ? Math.min(fa.subtasks, fb.subtasks) / Math.max(fa.subtasks, fb.subtasks)
    : fa.subtasks === fb.subtasks ? 1 : 0.4;

  const aExplain = fa.actions.includes("explain");
  const bExplain = fb.actions.includes("explain");
  const incompatibleExplanation = aExplain !== bExplain;
  const verbalVsContextTerm = (fa.goals.includes("verbal_to_term") && fb.goals.includes("context_to_term"))
    || (fb.goals.includes("verbal_to_term") && fa.goals.includes("context_to_term"));

  let score = 0.38 * goalScore + 0.20 * actionScore + 0.17 * equationShapeScore + 0.10 * operatorScore + 0.07 * representationScore + 0.05 * equationCountScore + 0.03 * subtaskScore;

  // Two tasks that both explicitly ask to solve linear equations AND determine a solution set
  // are the same core exercise type even if one variant adds a domain restriction or uses
  // completely different constants. This is the key abstraction that token similarity misses.
  const sharedSolveSet = fa.goals.includes("solve_linear_equation") && fb.goals.includes("solve_linear_equation")
    && fa.goals.includes("solution_set") && fb.goals.includes("solution_set");
  if (sharedSolveSet) score = Math.max(score, 0.78);

  const strongGoalIntersection = fa.goals.filter((goal) => fb.goals.includes(goal) && goal !== "domain_restriction");
  if (strongGoalIntersection.length && actionScore >= 0.5) score = Math.max(score, 0.58 + 0.10 * Math.min(1, equationShapeScore + operatorScore / 2));

  if (incompatibleExplanation) score = Math.min(score, 0.16);
  if (verbalVsContextTerm) score = Math.min(score, 0.24);

  const signals: string[] = [];
  for (const goal of strongGoalIntersection.slice(0, 3)) signals.push(GOAL_LABELS[goal] || goal);
  for (const action of fa.actions.filter((item) => fb.actions.includes(item)).slice(0, 2)) signals.push(ACTION_LABELS[action] || action);
  if (equationShapeScore >= 0.55) signals.push("ähnliche algebraische Gleichungsstruktur");
  else if (fa.equationCount && fb.equationCount) signals.push("beide enthalten algebraische Gleichungen");
  if (sharedSolveSet && fa.goals.includes("domain_restriction") !== fb.goals.includes("domain_restriction")) signals.push("Grundmenge ist nur in einer Variante Zusatzanforderung");
  if (representationScore >= 0.65 && fa.representations.length && fb.representations.length) signals.push("gleiche Darstellungsform");

  const confidentSameSkill = !incompatibleExplanation && !verbalVsContextTerm && (
    sharedSolveSet
    || (score >= 0.76 && strongGoalIntersection.length > 0 && actionScore >= 0.65)
  );

  return { score: Math.max(0, Math.min(1, score)), signals: unique(signals), confidentSameSkill, fa, fb };
}

export function structuralSimilarity(a: string, b: string) {
  const result = structuralComparison(a, b);
  return { score: result.score, signals: result.signals, confidentSameSkill: result.confidentSameSkill };
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
  return tasks.map((task) => {
    const lexicalScore = similarity(draft.questionText, task.questionText, draft.title, task.title);
    const structural = structuralComparison(draft.questionText, task.questionText);
    // Retrieval is no longer a disguised text-similarity percentage. Mathematical structure may
    // dominate when constants and wording differ, while near-identical text is still preserved.
    let retrievalScore = Math.max(
      lexicalScore >= 0.75 ? lexicalScore * 0.92 : 0,
      0.42 * lexicalScore + 0.58 * structural.score,
      structural.score,
    );
    if (structural.confidentSameSkill) retrievalScore = Math.max(retrievalScore, 0.80);

    const candidate: DuplicateCandidate = {
      id: task.id,
      title: task.title,
      questionText: task.questionText,
      classLevel: draft.classLevel,
      topic: task.topic,
      competence: task.competence,
      localScore: lexicalScore,
      structuralScore: structural.score,
      retrievalScore,
      retrievalSignals: structural.signals,
      score: retrievalScore,
      confidentVariant: structural.confidentSameSkill,
    };

    if (structural.confidentSameSkill) {
      candidate.relation = lexicalScore >= 0.90 && structural.score >= 0.82 ? "near_duplicate" : "same_skill";
      candidate.reason = structural.signals.length
        ? `Lokale mathematische Strukturanalyse: ${structural.signals.join(" · ")}.`
        : "Lokale mathematische Strukturanalyse erkennt denselben konkreten Aufgabentyp.";
    }
    return candidate;
  }).sort((a, b) => (b.retrievalScore || 0) - (a.retrievalScore || 0)).slice(0, MAX_LOCAL_POOL);
}


function localComparisonNote(candidates: DuplicateCandidate[], pendingSemantic = false) {
  const best = [...candidates].sort((a, b) => (b.retrievalScore ?? b.localScore ?? b.score ?? 0) - (a.retrievalScore ?? a.localScore ?? a.score ?? 0))[0];
  if (!best) return pendingSemantic
    ? "Lokale Vorauswahl abgeschlossen; semantische Prüfung ausstehend."
    : "Vollständig lokal geprüft; keine bestehenden Vergleichsaufgaben gefunden.";
  const raw = best.retrievalScore ?? best.localScore ?? best.score ?? 0;
  if (raw < LOCAL_DISPLAY_THRESHOLD) {
    return "Vollständig lokal geprüft; kein relevanter lokaler Vergleichskandidat gefunden.";
  }
  const signals = best.retrievalSignals?.length ? ` Fachliche Gemeinsamkeiten: ${best.retrievalSignals.slice(0, 3).join(" · ")}.` : "";
  const target = `„${best.title}“ · ${best.topic} · ${best.competence}`;
  if (best.confidentVariant) return `Lokale mathematische Strukturanalyse erkennt ${target} als denselben konkreten Aufgabentyp.${signals}`;
  return pendingSemantic
    ? `Lokaler Vergleichskandidat: ${target}.${signals} Semantische Prüfung ausstehend.`
    : `Vollständig lokal geprüft. Vergleichskandidat: ${target}.${signals}`;
}

function rerankSelection(candidates: DuplicateCandidate[]) {
  const sorted = [...candidates].sort((a, b) => (b.retrievalScore ?? b.localScore ?? 0) - (a.retrievalScore ?? a.localScore ?? 0));
  const bestCandidate = sorted[0];
  const best = bestCandidate?.retrievalScore ?? bestCandidate?.localScore ?? 0;

  // A high-confidence structural match is intentionally resolved locally. This is the main
  // Free-Tier optimization in v4.4: the LLM is not needed merely to notice that two sets of
  // linear equations both ask for the solution set, even when all constants differ.
  if (bestCandidate?.confidentVariant && (bestCandidate.relation === "same_skill" || bestCandidate.relation === "near_duplicate")) {
    return { shouldCallGroq: false, candidates: [] as DuplicateCandidate[] };
  }

  if (best >= LOCAL_CONFIDENT_DUPLICATE && bestCandidate) {
    bestCandidate.relation = "near_duplicate";
    bestCandidate.score = Math.max(bestCandidate.score, best);
    bestCandidate.reason ||= "Nahezu identischer Wortlaut bzw. mathematische Struktur (lokaler Vergleich).";
    return { shouldCallGroq: false, candidates: [] as DuplicateCandidate[] };
  }

  // Weak candidates remain visible from 18% retrieval strength, but Groq is reserved for cases
  // where the local engine has enough evidence to justify spending tokens.
  if (best < LOCAL_GROQ_TRIGGER) return { shouldCallGroq: false, candidates: [] as DuplicateCandidate[] };

  const selected = sorted
    .filter((candidate) => (candidate.retrievalScore ?? candidate.localScore ?? 0) >= RERANK_CANDIDATE_FLOOR)
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
  const prompt = `Vergleiche EINE neue Mathematikaufgabe mit bestehenden Aufgaben. Entscheide didaktisch, ob es praktisch dieselbe Aufgabe/Variante ist, nur dieselbe mathematische Fertigkeit prüft, lediglich thematisch verwandt ist oder nicht verwandt ist.

Bewerte NICHT nach identischen Zahlen allein. Andere Zahlen bei ansonsten gleicher mathematischer Handlung und Struktur können eine near_duplicate-Variante sein. Ein gemeinsames Oberthema (z. B. „Gleichungen“ oder „Terme“) reicht ausdrücklich NICHT. Entscheidend sind die konkrete Schülerhandlung, der Lösungsweg und die Aufgabenstruktur. Eine Erklär-/Begründungsaufgabe ist nicht ähnlich zu einer Anwendungs-/Sachaufgabe nur weil beide dasselbe Thema betreffen. Es ist ausdrücklich erlaubt, ALLE Kandidaten als not_related zu markieren. Erzwinge keinen Treffer. Gib für jeden Kandidaten eine score zwischen 0 und 1 und eine sehr kurze Begründung. Verwende ausschließlich die gelieferten candidateId-Werte.

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
      max_completion_tokens: 600,
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
    const modelScore = Math.max(0, Math.min(1, Number(match.score) || 0));
    // The semantic model is the final judge, while the local score still guards against an
    // isolated overconfident answer.
    candidate.score = Math.max(0, Math.min(1, 0.82 * modelScore + 0.18 * (candidate.localScore || 0)));
  }
  return { candidates: candidates.sort((a, b) => b.score - a.score), usedGroq: true };
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
    const visible = candidates.filter((candidate) => candidate.score >= (candidate.relation ? 0.45 : LOCAL_DISPLAY_THRESHOLD)).slice(0, 5);
    draft.duplicates = visible;
    // Local retrieval candidates are suggestions only. Treat a task as a confirmed duplicate
    // only when the local engine is virtually certain or Groq has explicitly classified it.
    draft.duplicate = visible.find((candidate) => candidate.relation === "near_duplicate" || candidate.relation === "same_skill");
    if (draft.duplicate?.relation === "near_duplicate" && draft.duplicate.score >= 0.97) draft.include = false;
    else if (!draft.duplicate?.relation && (draft.duplicate?.score || 0) >= 0.98) draft.include = false;
  }
  return drafts;
}

export async function rerankDuplicateCandidates(draft: ImportDraft) {
  const [result] = await rerankDuplicateCandidatesBatch([draft]);
  return result || draft;
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

function groqVisibleCandidates(candidates: DuplicateCandidate[]) {
  // After semantic checking, never surface an unjudged local runner-up as an "Ähnlichkeit".
  // This was one source of confusing matches in later versions.
  return candidates
    .filter((candidate) => candidate.relation === "near_duplicate" || candidate.relation === "same_skill")
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/**
 * Batch version of the restored v3.7 semantic reranker. Up to four imported tasks share one
 * Groq prompt, but each task may still send the five best v3.7-style candidates. This keeps the
 * recall that worked well before v3.8 without returning to one request per task.
 */
export async function rerankDuplicateCandidatesBatch(inputDrafts: ImportDraft[]) {
  const drafts = inputDrafts.slice(0, 4).map((draft) => ({ ...draft }));
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || !drafts.length) {
    return drafts.map((draft) => ({ ...draft, duplicateNeedsRerank: false, duplicateCheckStatus: "local" as const }));
  }

  const prepared = drafts.map((draft) => {
    const existing = (draft.duplicatePool?.length ? draft.duplicatePool : draft.duplicates || []).map((candidate) => ({ ...candidate }));
    const selection = rerankSelection(existing);
    return { draft, existing, selection, selected: selection.candidates.slice(0, MAX_RERANK_CANDIDATES) };
  });

  const active = prepared.filter((item) => item.selection.shouldCallGroq && item.selected.length);
  if (!active.length) {
    return prepared.map(({ draft, existing }) => {
      const visible = existing.filter((candidate) => candidate.score >= LOCAL_DISPLAY_THRESHOLD).slice(0, 5);
      return {
        ...draft,
        duplicatePool: existing.slice(0, MAX_LOCAL_POOL),
        duplicates: visible,
        duplicate: visible.find((candidate) => candidate.relation === "near_duplicate" || candidate.relation === "same_skill"),
        duplicateNeedsRerank: false,
        duplicateCheckStatus: "local" as const,
        duplicateCheckNote: localComparisonNote(existing, false),
      };
    });
  }

  const instructions = `Vergleiche mehrere neue Mathematikaufgaben jeweils mit ihren bestehenden Kandidaten.\n\n` +
    `Klassifiziere jeden Kandidaten unabhängig als:\n` +
    `- near_duplicate: praktisch dieselbe Aufgabe/Variante; Zahlen oder Kontextdetails dürfen verändert sein, aber Schülerhandlung, mathematischer Lösungsweg und Struktur sind nahezu gleich.\n` +
    `- same_skill: gleicher konkreter Aufgabentyp und dieselbe mathematische Fertigkeit; als Übungsvarianten sinnvoll austauschbar.\n` +
    `- related: nur thematisch/fachlich verwandt, aber anderer Aufgabentyp oder andere Schülerhandlung.\n` +
    `- not_related: keine relevante Ähnlichkeit.\n\n` +
    `WICHTIG: Gleiche Oberbegriffe wie „Terme“, „Gleichungen“, „Flächen“ usw. reichen NICHT. Eine Erklär-/Begründungsaufgabe ist nicht ähnlich zu einer Sach-/Anwendungsaufgabe nur wegen desselben Themas. Eine Sachmodellierung ist nicht automatisch ähnlich zu einer rein algebraischen Aufgabe, nur weil beide am Ende einen Term oder eine Gleichung verwenden. Es ist ausdrücklich erlaubt, alle Kandidaten als not_related zu markieren. Erzwinge keinen Treffer. Die score ist nur intern für die Rangfolge: near_duplicate typischerweise 0.85–1, same_skill 0.65–0.84, related 0.30–0.64, not_related 0–0.29.`;

  const prompt = `${instructions}\n\nVerwende ausschließlich die gelieferten draftId- und candidateId-Werte.\n\n${active.map(({ draft, selected }, taskIndex) => `TASK ${taskIndex + 1} draftId=${draft.id}\nNEUE AUFGABE:\nTitel: ${draft.title}\n${draft.questionText.slice(0, 900)}\n\nKANDIDATEN:\n${selected.map((candidate, i) => `${i + 1}. candidateId=${candidate.id}\nTitel: ${candidate.title}\nThema: ${candidate.topic}; Kompetenz: ${candidate.competence}\n${candidate.questionText.slice(0, 420)}`).join("\n\n")}`).join("\n\n---\n\n")}`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_DUPLICATE_MODEL?.trim() || "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      reasoning_effort: "low",
      reasoning_format: "hidden",
      response_format: { type: "json_schema", json_schema: { name: "duplicate_batch_v37", strict: true, schema: BATCH_RERANK_SCHEMA } },
      max_completion_tokens: 700,
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
      const visible = existing.filter((candidate) => candidate.score >= LOCAL_DISPLAY_THRESHOLD).slice(0, 5);
      return {
        ...draft,
        duplicatePool: existing.slice(0, MAX_LOCAL_POOL),
        duplicates: visible,
        duplicate: visible.find((candidate) => candidate.relation === "near_duplicate" || candidate.relation === "same_skill"),
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
      candidate.reason = String(match.reason || "").slice(0, 260);
      const modelScore = Math.max(0, Math.min(1, Number(match.score) || 0));
      // Keep the successful v3.7 behavior: Groq is primary, but local evidence prevents an
      // isolated overconfident semantic result from completely dominating the rank.
      candidate.score = Math.max(0, Math.min(1, 0.82 * modelScore + 0.18 * (candidate.localScore || 0)));
    }
    const sorted = existing.sort((a, b) => b.score - a.score);
    const visible = groqVisibleCandidates(sorted);
    const duplicate = visible[0];
    return {
      ...draft,
      duplicatePool: sorted.slice(0, MAX_LOCAL_POOL),
      duplicates: visible,
      duplicate,
      duplicateNeedsRerank: false,
      duplicateCheckStatus: "groq" as const,
      duplicateCheckNote: visible.length
        ? "Lokale Vorauswahl nach dem bewährten v3.7-Verfahren und semantische Groq-Prüfung abgeschlossen."
        : "Semantisch geprüft; unter den lokalen Kandidaten wurde keine relevante ähnliche Aufgabe bestätigt.",
      include: duplicate?.relation === "near_duplicate" && duplicate.score >= 0.90 ? false : draft.include,
    };
  });
}

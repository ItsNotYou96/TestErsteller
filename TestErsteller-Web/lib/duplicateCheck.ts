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
const LOCAL_GROQ_TRIGGER = 0.16;
const LOCAL_CONFIDENT_DUPLICATE = 0.97;
const RERANK_CANDIDATE_FLOOR = 0.12;
const MAX_RERANK_CANDIDATES = 5;
const MAX_LOCAL_POOL = 20;

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
  ["form_model", /\bstelle.*(?:term|gleichung).*auf|\bdrücke.*term.*aus|\bdruecke.*term.*aus|\bformuliere.*term|\bgib.*term/i],
  ["calculate", /\bberechne|\brechne|\bermittle|\bbestimme/i],
  ["justify", /\bbegründe|\bbegrunde|\bbegründen|\bbegrunden|\bweise.*nach|\bbeweis/i],
  ["check_statement", /\büberprüfe|\bueberpruefe|\bprüfe|\bpruefe.*(?:richtig|wahr)|\baussage.*richtig/i],
  ["compare", /\bvergleiche|\bordne|\bgrößer|\bgroesser|\bkleiner|\breihenfolge/i],
  ["draw", /\bzeichne|\bskizziere|\bkonstruiere|\btrage.*ein/i],
  ["interpret", /\binterpretiere|\bdeute|\bbeschreibe.*(?:diagramm|graph|verlauf)/i],
  ["read_off", /\blies.*ab|\bentnimm.*(?:diagramm|graph|tabelle)/i],
  ["convert", /\bwandle.*um|\brechne.*(?:einheit|cm|m|km|g|kg).*um/i],
];

function didacticFingerprint(text: string, title = ""): DidacticFingerprint {
  const value = canonical(`${title} ${text}`);
  const concepts = CONCEPT_PATTERNS.filter(([, rx]) => rx.test(value)).map(([name]) => name);
  const actions = ACTION_PATTERNS.filter(([, rx]) => rx.test(value)).map(([name]) => name);
  return { concepts, actions };
}

function fingerprintSimilarity(a: DidacticFingerprint, b: DidacticFingerprint) {
  const concept = setJaccard(a.concepts, b.concepts);
  const action = setJaccard(a.actions, b.actions);
  // A shared command word alone (e.g. both say "berechne") is not enough.
  if (concept <= 0) return action > 0 ? 0.10 * action : 0;
  return Math.min(1, 0.74 * concept + 0.26 * action);
}

function retrievalSimilarity(a: string, b: string, titleA = "", titleB = "") {
  const lexical = similarity(a, b, titleA, titleB);
  const fp = fingerprintSimilarity(didacticFingerprint(a, titleA), didacticFingerprint(b, titleB));
  // Strong didactic overlap can rescue differently worded variants that lexical matching alone
  // used to rate around 20-30 %. Near copies are still found by the lexical score.
  return Math.max(lexical, 0.82 * fp + 0.18 * lexical);
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

Bewerte vorrangig nach diesen vier Punkten:
1. Welcher mathematische Gegenstand wird bearbeitet?
2. Welche Schülerhandlung wird verlangt (z. B. Term bilden, Gleichung lösen, begründen, Flächeninhalt berechnen)?
3. Ist der notwendige Lösungsweg/die mathematische Struktur im Wesentlichen gleich?
4. Ist die Teilaufgabenstruktur vergleichbar?

Andere Zahlen, Namen oder Sachkontexte dürfen bei gleicher mathematischer Struktur trotzdem eine near_duplicate-Variante sein. Umgekehrt reicht gleicher Wortlaut wie „berechne“ oder dass beide Aufgaben a)/b) besitzen NICHT aus. Gleicher Themenbegriff bei anderer mathematischer Handlung ist höchstens related.

Kalibriere score so: near_duplicate 0.85-1.00; same_skill 0.65-0.84; related 0.35-0.64; not_related 0.00-0.34. Gib für jeden Kandidaten eine sehr kurze fachliche Begründung. Verwende ausschließlich die gelieferten candidateId-Werte.

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
    const rawModelScore = Math.max(0, Math.min(1, Number(match.score) || 0));
    // Keep score and relation internally consistent even if the model gives a borderline number.
    const relationRange: Record<string, [number, number]> = {
      near_duplicate: [0.85, 1],
      same_skill: [0.65, 0.84],
      related: [0.35, 0.64],
      not_related: [0, 0.34],
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
    .filter((candidate) => usedGroq ? !!candidate.relation && candidate.relation !== "not_related" && candidate.score >= 0.45 : candidate.score >= 0.42)
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

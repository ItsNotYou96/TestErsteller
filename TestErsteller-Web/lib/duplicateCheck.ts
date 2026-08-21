import type { ImportDraft, DuplicateCandidate } from "./adminTypes";
import { loadTasks } from "./notion";

const STOPWORDS = new Set([
  "aufgabe", "aufgaben", "berechne", "bestimme", "ermittle", "gib", "zeichne", "skizziere", "ordne", "löse", "loese",
  "vereinfache", "folgende", "folgenden", "möglich", "moeglich", "wenn", "dabei", "nutze", "notiere", "begründe", "begrunde",
  "eine", "einer", "einen", "einem", "eines", "die", "der", "das", "den", "dem", "des", "und", "oder", "mit", "von", "für",
  "fuer", "zur", "zum", "im", "in", "an", "auf", "aus", "ist", "sind", "wird", "werden", "kann", "soll", "alle", "jeweils",
]);

function canonical(text: string) {
  return (text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[−–—]/g, "-")
    .replace(/[·⋅×]/g, "*")
    .replace(/÷/g, "/")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\div/g, "/")
    .replace(/\\left|\\right/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function literalTokens(text: string) {
  return canonical(text)
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, " $1 / $2 ")
    .replace(/\\sqrt\s*\{([^}]*)\}/g, " sqrt $1 ")
    .replace(/[^a-zäöüß0-9.,=+*/:^_<>-]+/gi, " ")
    .split(/\s+/)
    .filter((x) => x.length > 0);
}

function proseTokens(text: string) {
  return canonical(text)
    .replace(/\\[a-z]+/g, " ")
    .replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
    .replace(/[=+*/:^_<>-]/g, " ")
    .replace(/[^a-zäöüß]+/gi, " ")
    .split(/\s+/)
    .filter((x) => x.length >= 3 && !STOPWORDS.has(x));
}

function numberTokens(text: string) {
  return Array.from(canonical(text).matchAll(/(?<![a-zäöüß])[-+]?\d+(?:[.,]\d+)?/gi)).map((m) => m[0].replace(",", "."));
}

function mathTokens(text: string) {
  const value = canonical(text)
    .replace(/\\frac/g, " frac ")
    .replace(/\\sqrt/g, " sqrt ")
    .replace(/\\mathbb\{([^}]+)\}/g, " mathbb_$1 ");
  return Array.from(value.matchAll(/(?:[-+]?\d+(?:[.,]\d+)?)|(?:\b[a-z]\b)|(?:frac|sqrt|mathbb_[a-z])|(?:<=|>=|!=|=|\+|-|\*|\/|\^|<|>)/gi)).map((m) => m[0].replace(",", "."));
}

function setJaccard(a: string[], b: string[]) {
  const aa = new Set(a);
  const bb = new Set(b);
  if (!aa.size && !bb.size) return 1;
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

function trigrams(value: string) {
  const text = `  ${canonical(value).replace(/\s+/g, " ")}  `;
  const out: string[] = [];
  for (let i = 0; i < text.length - 2; i++) out.push(text.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string) {
  const aa = trigrams(a);
  const bb = trigrams(b);
  if (!aa.length || !bb.length) return 0;
  const counts = new Map<string, number>();
  aa.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
  let common = 0;
  for (const x of bb) {
    const n = counts.get(x) || 0;
    if (n > 0) { common++; counts.set(x, n - 1); }
  }
  return (2 * common) / (aa.length + bb.length);
}

function subtaskCount(value: string) {
  return new Set(Array.from(value.matchAll(/(?:^|\n)\s*\*?([a-z])\)\s*/gim)).map((m) => m[1].toLowerCase())).size;
}


function structuralText(text: string) {
  return canonical(text)
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string) {
  return 0.6 * setJaccard(proseTokens(a), proseTokens(b)) + 0.4 * dice(a, b);
}

export function similarity(a: string, b: string, titleA = "", titleB = "") {
  const ca = canonical(a);
  const cb = canonical(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const proseA = proseTokens(a);
  const proseB = proseTokens(b);
  const prose = !proseA.length && !proseB.length ? 0.4 : setJaccard(proseA, proseB);
  const literal = setJaccard(literalTokens(a), literalTokens(b));
  const chars = dice(a, b);
  const structure = dice(structuralText(a), structuralText(b));
  const mathA = mathTokens(a);
  const mathB = mathTokens(b);
  const math = mathA.length && mathB.length ? setJaccard(mathA, mathB) : 0.5;
  const numbersA = numberTokens(a);
  const numbersB = numberTokens(b);
  const numbers = numbersA.length && numbersB.length ? setJaccard(numbersA, numbersB) : 0.5;
  const title = titleA || titleB ? titleSimilarity(titleA, titleB) : 0.5;

  let score = 0.28 * prose + 0.22 * literal + 0.14 * chars + 0.10 * structure + 0.12 * math + 0.08 * title + 0.06 * numbers;

  // Same substantive wording with only changed values is exactly the kind of "very similar form"
  // the admin wants to see. Require several non-generic prose tokens so boilerplate like
  // "Berechne ..." alone cannot trigger this floor.
  if (proseA.length >= 3 && proseB.length >= 3 && prose >= 0.88 && structure >= 0.82) {
    score = Math.max(score, 0.78 + 0.08 * literal);
  }

  // Different numbers matter, but an otherwise almost identical wording is still a useful
  // "same task with changed values" warning. Penalize number mismatches mainly when the prose
  // itself is not strongly aligned.
  if (numbersA.length >= 2 && numbersB.length >= 2 && numbers < 0.25 && prose < 0.72) score *= 0.82;

  const partsA = subtaskCount(a);
  const partsB = subtaskCount(b);
  if (partsA && partsB && Math.abs(partsA - partsB) >= 2) score *= 0.86;

  const lengthRatio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
  if (lengthRatio < 0.55) score *= 0.82;

  // Very short generic instructions ("Berechne", "Löse ...") must not become duplicates merely
  // because their command words match.
  if (proseA.length <= 1 && proseB.length <= 1 && prose < 0.8 && literal < 0.75) score *= 0.72;

  return Math.max(0, Math.min(1, score));
}

export async function addDuplicateCandidates(drafts: ImportDraft[]) {
  const cache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();
  for (const draft of drafts) {
    if (!draft.classLevel || !draft.topic) continue;
    const key = `${draft.classLevel}::${draft.topic}`;
    if (!cache.has(key)) {
      try { cache.set(key, await loadTasks(draft.classLevel, draft.topic)); }
      catch { cache.set(key, []); }
    }

    let best: DuplicateCandidate | undefined;
    for (const task of cache.get(key) || []) {
      const score = similarity(draft.questionText, task.questionText, draft.title, task.title);
      if (!best || score > best.score) {
        best = {
          id: task.id,
          title: task.title,
          questionText: task.questionText,
          classLevel: draft.classLevel,
          topic: draft.topic,
          competence: task.competence,
          score,
        };
      }
    }

    // A candidate below 74 % is deliberately not shown. Auto-exclusion now requires 96 % instead
    // of 86 %, because only near-identical tasks should be blocked without an admin decision.
    if (best && best.score >= 0.74) {
      draft.duplicate = best;
      if (best.score >= 0.96) draft.include = false;
    } else {
      draft.duplicate = undefined;
    }
  }
  return drafts;
}

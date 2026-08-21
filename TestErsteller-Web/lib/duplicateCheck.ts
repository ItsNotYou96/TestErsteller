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

function semanticNormalize(text: string) {
  return canonical(text)
    .replace(/dr(?:ü|ue)cke[^.!?\n]{0,80}?mit (?:einem )?term aus/g, " term_bilden ")
    .replace(/(?:stelle|stell)[^.!?\n]{0,60}?(?:als|durch) (?:einen )?term (?:dar|auf)/g, " term_bilden ")
    .replace(/formuliere[^.!?\n]{0,50}?term/g, " term_bilden ")
    .replace(/verdopple|verdoppele|zweifache/g, " multipliziere 2 ")
    .replace(/verdreifache/g, " multipliziere 3 ")
    .replace(/vervierfache/g, " multipliziere 4 ")
    .replace(/verf(?:ü|ue)nffache/g, " multipliziere 5 ")
    .replace(/versechsfache/g, " multipliziere 6 ")
    .replace(/versiebenfache/g, " multipliziere 7 ")
    .replace(/verachtfache/g, " multipliziere 8 ")
    .replace(/verneunfache/g, " multipliziere 9 ")
    .replace(/verzehnfache/g, " multipliziere 10 ")
    .replace(/multipliziere|multiplizieren|malnehmen/g, " mult ")
    .replace(/dividiere|dividieren|teile durch/g, " div ")
    .replace(/subtrahiere|subtrahieren/g, " sub ")
    .replace(/addiere|addieren/g, " add ")
    .replace(/summe aus/g, " summe ")
    .replace(/differenz aus/g, " differenz ")
    .replace(/produkt aus/g, " produkt ")
    .replace(/quotient(?:en)? aus/g, " quotient ")
    .replace(/gleichung(?:en)?/g, " gleichung ")
    .replace(/terme?/g, " term ")
    .replace(/\s+/g, " ")
    .trim();
}

function stem(word: string) {
  let w = word.toLowerCase();
  if (w.length > 7) w = w.replace(/(?:ungen|ung|keiten|keit|lichen|liche|lich)$/i, "");
  if (w.length > 6) w = w.replace(/(?:enden|ende|ern|en|es|em)$/i, "");
  if (w.length > 5) w = w.replace(/(?:er|e|n|s)$/i, "");
  return w;
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
  return semanticNormalize(text)
    .replace(/\\[a-z]+/g, " ")
    .replace(/[0-9]+(?:[.,][0-9]+)?/g, " ")
    .replace(/[=+*/:^_<>-]/g, " ")
    .replace(/[^a-zäöüß_]+/gi, " ")
    .split(/\s+/)
    .map(stem)
    .filter((x) => x.length >= 3 && !STOPWORDS.has(x));
}

function semanticTokens(text: string) {
  return semanticNormalize(text)
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, " frac $1 $2 ")
    .replace(/\\sqrt\s*\{([^}]*)\}/g, " sqrt $1 ")
    .replace(/[^a-zäöüß0-9_]+/gi, " ")
    .split(/\s+/)
    .map(stem)
    .filter((x) => x.length >= 2 && !STOPWORDS.has(x));
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
  return semanticNormalize(text)
    .replace(/\d+(?:[.,]\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function titleSimilarity(a: string, b: string) {
  return 0.65 * setJaccard(proseTokens(a), proseTokens(b)) + 0.35 * dice(a, b);
}

export function similarity(a: string, b: string, titleA = "", titleB = "") {
  const ca = canonical(a);
  const cb = canonical(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 1;

  const proseA = proseTokens(a);
  const proseB = proseTokens(b);
  const prose = !proseA.length && !proseB.length ? 0.35 : setJaccard(proseA, proseB);
  const semantic = setJaccard(semanticTokens(a), semanticTokens(b));
  const literal = setJaccard(literalTokens(a), literalTokens(b));
  const chars = dice(a, b);
  const structure = dice(structuralText(a), structuralText(b));
  const mathA = mathTokens(a);
  const mathB = mathTokens(b);
  const math = mathA.length && mathB.length ? setJaccard(mathA, mathB) : 0.45;
  const numbersA = numberTokens(a);
  const numbersB = numberTokens(b);
  const numbers = numbersA.length && numbersB.length ? setJaccard(numbersA, numbersB) : 0.45;
  const title = titleA || titleB ? titleSimilarity(titleA, titleB) : 0.45;

  let score = 0.24 * prose + 0.22 * semantic + 0.16 * literal + 0.10 * chars + 0.08 * structure + 0.09 * math + 0.06 * title + 0.05 * numbers;

  // Paraphrased tasks should still be surfaced. This catches variants such as
  // "Drücke ... mit einem Term aus" vs. "Stelle einen passenden Term auf".
  if (semantic >= 0.58 && prose >= 0.42) score = Math.max(score, 0.52 + 0.18 * semantic + 0.08 * prose);
  if (semantic >= 0.72 && structure >= 0.68) score = Math.max(score, 0.66 + 0.16 * semantic);

  // Same substantive wording with changed values is a useful duplicate warning.
  if (proseA.length >= 3 && proseB.length >= 3 && prose >= 0.84 && structure >= 0.78) {
    score = Math.max(score, 0.76 + 0.10 * literal);
  }

  if (numbersA.length >= 2 && numbersB.length >= 2 && numbers < 0.20 && prose < 0.68 && semantic < 0.68) score *= 0.84;

  const partsA = subtaskCount(a);
  const partsB = subtaskCount(b);
  if (partsA && partsB && Math.abs(partsA - partsB) >= 2) score *= 0.88;

  const lengthRatio = Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length);
  if (lengthRatio < 0.42) score *= 0.78;
  else if (lengthRatio < 0.58) score *= 0.88;

  if (proseA.length <= 1 && proseB.length <= 1 && semantic < 0.65 && literal < 0.72) score *= 0.72;

  return Math.max(0, Math.min(1, score));
}

function topicOrder(classLevel: string, preferred: string) {
  const topics = [...(LEGACY_TOPICS_BY_CLASS[classLevel] || [])];
  const related: Record<string, string[]> = {
    "Terme": ["Gleichungen"],
    "Gleichungen": ["Terme"],
    "Terme & Gleichungen": [],
  };
  return [preferred, ...(related[preferred] || []), ...topics]
    .filter((topic, index, list) => topic && list.indexOf(topic) === index && topics.includes(topic));
}

export async function addDuplicateCandidates(drafts: ImportDraft[]) {
  const cache = new Map<string, Awaited<ReturnType<typeof loadTasks>>>();

  async function tasksFor(classLevel: string, topic: string) {
    const key = `${classLevel}::${topic}`;
    if (!cache.has(key)) {
      try { cache.set(key, await loadTasks(classLevel, topic)); }
      catch { cache.set(key, []); }
    }
    return cache.get(key) || [];
  }

  for (const draft of drafts) {
    if (!draft.classLevel) continue;
    const candidates: DuplicateCandidate[] = [];
    const seen = new Set<string>();

    for (const topic of topicOrder(draft.classLevel, draft.topic)) {
      const tasks = await tasksFor(draft.classLevel, topic);
      for (const task of tasks) {
        if (seen.has(task.id)) continue;
        seen.add(task.id);
        const score = similarity(draft.questionText, task.questionText, draft.title, task.title);
        if (score < 0.46) continue;
        candidates.push({
          id: task.id,
          title: task.title,
          questionText: task.questionText,
          classLevel: draft.classLevel,
          topic: task.topic,
          competence: task.competence,
          score,
        });
      }

      candidates.sort((a, b) => b.score - a.score);
      // Strong match found: no need to query every unrelated topic for this draft.
      if ((candidates[0]?.score || 0) >= 0.84) break;
    }

    candidates.sort((a, b) => b.score - a.score);
    const visible = candidates.filter((candidate) => candidate.score >= 0.50).slice(0, 5);
    draft.duplicates = visible;
    draft.duplicate = visible[0];

    // Only virtually identical tasks are deselected automatically.
    if (draft.duplicate?.score && draft.duplicate.score >= 0.97) draft.include = false;
  }
  return drafts;
}

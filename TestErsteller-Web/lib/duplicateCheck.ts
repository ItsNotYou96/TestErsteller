import type { ImportDraft, DuplicateCandidate } from "./adminTypes";
import { loadTasks } from "./notion";

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/\\[a-z]+/g, " ")
    .replace(/\d+(?:[.,]\d+)?/g, " # ")
    .replace(/[^a-zäöüß#]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenJaccard(a: string, b: string) {
  const aa = new Set(normalize(a).split(" ").filter((x) => x.length > 1));
  const bb = new Set(normalize(b).split(" ").filter((x) => x.length > 1));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const token of aa) if (bb.has(token)) intersection++;
  return intersection / (aa.size + bb.size - intersection);
}

function trigrams(value: string) {
  const text = `  ${normalize(value)}  `;
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

export function similarity(a: string, b: string) {
  return 0.62 * tokenJaccard(a, b) + 0.38 * dice(a, b);
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
    const source = `${draft.title}\n${draft.questionText}`;
    let best: DuplicateCandidate | undefined;
    for (const task of cache.get(key) || []) {
      const score = similarity(source, `${task.title}\n${task.questionText}`);
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
    if (best && best.score >= 0.5) {
      draft.duplicate = best;
      if (best.score >= 0.86) draft.include = false;
    }
  }
  return drafts;
}

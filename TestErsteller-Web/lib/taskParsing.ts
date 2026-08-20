import type { Afb, SubTaskItem } from "./types";

export function parsePointsSpec(raw: string) {
  const clean = (raw || "").trim();
  const maxMatch = clean.match(/\(\s*max\.?\s*(\d+(?:[.,]\d+)?)\s*\)/i);
  const beforeMax = clean.replace(/\(\s*max\.?[^)]*\)/ig, "");
  const values = (beforeMax.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(",", ".")));
  const sum = values.reduce((a, b) => a + b, 0);
  return {
    values,
    maxPoints: maxMatch ? Number(maxMatch[1].replace(",", ".")) : sum,
  };
}

export function parseAfbLabels(raw: string): Afb[] {
  const found: Afb[] = [];
  const normalized = (raw || "").toUpperCase();
  if (/AFB\s*(?:1|I)(?!I)/.test(normalized)) found.push("AFB1");
  if (/AFB\s*(?:2|II)(?!I)/.test(normalized)) found.push("AFB2");
  if (/AFB\s*(?:3|III)/.test(normalized)) found.push("AFB3");
  return Array.from(new Set(found));
}

export function parseSubTasks(questionText: string, afbRaw: string, pointsRaw: string): SubTaskItem[] {
  const { values } = parsePointsSpec(pointsRaw);
  const questionMatches = Array.from((questionText || "").matchAll(/^\s*([*⋆✱]?\s*[a-zA-Z])\)\s*/gm));
  const starByLabel = new Map<string, boolean>();
  for (const match of questionMatches) {
    const token = (match[1] || "").replace(/\s/g, "");
    const label = token.replace(/^[*⋆✱]/, "").toLowerCase();
    starByLabel.set(label, /^[*⋆✱]/.test(token));
  }

  const explicit = new Map<string, Afb>();
  for (const match of (afbRaw || "").matchAll(/([a-zA-Z])\s*[:)]?\s*AFB\s*([123]|I{1,3})/gi)) {
    const raw = match[2].toUpperCase();
    const n = raw === "I" ? 1 : raw === "II" ? 2 : raw === "III" ? 3 : Number(raw);
    if (n >= 1 && n <= 3) explicit.set(match[1].toLowerCase(), `AFB${n}` as Afb);
  }
  const global = parseAfbLabels(afbRaw)[0] || "AFB1";

  const labels = questionMatches.length
    ? questionMatches.map((m) => (m[1] || "a").replace(/\s/g, "").replace(/^[*⋆✱]/, "").toLowerCase())
    : explicit.size
      ? Array.from(explicit.keys())
      : values.length > 1
        ? values.map((_, i) => String.fromCharCode(97 + i))
        : [];

  return labels.map((label, i) => ({
    label: `${starByLabel.get(label) ? "*" : ""}${label})`,
    isStar: starByLabel.get(label) || false,
    afb: explicit.get(label) || global,
    points: values[i] ?? 0,
  }));
}

export function buildPointsByAfb(subTasks: SubTaskItem[], afbRaw: string, maxPoints: number): Partial<Record<Afb, number>> {
  const result: Partial<Record<Afb, number>> = {};
  if (subTasks.length) {
    for (const sub of subTasks) result[sub.afb] = (result[sub.afb] || 0) + sub.points;
    return result;
  }
  const labels = parseAfbLabels(afbRaw);
  return { [labels[0] || "AFB1"]: maxPoints };
}

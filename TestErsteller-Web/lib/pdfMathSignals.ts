/**
 * Generic signals for damaged mathematical PDF text layers.
 *
 * PDF text extraction is one-dimensional while printed mathematics is often
 * two-dimensional. Stacked fractions are therefore commonly emitted as bare
 * numerator/denominator tokens, either on isolated lines or flattened next to
 * each other. This module only decides whether a task deserves visual
 * verification; it does NOT reconstruct a formula itself.
 */

function normalized(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[−–—]/g, "-")
    .replace(/[\u200B\uFEFF]/g, "")
    .replace(/\r/g, "");
}

export function hasMathematicalContent(value: string) {
  const text = normalized(value);
  const equations = (text.match(/[=<>≤≥]/g) || []).length;
  const variables = (text.match(/\b[a-z](?=\s*(?:[+\-*/=<>]|\d))/gi) || []).length;
  const operators = (text.match(/[+*/÷·×]|\s-\s|\\(?:cdot|div|frac|sqrt)\b/g) || []).length;
  const subTasks = (text.match(/(?:^|\s)\*?[a-z]\)\s*/gim) || []).length;
  return equations > 0 || variables >= 2 || operators >= 2 || (subTasks >= 2 && /\d/.test(text));
}

function adjacentBareNumberRuns(value: string) {
  // Two or more adjacent number tokens without an operator are a strong signal
  // once the surrounding task is mathematical. Typical broken fraction output:
  //   d) 4 3 x+4=25
  // or a flattened row containing several stacked fractions:
  //   e) 4 3 20 3 5 4 = - y
  const text = normalized(value).replace(/\n+/g, " ");
  const matches = text.match(/(?:^|[\s():;])[-+]?\d+(?:[.,]\d+)?(?:\s+[-+]?\d+(?:[.,]\d+)?){1,}(?=\s*(?:[a-z]|[=+\-*/<>]|$))/gi);
  return matches?.length || 0;
}

function isolatedMathNumbers(value: string) {
  const lines = normalized(value).split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.filter((line) => /^[-+]?\d{1,4}(?:[.,]\d+)?$/.test(line)).length;
}

function suspiciousFractionLayout(value: string) {
  const text = normalized(value).replace(/\n+/g, " ");
  // A subtask starts with two bare integers followed by a variable/expression.
  if (/(?:^|\s)\*?[a-z]\)\s*[-+]?\d+(?:[.,]\d+)?\s+[-+]?\d+(?:[.,]\d+)?\s*(?:[a-z]|\()/i.test(text)) return true;
  // A long bare-number run inside an equation row is highly unlikely in normal
  // linear notation and commonly originates from several stacked fractions.
  if (/(?:\d+(?:[.,]\d+)?\s+){3,}\d+(?:[.,]\d+)?\s*(?:[=+\-*/]|[a-z])/i.test(text)) return true;
  return false;
}

export function likelyBrokenPdfMath(value: string) {
  const text = normalized(value);
  if (!text.trim() || !hasMathematicalContent(text)) return false;

  if (/[�□]/.test(text) || /\b[xyz]\d\b/i.test(text)) return true;
  if (isolatedMathNumbers(text) >= 2) return true;
  if (suspiciousFractionLayout(text)) return true;
  if (adjacentBareNumberRuns(text) >= 2) return true;

  return false;
}

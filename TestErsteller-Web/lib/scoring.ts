import type { Afb, SubTaskItem, TaskItem } from "./types";

const AFBS: Afb[] = ["AFB1", "AFB2", "AFB3"];

function empty(): Record<Afb, number> {
  return { AFB1: 0, AFB2: 0, AFB3: 0 };
}

function add(result: Record<Afb, number>, sub: SubTaskItem) {
  result[sub.afb] += sub.points;
}

export function mandatoryAfb(task: TaskItem): Record<Afb, number> {
  if (!task.subTasks?.length) return { ...empty(), ...task.pointsByAfb };
  const result = empty();
  for (const sub of task.subTasks) if (!sub.isStar) add(result, sub);
  return result;
}

export function optimizedStarAfb(task: TaskItem): Record<Afb, number> {
  if (!task.subTasks?.length || !task.subTasks.some((s) => s.isStar)) {
    return { ...empty(), ...task.pointsByAfb };
  }

  // Legacy WPF behavior: all starred subtasks first, then ordinary subtasks
  // in source order until the task's MaxPoints are reached.
  const result = empty();
  let used = 0;
  for (const sub of task.subTasks.filter((s) => s.isStar)) {
    add(result, sub);
    used += sub.points;
  }
  for (const sub of task.subTasks.filter((s) => !s.isStar)) {
    if (used >= task.maxPoints) break;
    if (used + sub.points <= task.maxPoints) {
      add(result, sub);
      used += sub.points;
    }
  }
  return result;
}

export function totalAfb(tasks: TaskItem[], mode: "mandatory" | "optimized") {
  const out = empty();
  for (const task of tasks) {
    const row = mode === "mandatory" ? mandatoryAfb(task) : optimizedStarAfb(task);
    for (const afb of AFBS) out[afb] += row[afb] || 0;
  }
  return out;
}

export function sumAfb(row: Record<Afb, number>) {
  return AFBS.reduce((sum, afb) => sum + (row[afb] || 0), 0);
}

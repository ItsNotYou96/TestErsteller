export type Afb = "AFB1" | "AFB2" | "AFB3";

export type Competence =
  | "Argumentieren"
  | "Problemlösen"
  | "Modellieren"
  | "Darstellungen"
  | "Mathematik"
  | "Kommunizieren";

export interface SubTaskItem {
  label: string;
  isStar: boolean;
  afb: Afb;
  points: number;
}

export interface TaskItem {
  id: string;
  title: string;
  questionText: string;
  competence: Competence;
  topic: string;
  classLevel?: string;
  maxPoints: number;
  pointsRaw: string;
  afbRaw: string;
  estimatedTime: number;
  expectation: string;
  imageUrl?: string;
  onExtraSheet?: boolean;
  pointsByAfb: Partial<Record<Afb, number>>;
  subTasks: SubTaskItem[];
}

export interface TestMetadata {
  title: string;
  tools: string;
  formPoints: string;
  classLevel: string;
  topic: string;
  teacher: string;
  date: string;
}

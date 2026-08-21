import type { Competence } from "./types";

export interface DuplicateCandidate {
  id: string;
  title: string;
  questionText: string;
  classLevel: string;
  topic: string;
  competence: Competence;
  score: number;
}

export interface ImportDraft {
  id: string;
  sourceFile: string;
  title: string;
  questionText: string;
  classLevel: string;
  topic: string;
  competence: Competence;
  afbRaw: string;
  pointsRaw: string;
  maxPoints: number;
  estimatedTime: number;
  expectation: string;
  imageDataUrl?: string;
  imageName?: string;
  include: boolean;
  analysisMode: "heuristic" | "llm";
  sourcePages?: number[];
  mathRepair?: "none" | "visual" | "rejected";
  duplicate?: DuplicateCandidate;
  confidence?: {
    topic: number;
    competence: number;
    afb: number;
    time: number;
    expectation: number;
  };
}

export interface AdminStatus {
  authenticated: boolean;
  configured: boolean;
  llmConfigured: boolean;
  notionConfigured: boolean;
  llmModel?: string;
}

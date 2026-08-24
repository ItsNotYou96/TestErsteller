import type { Competence } from "./types";

export const LOCAL_RELEVANCE_THRESHOLD = 0.50; // UI fallback only; v4 retrieval uses explicit evidence flags.

export interface DuplicateCandidate {
  id: string;
  title: string;
  questionText: string;
  classLevel: string;
  topic: string;
  competence: Competence;
  score: number;
  localScore?: number;
  retrievalScore?: number;
  structuralScore?: number;
  retrievalEligible?: boolean;
  retrievalSignals?: string[];
  confidentVariant?: boolean;
  relation?: "near_duplicate" | "same_skill" | "related" | "not_related";
  reason?: string;
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
  pointsSource?: "document" | "heuristic" | "llm";
  estimatedTime: number;
  expectation: string;
  imageDataUrl?: string;
  imageName?: string;
  include: boolean;
  analysisMode: "heuristic" | "llm";
  sourcePages?: number[];
  sourceBlockIds?: string[];
  segmentationMode?: "deterministic" | "llm";
  segmentationConfidence?: number;
  mathRepair?: "none" | "needed" | "checking" | "visual" | "rejected" | "failed";
  mathRepairNote?: string;
  duplicate?: DuplicateCandidate;
  duplicates?: DuplicateCandidate[];
  duplicatePool?: DuplicateCandidate[];
  duplicateNeedsRerank?: boolean;
  duplicateCheckStatus?: "pending" | "checking" | "local" | "groq" | "failed";
  duplicateCheckNote?: string;
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

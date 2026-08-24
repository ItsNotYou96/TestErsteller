import type { Competence } from "./types";

export const LOCAL_RELEVANCE_THRESHOLD = 0.18; // Show weak local retrieval candidates too; this is a search threshold, not confirmed similarity.

export interface SimilarityRubric {
  sameLearningGoal: boolean;
  sameStudentAction: boolean;
  sameMathematicalMethod: boolean;
  sameRepresentation: boolean;
  comparableStructure: boolean;
  sameTemplate: boolean;
}

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
  rubric?: SimilarityRubric;
  semanticReviewed?: boolean;
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
  duplicateCheckStatus?: "pending" | "checking" | "local" | "partial" | "groq" | "failed";
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

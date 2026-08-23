import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import type { ImportDraft } from "@/lib/adminTypes";
import { addDuplicateCandidates, rerankDuplicateCandidates } from "@/lib/duplicateCheck";
import { analyzeDraftWithLlm, GroqAnalysisError, llmConfigured } from "@/lib/llmAnalysis";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  if (!llmConfigured()) return NextResponse.json({ error: "GROQ_API_KEY ist nicht gesetzt." }, { status: 503 });

  try {
    const body = await request.json() as { draft?: ImportDraft; classLevel?: string; topic?: string };
    if (!body.draft?.id) return NextResponse.json({ error: "Keine Aufgabe übergeben." }, { status: 400 });
    const analyzed = await analyzeDraftWithLlm(body.draft, body.classLevel, body.topic);
    // The import request already searched every topic/competence in the class. Reuse those candidates
    // here so each Groq metadata request does not trigger dozens of fresh Notion queries.
    if (analyzed.duplicates?.length) {
      const withDuplicate = await rerankDuplicateCandidates(analyzed);
      return NextResponse.json({ draft: withDuplicate });
    }
    const [withDuplicate] = await addDuplicateCandidates([{ ...analyzed, duplicate: undefined }], { llmRerank: true });
    return NextResponse.json({ draft: withDuplicate });
  } catch (error) {
    if (error instanceof GroqAnalysisError) {
      return NextResponse.json({
        error: error.message,
        retryAfterSeconds: error.rateLimit.retryAfterSeconds,
        remainingTokens: error.rateLimit.remainingTokens,
        resetTokens: error.rateLimit.resetTokens,
      }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

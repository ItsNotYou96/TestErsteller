import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import type { ImportDraft } from "@/lib/adminTypes";
import { DuplicateRerankError, rerankDuplicateCandidatesBatch } from "@/lib/duplicateCheck";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });

  try {
    const body = await request.json() as { drafts?: ImportDraft[] };
    const drafts = Array.isArray(body.drafts) ? body.drafts.filter((draft) => draft?.id).slice(0, 4) : [];
    if (!drafts.length) return NextResponse.json({ error: "Keine Aufgaben übergeben." }, { status: 400 });
    const results = await rerankDuplicateCandidatesBatch(drafts.map((draft) => ({ ...draft, duplicateCheckStatus: "checking" })));
    return NextResponse.json({ drafts: results });
  } catch (error) {
    if (error instanceof DuplicateRerankError) {
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

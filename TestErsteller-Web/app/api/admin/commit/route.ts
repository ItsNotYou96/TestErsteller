import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import type { ImportDraft } from "@/lib/adminTypes";
import { createTaskInNotion } from "@/lib/notionWrite";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  try {
    const body = await request.json();
    const drafts = (Array.isArray(body?.drafts) ? body.drafts : []).filter((x: ImportDraft) => x?.include);
    if (!drafts.length) return NextResponse.json({ error: "Keine Aufgaben für den Import markiert." }, { status: 400 });
    const results: Array<{ ok: boolean; title: string; id?: string; url?: string; error?: string }> = [];
    for (const draft of drafts as ImportDraft[]) {
      try {
        const result = await createTaskInNotion(draft);
        results.push({ ok: true, ...result });
      } catch (error) {
        results.push({ ok: false, title: draft.title, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const imported = results.filter((x) => x.ok).length;
    return NextResponse.json({ ok: imported === drafts.length, imported, failed: drafts.length - imported, results }, { status: imported ? 200 : 500 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

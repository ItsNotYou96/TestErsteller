import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { addDuplicateCandidates } from "@/lib/duplicateCheck";
import { heuristicDrafts, parseUploadedFile } from "@/lib/importParsing";
import { analyzeWithLlm, llmConfigured } from "@/lib/llmAnalysis";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((x): x is File => x instanceof File);
    if (!files.length) return NextResponse.json({ error: "Bitte mindestens eine PDF- oder DOCX-Datei auswählen." }, { status: 400 });
    if (files.length > 8) return NextResponse.json({ error: "Bitte höchstens 8 Dateien gleichzeitig hochladen." }, { status: 400 });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    // Vercel Functions accept at most 4.5 MB request bodies. Keep headroom for multipart metadata.
    if (totalBytes > 4 * 1024 * 1024) return NextResponse.json({ error: "Die ausgewählten Dateien sind zusammen größer als 4 MB. Vercel begrenzt Function-Uploads auf 4,5 MB. Bitte Dateien verkleinern oder in getrennten Importen verarbeiten." }, { status: 413 });

    const classLevel = String(form.get("classLevel") || "").trim() || undefined;
    const topic = String(form.get("topic") || "").trim() || undefined;
    const useLlm = String(form.get("useLlm") || "false") === "true";

    const sources = await Promise.all(files.map(parseUploadedFile));
    let drafts = heuristicDrafts(sources, classLevel, topic);
    const warnings: string[] = [];

    if (useLlm) {
      if (!llmConfigured()) warnings.push("KI-Analyse wurde angefordert, aber OPENAI_API_KEY ist nicht gesetzt. Heuristische Analyse verwendet.");
      else {
        try { drafts = await analyzeWithLlm(sources, drafts, classLevel, topic); }
        catch (error) { warnings.push(`KI-Analyse ist fehlgeschlagen; heuristische Ergebnisse werden gezeigt. ${error instanceof Error ? error.message : String(error)}`); }
      }
    }

    if (!drafts.length) {
      return NextResponse.json({
        error: useLlm
          ? "Es konnten keine Aufgaben erkannt werden. Bei gescannten PDFs prüfe bitte den KI-Schlüssel oder lade eine DOCX/Text-PDF hoch."
          : "Es konnten keine Aufgabenüberschriften erkannt werden. Verwende z. B. „Aufgabe 1:“ oder aktiviere die KI-Analyse.",
      }, { status: 422 });
    }

    drafts = await addDuplicateCandidates(drafts);
    return NextResponse.json({
      drafts,
      warnings,
      sourceSummary: sources.map((s) => ({ name: s.name, characters: s.text.length, images: s.images.length })),
      analysisMode: drafts.some((x) => x.analysisMode === "llm") ? "llm" : "heuristic",
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

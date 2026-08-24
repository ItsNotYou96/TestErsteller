import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { addDuplicateCandidates } from "@/lib/duplicateCheck";
import { draftsFromSources, parseUploadedFile, type ParsedSource } from "@/lib/importParsing";
import { llmConfigured } from "@/lib/llmAnalysis";
import { likelyBrokenPdfMath, visionOcrConfigured } from "@/lib/pdfVisionOcr";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((x): x is File => x instanceof File);
    if (!files.length) return NextResponse.json({ error: "Bitte mindestens eine PDF- oder DOCX-Datei auswählen." }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "Bitte höchstens 10 Dateien gleichzeitig hochladen." }, { status: 400 });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 4 * 1024 * 1024) return NextResponse.json({ error: "Die ausgewählten Dateien sind zusammen größer als 4 MB. Bitte Dateien verkleinern oder auf mehrere Importe verteilen." }, { status: 413 });

    const classLevel = String(form.get("classLevel") || "").trim() || undefined;
    const topic = String(form.get("topic") || "").trim() || undefined;
    const useLlm = String(form.get("useLlm") || "false") === "true";
    const repairMathVisually = String(form.get("useVisionOcr") || "false") === "true";
    const warnings: string[] = [];

    const sources: ParsedSource[] = await Promise.all(files.map(parseUploadedFile));
    const segmented = await draftsFromSources(sources, classLevel, topic, useLlm && llmConfigured());
    let drafts = segmented.drafts;
    warnings.push(...segmented.warnings);

    if (!drafts.length) {
      return NextResponse.json({
        error: "Der Dokumentinhalt wurde in Blöcke zerlegt, aber es konnten keine verlässlichen Aufgabenbereiche bestimmt werden. Es wurde bewusst kein Aufgabentext erfunden. Aktiviere die KI-Analyse für eine semantische Blockgruppierung oder prüfe das Dokument manuell.",
        sourceSummary: sources.map((s) => ({ name: s.name, characters: s.text.length, blocks: s.blocks.length, images: s.images.length, method: s.mimeType === "application/pdf" ? "PDF-Blöcke" : "DOCX-Blöcke" })),
      }, { status: 422 });
    }

    // Visual math repair is queued in the browser after segmentation. The import request only
    // marks suspicious PDF tasks. This keeps the initial Vercel function short and, more
    // importantly, makes rejected/rate-limited Vision work visible instead of silently falling
    // back to broken PDF text.
    if (repairMathVisually) {
      if (!visionOcrConfigured()) warnings.push("Mathematik visuell korrigieren wurde gewählt, aber GROQ_API_KEY ist nicht gesetzt.");
      else {
        const sourceByName = new Map(sources.map((source) => [source.name, source]));
        let needed = 0;
        for (const draft of drafts) {
          const source = sourceByName.get(draft.sourceFile);
          if (!source || source.mimeType !== "application/pdf" || !draft.sourcePages?.length) continue;
          const blockIds = new Set(draft.sourceBlockIds || []);
          const rawPdfEvidence = source.blocks
            .filter((block) => blockIds.has(block.id) && block.kind !== "page-break" && block.kind !== "image")
            .map((block) => block.text)
            .join("\n");
          if (likelyBrokenPdfMath(`${rawPdfEvidence}\n${draft.questionText}`)) {
            draft.mathRepair = "needed";
            draft.mathRepairNote = "Beschädigte PDF-Mathematik erkannt; visuelle Reparatur steht aus.";
            needed++;
          } else {
            draft.mathRepair = "none";
          }
        }
        if (needed) warnings.push(`${needed} Aufgabe(n) enthalten wahrscheinlich beschädigte PDF-Mathematik und werden im nächsten Schritt visuell nachgelesen.`);
      }
    }

    // Stage 1 duplicate retrieval is local/deterministic and searches every topic/competence of the
    // class. Semantic Groq reranking happens after the per-task metadata pass.
    drafts = await addDuplicateCandidates(drafts);

    if (useLlm && !llmConfigured()) warnings.push("KI-Analyse wurde angefordert, aber GROQ_API_KEY ist nicht gesetzt. Heuristische Metadaten werden verwendet.");

    return NextResponse.json({
      drafts,
      warnings,
      sourceSummary: sources.map((s) => ({ name: s.name, characters: s.text.length, blocks: s.blocks.length, images: s.images.length, method: s.mimeType === "application/pdf" ? "PDF-Blöcke" : "DOCX-Blöcke" })),
      analysisMode: "heuristic",
      llmRequested: useLlm && llmConfigured(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

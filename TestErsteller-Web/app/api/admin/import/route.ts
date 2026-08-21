import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { addDuplicateCandidates } from "@/lib/duplicateCheck";
import { heuristicDrafts, parseUploadedFile, type ParsedSource } from "@/lib/importParsing";
import { llmConfigured } from "@/lib/llmAnalysis";
import { ocrPdfWithGroq, visionOcrConfigured, visionOcrModel } from "@/lib/pdfVisionOcr";

export const runtime = "nodejs";
export const maxDuration = 60;

type SourceWithMethod = ParsedSource & { extractionMethod?: "pdf-text" | "docx" | "groq-vision" };

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((x): x is File => x instanceof File);
    if (!files.length) return NextResponse.json({ error: "Bitte mindestens eine PDF- oder DOCX-Datei auswählen." }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "Bitte höchstens 10 Dateien gleichzeitig hochladen." }, { status: 400 });
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 4 * 1024 * 1024) return NextResponse.json({ error: "Die ausgewählten Dateien sind zusammen größer als 4 MB. Vercel begrenzt Function-Uploads auf 4,5 MB. Bitte Dateien verkleinern oder in getrennten Importen verarbeiten." }, { status: 413 });

    const classLevel = String(form.get("classLevel") || "").trim() || undefined;
    const topic = String(form.get("topic") || "").trim() || undefined;
    const useLlm = String(form.get("useLlm") || "false") === "true";
    const forceVisionOcr = String(form.get("useVisionOcr") || "false") === "true";
    const warnings: string[] = [];

    let sources: SourceWithMethod[] = (await Promise.all(files.map(parseUploadedFile))).map((source) => ({
      ...source,
      extractionMethod: source.mimeType === "application/pdf" ? "pdf-text" : "docx",
    }));

    // Normal PDF text extraction is intentionally attempted first because it is fast and free.
    // Vision OCR is used only when explicitly requested or as a fallback when a PDF yields no
    // recognizable task structure. This avoids spending Groq tokens on every ordinary text PDF.
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (source.mimeType !== "application/pdf") continue;
      const initialDrafts = heuristicDrafts([source], classLevel, topic);
      const sparseText = (source.text || "").trim().length < 300;
      const automaticVisionFallback = useLlm && (sparseText || initialDrafts.length === 0) && visionOcrConfigured();
      const shouldUseVision = forceVisionOcr || automaticVisionFallback;
      if (!shouldUseVision) continue;

      if (!visionOcrConfigured()) {
        warnings.push(`${source.name}: Visuelle PDF-Erkennung wäre sinnvoll, aber GROQ_API_KEY ist nicht gesetzt.`);
        continue;
      }

      try {
        const ocrText = await ocrPdfWithGroq(source.bytes);
        if (ocrText.length >= 80) {
          sources[i] = { ...source, text: ocrText, simplified: ocrText, extractionMethod: "groq-vision" };
          warnings.push(`${source.name}: PDF wurde visuell mit Groq ${visionOcrModel()} nachgelesen. Bitte mathematische Formeln trotzdem kontrollieren.`);
        }
      } catch (error) {
        warnings.push(`${source.name}: Visuelle PDF-Erkennung ist fehlgeschlagen; normale PDF-Texterkennung wird weiterverwendet. ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    let drafts = heuristicDrafts(sources, classLevel, topic);

    if (useLlm) {
      const sparsePdf = sources.some((source) => source.mimeType === "application/pdf" && (source.text || "").trim().length < 400);
      if (sparsePdf) warnings.push("Mindestens eine PDF enthält weiterhin kaum auslesbaren Text. Für solche Scan-PDFs kann im Uploadbereich „PDF visuell lesen (OCR)“ aktiviert werden.");
      if (!llmConfigured()) warnings.push("KI-Analyse wurde angefordert, aber GROQ_API_KEY ist nicht gesetzt. Heuristische Analyse verwendet.");
      else if (drafts.length) warnings.push("Die Aufgaben wurden zuerst lokal getrennt. Die Groq-Metadatenanalyse läuft anschließend aufgabenweise, damit das 8.000-TPM-Free-Tier nicht durch einen einzigen großen Request überschritten wird.");
    }

    if (!drafts.length) {
      return NextResponse.json({
        error: "Der Dokumenttext wurde gelesen, aber es konnten keine Aufgabenblöcke sicher getrennt werden. Aktiviere bei problematischen PDFs „PDF visuell lesen (OCR)“ oder sende mir die PDF, damit das Nummerierungsmuster ergänzt werden kann.",
        sourceSummary: sources.map((s) => ({ name: s.name, characters: s.text.length, images: s.images.length, method: s.extractionMethod })),
      }, { status: 422 });
    }

    drafts = await addDuplicateCandidates(drafts);
    return NextResponse.json({
      drafts,
      warnings,
      sourceSummary: sources.map((s) => ({ name: s.name, characters: s.text.length, images: s.images.length, method: s.extractionMethod })),
      analysisMode: "heuristic",
      llmRequested: useLlm && llmConfigured(),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { addDuplicateCandidates } from "@/lib/duplicateCheck";
import { heuristicDrafts, parseUploadedFile, type ParsedSource } from "@/lib/importParsing";
import { llmConfigured } from "@/lib/llmAnalysis";
import { repairPdfMathWithGroq, visionOcrConfigured, visionOcrModel } from "@/lib/pdfVisionOcr";

export const runtime = "nodejs";
export const maxDuration = 60;

type ExtractionMethod = "pdf-text" | "docx" | "groq-math";
type SourceWithMethod = ParsedSource & { extractionMethod?: ExtractionMethod };

function sourceWithPages(source: SourceWithMethod, pages: Array<{ pageNumber: number; text: string }>): SourceWithMethod {
  const text = pages.map((page) => page.text).filter(Boolean).join("\n\n");
  const simplified = pages.map((page) => `[[PAGE:${page.pageNumber}]]\n${page.text}`).join("\n");
  return { ...source, pages, text, simplified, extractionMethod: "groq-math" };
}

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
    // Kept under the old form field name so existing clients remain compatible. In v2.2 this no
    // longer means "let vision OCR invent the page text". It only repairs math inside trusted text.
    const repairMathVisually = String(form.get("useVisionOcr") || "false") === "true";
    const warnings: string[] = [];

    let sources: SourceWithMethod[] = (await Promise.all(files.map(parseUploadedFile))).map((source) => ({
      ...source,
      extractionMethod: source.mimeType === "application/pdf" ? "pdf-text" : "docx",
    }));

    const repairedPageMap = new Map<string, Set<number>>();
    const rejectedPageMap = new Map<string, Set<number>>();

    if (repairMathVisually) {
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i];
        if (source.mimeType !== "application/pdf") continue;

        const initialDrafts = heuristicDrafts([source], classLevel, topic);
        const hasTrustedSkeleton = (source.text || "").trim().length >= 120 && initialDrafts.length > 0 && (source.pages?.length || 0) > 0;

        if (!hasTrustedSkeleton) {
          warnings.push(`${source.name}: Die PDF hat keine ausreichend verlässliche Text-/Aufgabenstruktur. Die visuelle Erkennung wurde aus Sicherheitsgründen NICHT verwendet, weil ein Vision-Modell ohne Textanker Aufgaben erfinden könnte.`);
          continue;
        }
        if (!visionOcrConfigured()) {
          warnings.push(`${source.name}: Visuelle Formelkorrektur wurde gewählt, aber GROQ_API_KEY ist nicht gesetzt.`);
          continue;
        }

        try {
          const result = await repairPdfMathWithGroq(source.bytes, source.pages || []);
          sources[i] = sourceWithPages(source, result.pages);
          repairedPageMap.set(source.name, new Set(result.repairedPages));
          rejectedPageMap.set(source.name, new Set(result.rejectedPages.map((x) => x.pageNumber)));

          if (result.repairedPages.length) {
            warnings.push(`${source.name}: Mathematische Schreibweise auf Seite(n) ${result.repairedPages.join(", ")} wurde visuell mit Groq ${visionOcrModel()} korrigiert. Die Aufgabenstruktur stammt weiterhin ausschließlich aus der PDF-Textschicht.`);
          }
          for (const rejected of result.rejectedPages) {
            warnings.push(`${source.name}, Seite ${rejected.pageNumber}: Visuelle Korrektur verworfen (${rejected.reason}). Originaltext bleibt erhalten.`);
          }
          if (result.skippedPages.length) {
            warnings.push(`${source.name}: Seite(n) ${result.skippedPages.join(", ")} wurden nicht visuell übernommen, weil dort keine sichere Text-/Aufgabenstruktur als Kontrollanker vorhanden war.`);
          }
        } catch (error) {
          warnings.push(`${source.name}: Visuelle Formelkorrektur ist fehlgeschlagen; der unveränderte PDF-Text wird verwendet. ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    let drafts = heuristicDrafts(sources, classLevel, topic);
    for (const draft of drafts) {
      const repaired = repairedPageMap.get(draft.sourceFile);
      const rejected = rejectedPageMap.get(draft.sourceFile);
      if (draft.sourcePages?.some((page) => repaired?.has(page))) draft.mathRepair = "visual";
      else if (draft.sourcePages?.some((page) => rejected?.has(page))) draft.mathRepair = "rejected";
    }

    if (useLlm) {
      const sparsePdf = sources.some((source) => source.mimeType === "application/pdf" && (source.text || "").trim().length < 400);
      if (sparsePdf) warnings.push("Mindestens eine PDF enthält kaum auslesbaren Text. v2.2 erzeugt daraus bewusst keine Vision-Aufgaben ohne verlässliche Textanker. Solche Scan-PDFs sollten zuerst mit einer echten OCR-Textschicht versehen werden.");
      if (!llmConfigured()) warnings.push("KI-Analyse wurde angefordert, aber GROQ_API_KEY ist nicht gesetzt. Heuristische Analyse verwendet.");
      else if (drafts.length) warnings.push("Die Aufgaben wurden zuerst lokal getrennt. Groq darf anschließend nur Metadaten zu diesen bereits vorhandenen Aufgaben analysieren; es kann keine neuen Aufgaben hinzufügen.");
    }

    if (!drafts.length) {
      return NextResponse.json({
        error: "Der Dokumenttext wurde gelesen, aber es konnten keine Aufgabenblöcke sicher getrennt werden. Aus Sicherheitsgründen erzeugt die visuelle Erkennung keine neuen Aufgaben ohne Textanker. Bei einer Scan-PDF bitte zuerst OCR/Textlayer erzeugen oder die PDF manuell prüfen.",
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

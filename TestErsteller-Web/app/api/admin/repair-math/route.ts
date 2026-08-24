import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { MathRepairRateLimitError, repairTaskMathWithGroq, visionOcrConfigured, visionOcrModel } from "@/lib/pdfVisionOcr";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Nicht als Admin angemeldet." }, { status: 401 });
  if (!visionOcrConfigured()) return NextResponse.json({ error: "GROQ_API_KEY fehlt für die visuelle Mathekorrektur." }, { status: 503 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "PDF-Datei fehlt." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") return NextResponse.json({ error: "Die visuelle Mathekorrektur unterstützt hier nur PDF." }, { status: 400 });
    const questionText = String(form.get("questionText") || "").trim();
    if (!questionText) return NextResponse.json({ error: "Aufgabentext fehlt." }, { status: 400 });
    let pages: number[] = [];
    try { pages = JSON.parse(String(form.get("pages") || "[]")); } catch { /* validated below */ }
    pages = Array.isArray(pages) ? pages.map(Number).filter((x) => Number.isInteger(x) && x > 0) : [];
    if (!pages.length) return NextResponse.json({ error: "PDF-Seite der Aufgabe fehlt." }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    const correctedText = await repairTaskMathWithGroq(bytes, questionText, pages);
    return NextResponse.json({ correctedText, model: visionOcrModel() });
  } catch (error) {
    if (error instanceof MathRepairRateLimitError) {
      return NextResponse.json({ error: error.message, retryAfterSeconds: error.retryAfterSeconds, resetTokens: error.resetTokens }, { status: 429 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}

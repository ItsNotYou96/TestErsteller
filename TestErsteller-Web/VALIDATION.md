# v2.1 validation

## PDF numbering regression

Tested against both uploaded PDF layouts using their actual extracted text:

- `Gleichungen-und-Terme (1).pdf`: detects exactly tasks 1-10 even though the headings contain no point values (`1. ...`, `2. ...`, ...).
- `Klassenarbeit zu rationale Zahlen und Wahrscheinlichkeit - Teil 1.pdf`: still detects exactly tasks 1-5. A fraction/text fragment beginning with `3 ) ÷ ...` is not misclassified as a new task.

## Vision/OCR fallback

- Normal PDF text extraction remains the default and does not consume Groq tokens.
- When KI analysis is enabled and a PDF yields sparse text or no recognizable task blocks, the importer can automatically fall back to Groq vision OCR.
- Admin can force the fallback with `PDF visuell lesen (OCR)`.
- OCR uses `qwen/qwen3.6-27b` by default and sends one rendered PDF page per request to reduce Free-Tier TPM bursts.
- Optional override: `GROQ_VISION_MODEL`.

## TypeScript syntax

Changed TS/TSX files were parsed with TypeScript `transpileModule`; no syntax diagnostics were reported.
A complete Next.js build was not run locally because npm dependency installation is unavailable in this environment; Vercel remains the integration build.

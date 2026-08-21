# v1.9 Groq Patch

Dieser Patch stellt den optionalen KI-Import von OpenAI auf Groq um.

Vercel Environment Variables:
- GROQ_API_KEY=<dein geheimer Groq-Key>
- GROQ_MODEL=openai/gpt-oss-120b

Der Key darf nicht in GitHub oder in NEXT_PUBLIC_* Variablen gespeichert werden.
Nach dem Setzen der Variablen ein neues Vercel-Deployment starten.

Hinweis: GPT-OSS 120B auf Groq ist Text-in/Text-out. DOCX und Text-PDFs werden vorab serverseitig ausgelesen. Reine Scan-PDFs benötigen zukünftig OCR/Vision.

import { NextRequest, NextResponse } from "next/server";
import { loadMeta, loadTasks, notionConfigured, testConnection } from "@/lib/notion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action") || "tasks";
  const classLevel = request.nextUrl.searchParams.get("class") || undefined;
  const topic = request.nextUrl.searchParams.get("topic") || undefined;

  if (!notionConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error: "NOTION_TOKEN fehlt. Trage den vorhandenen WPF-Key in Vercel als Environment Variable ein.",
      },
      { status: 503 }
    );
  }

  try {
    if (action === "test") return NextResponse.json({ configured: true, ...(await testConnection()) });
    if (action === "meta") return NextResponse.json({ configured: true, ...(await loadMeta()) });
    return NextResponse.json({ configured: true, tasks: await loadTasks(classLevel, topic) });
  } catch (error) {
    return NextResponse.json(
      { configured: true, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

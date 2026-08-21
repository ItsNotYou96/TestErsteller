import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, adminConfigured, createAdminSessionValue, isAdminRequest, sessionMaxAge, verifyAdminCode } from "@/lib/adminAuth";
import { llmConfigured, llmModel } from "@/lib/llmAnalysis";
import { notionConfigured } from "@/lib/notion";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({
    authenticated: isAdminRequest(request),
    configured: adminConfigured(),
    llmConfigured: llmConfigured(),
    notionConfigured: notionConfigured(),
    llmModel: llmConfigured() ? llmModel() : undefined,
  });
}

export async function POST(request: NextRequest) {
  if (!adminConfigured()) return NextResponse.json({ error: "ADMIN_CODE ist in Vercel noch nicht gesetzt." }, { status: 503 });
  const data = await request.json().catch(() => ({}));
  if (!verifyAdminCode(String(data?.code || ""))) return NextResponse.json({ error: "Admin-Code ist falsch." }, { status: 401 });
  const response = NextResponse.json({ ok: true, llmConfigured: llmConfigured(), notionConfigured: notionConfigured(), llmModel: llmConfigured() ? llmModel() : undefined });
  response.cookies.set(ADMIN_COOKIE, createAdminSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: sessionMaxAge(),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return response;
}

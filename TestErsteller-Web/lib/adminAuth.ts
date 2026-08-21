import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_COOKIE = "testersteller_admin";
const SESSION_SECONDS = 8 * 60 * 60;

export function adminConfigured() {
  return Boolean(process.env.ADMIN_CODE?.trim());
}

function secret() {
  const explicit = process.env.ADMIN_SESSION_SECRET?.trim();
  if (explicit) return explicit;
  const code = process.env.ADMIN_CODE?.trim();
  if (!code) throw new Error("ADMIN_CODE ist nicht gesetzt.");
  // Fallback only so the feature still works with one env variable. A separate
  // ADMIN_SESSION_SECRET is recommended for production.
  return createHmac("sha256", "testersteller-admin-fallback").update(code).digest("hex");
}

function sign(exp: string) {
  return createHmac("sha256", secret()).update(exp).digest("hex");
}

export function createAdminSessionValue() {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
  return `${exp}.${sign(exp)}`;
}

export function verifyAdminCode(input: string) {
  const expected = process.env.ADMIN_CODE?.trim() || "";
  const received = input.trim();
  if (!expected || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

export function isAdminRequest(request: NextRequest) {
  const value = request.cookies.get(ADMIN_COOKIE)?.value || "";
  const [exp, sig] = value.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(exp);
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function sessionMaxAge() {
  return SESSION_SECONDS;
}

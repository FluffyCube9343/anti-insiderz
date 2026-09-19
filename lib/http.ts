import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
export function adminAuthorized(request: Request) {
  const expected = process.env.ADMIN_DEMO_KEY;
  const actual = request.headers.get("x-demo-key");
  return !!expected && expected !== "change-me" && !!actual && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected),Buffer.from(actual));
}
export function unavailable(error: unknown) {
  console.error("Request failed:", error instanceof Error ? error.name : "DependencyError");
  return NextResponse.json({ error: error instanceof Error && error.message.startsWith("Missing required configuration:") ? error.message : "Service unavailable. Check configuration, migration 0003, and provider connectivity." }, { status: 503 });
}

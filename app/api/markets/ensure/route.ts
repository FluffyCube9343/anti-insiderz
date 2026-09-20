// app/api/markets/ensure/route.ts
// Every tradeable card needs a backend market row: pools, the hash chain and
// the audit log all key off market_id. When a Polymarket-sourced card has no
// row yet, provision one on demand and return the id so the trade can clear.
// Provisioning writes shared state, so it requires the same signed identity
// proof as placing a trade - an unsigned client can never create markets.
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

// Must match the canonicalEnsurePayload in public/markets.html exactly.
function canonicalEnsurePayload(e: { agentId: string; subject: string; restrictedAffiliations: string[]; timestamp: string }): string {
  return JSON.stringify({ agentId: e.agentId, subject: e.subject, restrictedAffiliations: e.restrictedAffiliations, timestamp: e.timestamp });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const subject = String(body.subject ?? "").trim();
    const agentId = String(body.agentId ?? "");
    const timestamp = String(body.timestamp ?? "");
    const signature = String(body.signature ?? "");
    const restricted = Array.isArray(body.restrictedAffiliations) ? body.restrictedAffiliations.map(String) : [];
    if (!subject || !agentId || !timestamp || !signature) {
      return NextResponse.json({ error: "Market provisioning requires subject, agentId, timestamp, and a signed payload." }, { status: 400 });
    }
    // Freshness window so a captured payload cannot be replayed later.
    if (!Number.isFinite(Date.parse(timestamp)) || Math.abs(Date.now() - Date.parse(timestamp)) > 5 * 60_000) {
      return NextResponse.json({ error: "Stale or invalid timestamp - re-sign and retry." }, { status: 401 });
    }
    const c = supabaseConfig();
    const db = createClient(c.supabaseUrl, c.supabaseServiceKey, { auth: { persistSession: false } });
    const { data: agent, error: agentErr } = await db.from("agent_identities").select("public_key").eq("agent_id", agentId).maybeSingle();
    if (agentErr) throw agentErr;
    if (!agent) return NextResponse.json({ error: "Unknown agent identity." }, { status: 401 });
    const payload = canonicalEnsurePayload({ agentId, subject, restrictedAffiliations: restricted, timestamp });
    let verified = false;
    try { verified = crypto.verify("RSA-SHA256", Buffer.from(payload), agent.public_key, Buffer.from(signature, "base64")); } catch { verified = false; }
    if (!verified) return NextResponse.json({ error: "Signature verification failed: the request does not match the ANS-registered public key." }, { status: 401 });
    // Subject is the natural key: the same card always resolves to the same
    // market, so pools accumulate instead of fragmenting per click.
    const { data: existing, error: readErr } = await db.from("markets").select("market_id").eq("subject", subject).maybeSingle();
    if (readErr) throw readErr;
    if (existing) return NextResponse.json({ marketId: existing.market_id, created: false });
    // market_id has no database default - the id is generated here.
    const { data: inserted, error: insErr } = await db.from("markets").insert({ market_id: crypto.randomUUID(), subject, restricted_affiliations: restricted }).select("market_id").single();
    if (insErr) throw insErr;
    return NextResponse.json({ marketId: inserted.market_id, created: true });
  } catch (e) {
    // PostgREST failures are plain objects, not Errors - dig the message out.
    const msg = e instanceof Error ? e.message : (e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Unavailable");
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}

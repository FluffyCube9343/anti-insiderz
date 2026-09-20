// app/api/positions/close/route.ts
// Exit path: a signed close sells the caller's WHOLE net position on one
// simulated market back to the pool at the current displayed price - the
// same deterministic walk the card shows (lib/sim-odds.ts), so the P/L the
// trader watched tick is exactly what the close pays. Entry checks
// (affiliation, age) deliberately do NOT re-run here: a restricted identity
// can always exit, it just can never enter.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tradeConfig } from "@/lib/config";
import { verifyCloseSignature } from "@/lib/crypto";
import { NessiePayments, SupabaseTradeStore } from "@/lib/providers";
import { simPriceCents } from "@/lib/sim-odds";
import type { CloseRequest } from "@/lib/domain";

function validClose(value: unknown): value is CloseRequest {
  const x = value as Record<string, unknown>;
  return !!x && ["closeId", "agentId", "marketId", "timestamp", "signature"].every(k => typeof x[k] === "string" && x[k])
    && (x.outcome === "A" || x.outcome === "B")
    && typeof x.contracts === "number" && Number.isInteger(x.contracts) && x.contracts > 0;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!validClose(body)) return NextResponse.json({ error: "A signed close requires closeId, agentId, marketId, outcome, positive integer contracts, timestamp, and signature." }, { status: 400 });
  try {
    const c = tradeConfig();
    const store = new SupabaseTradeStore(c.supabaseUrl, c.supabaseServiceKey);
    const agent = await store.getAgent(body.agentId);
    if (!agent) return NextResponse.json({ error: "Unknown agent identity." }, { status: 404 });
    // Same canonical-payload discipline as trades: sign first, touch nothing before it verifies.
    if (!verifyCloseSignature(body, agent.publicKey)) return NextResponse.json({ error: "Signature verification failed: the request does not match the ANS-registered public key." }, { status: 401 });
    if (!(await store.reserveNonce("close:" + body.closeId, body.closeId))) return NextResponse.json({ error: "Replay protection rejected a close that was already used." }, { status: 409 });
    const market = await store.getMarket(body.marketId);
    if (!market || market.status !== "open") return NextResponse.json({ error: "Market is not open." }, { status: 400 });
    // Exit pricing needs the deterministic walk, so only simulated markets are closable in this demo.
    const seed = market.subject.startsWith("Simulated 5-minute index B") ? 1 : market.subject.startsWith("Simulated 5-minute index") ? 0 : null;
    if (seed === null) return NextResponse.json({ error: "Close-out is only wired for the simulated markets in this demo." }, { status: 400 });
    // Net position comes from the append-only chain itself: buys minus prior closes on this market + outcome.
    const db = createClient(c.supabaseUrl, c.supabaseServiceKey, { auth: { persistSession: false } });
    const { data: rows, error } = await db.from("trade_decisions").select("amount, contracts").eq("agent_id", body.agentId).eq("market_id", body.marketId).eq("outcome", body.outcome).in("decision", ["allowed", "flagged"]);
    if (error) throw error;
    let bought = 0, closedAlready = 0, staked = 0;
    for (const r of rows ?? []) {
      const amount = Number(r.amount || 0), n = Number(r.contracts || 0);
      if (amount > 0) { bought += n; staked += amount; } else { closedAlready += n; }
    }
    const net = bought - closedAlready;
    if (net <= 0) return NextResponse.json({ error: "No open position on this market to close." }, { status: 400 });
    // Whole-position closes only, so the pool unwinds exactly the stake that built it.
    if (body.contracts !== net) return NextResponse.json({ error: `Close sells the whole open position: ${net} contracts.` }, { status: 400 });
    const priceCents = simPriceCents(seed);
    const unit = body.outcome === "A" ? priceCents / 100 : (100 - priceCents) / 100;
    const proceeds = Math.round(body.contracts * unit * 100) / 100;
    // Money moves first (pool -> trader over the withdrawal+deposit pair); if
    // the rail throws, no state changes and the position stays open.
    if (agent.walletId) {
      if (!c.nessieKey) throw new Error("NESSIE_API_KEY is not configured.");
      await new NessiePayments(c.nessieBaseUrl, c.nessieKey).transfer(c.poolAccountId, agent.walletId, proceeds, `Closed ${body.contracts} ${body.outcome} contract(s) on '${market.subject}'`);
    }
    await store.applyClearedTrade(body.marketId, body.outcome, -staked);
    // The chain is append-only, so the close is its own entry - a negative
    // amount renders as the money coming back, with the exit price in the reasons.
    const decision = await store.appendDecision({ tradeId: body.closeId, decision: "allowed", reasons: [`Position closed: sold ${body.contracts} ${body.outcome} contract(s) at ${body.outcome === "A" ? priceCents : 100 - priceCents}c for $${proceeds.toFixed(2)} via the ${c.nessieKey ? "nessie" : "demo"} rail.`], timestamp: new Date().toISOString(), agentId: body.agentId, marketId: body.marketId, marketSubject: market.subject, amount: -proceeds, outcome: body.outcome, contracts: body.contracts });
    return NextResponse.json({ closed: true, contracts: body.contracts, unitPrice: unit, proceeds, decision });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Close processing failed." }, { status: 503 });
  }
}

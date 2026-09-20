import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/config";

// wallet_id on the agent row is the durable link - browser storage is only a cache.
function db() {
  const c = supabaseConfig();
  return createClient(c.supabaseUrl, c.supabaseServiceKey);
}

// Server-side Nessie bridge: the API key stays on the server, the browser
// only ever sees the account fields it needs to render.
function nessieConfig() {
  const baseUrl = (process.env.NESSIE_BASE_URL || "https://prod-api.nessieisreal.com").replace(/\/$/, "");
  const key = process.env.NESSIE_API_KEY || "";
  return { baseUrl, key };
}

async function nessie(path: string, init?: RequestInit) {
  const { baseUrl, key } = nessieConfig();
  if (!key) throw new Error("NESSIE_API_KEY is not configured on the server.");
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${baseUrl}${path}${sep}key=${encodeURIComponent(key)}`, { cache: "no-store", ...init });
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw new Error(`Nessie ${r.status}: ${data?.message ?? text}`);
  return data;
}

// Nessie 201s wrap the new object in objectCreated on some lanes, return it flat on others.
const createdEntity = (data: any) => data?.objectCreated ?? data;

export async function GET(request: Request) {
  try {
    const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const a = await nessie(`/accounts/${encodeURIComponent(accountId)}`);
    // This Nessie deployment never moves the balance field - only the ledger
    // records change - so the effective balance is computed from the ledger.
    const [withdrawals, deposits] = await Promise.all([
      nessie(`/accounts/${encodeURIComponent(accountId)}/withdrawals`).catch(() => []),
      nessie(`/accounts/${encodeURIComponent(accountId)}/deposits`).catch(() => []),
    ]);
    const sum = (list: any[]) => (Array.isArray(list) ? list.reduce((t, r) => t + Number(r?.amount ?? 0), 0) : 0);
    const effective = Number(a.balance ?? 0) - sum(withdrawals) + sum(deposits);
    const ledger = [...(Array.isArray(withdrawals) ? withdrawals.map((r: any) => ({ ...r, kind: "withdrawal" })) : []), ...(Array.isArray(deposits) ? deposits.map((r: any) => ({ ...r, kind: "deposit" })) : [])]
      .sort((x, y) => String(y.transaction_date ?? "").localeCompare(String(x.transaction_date ?? "")))
      .slice(0, 20)
      .map((r: any) => ({ kind: r.kind, amount: Number(r.amount ?? 0), description: r.description ?? "", date: r.transaction_date ?? "" }));
    return NextResponse.json({ accountId: a._id ?? accountId, accountNumber: a.account_number ?? null, type: a.type ?? "Checking", nickname: a.nickname ?? "Nessie Checking", balance: effective, ledger, customerId: a.customer_id ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Nessie unavailable" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const type = body.type === "Savings" ? "Savings" : "Checking";
    const balance = Number(body.startingBalance);
    if (!Number.isFinite(balance) || balance < 0) return NextResponse.json({ error: "Invalid starting balance." }, { status: 400 });
    const parts = String(body.name || "Demo Trader").trim().split(/\s+/);
    const first = parts[0] || "Demo";
    const last = parts.slice(1).join(" ") || "Trader";
    // Nessie requires a mailing address on customer creation; sandbox address is fine.
    const customer = await nessie("/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ first_name: first, last_name: last, address: { street_number: "1", street_name: "Hackathon Way", city: "Blacksburg", state: "VA", zip: "24060" } }) });
    const customerId = createdEntity(customer)?._id;
    if (!customerId) throw new Error("Nessie did not return a customer id.");
    const account = await nessie(`/customers/${customerId}/accounts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, nickname: "Not An Insider Trading Account", rewards: 0, balance }) });
    const created = createdEntity(account);
    if (!created?._id) throw new Error("Nessie did not return an account id.");
    // Trader sessions persist the link on their agent row so any device finds it.
    if (typeof body.agentId === "string" && body.agentId) {
      // Only write into an empty slot - Disconnect is the only way to clear one,
      // so a stray Connect can never stomp a live wallet link.
      const { data: row, error: readErr } = await db().from("agent_identities").select("wallet_id").eq("agent_id", body.agentId).maybeSingle();
      if (readErr) throw new Error("Account created but wallet link check failed: " + readErr.message);
      if (row?.wallet_id) {
        // A link is only real if the account still exists at Nessie - a link
        // pointing at a deleted account is stale, so clear it and proceed.
        let stale = false;
        try {
          await nessie(`/accounts/${encodeURIComponent(row.wallet_id)}`);
        } catch {
          stale = true;
        }
        if (stale) {
          await db().from("agent_identities").update({ wallet_id: "" }).eq("agent_id", body.agentId);
        } else {
          await nessie(`/accounts/${encodeURIComponent(created._id)}`, { method: "DELETE" }).catch(() => null);
          return NextResponse.json({ error: "This trader already has a linked wallet. Disconnect it first." }, { status: 409 });
        }
      }
      const { error } = await db().from("agent_identities").update({ wallet_id: created._id }).eq("agent_id", body.agentId);
      if (error) throw new Error("Account created but wallet link failed: " + error.message);
    }
    return NextResponse.json({ accountId: created._id, customerId, type: created.type ?? type, nickname: created.nickname ?? "Not An Insider Trading Account", balance: Number(created.balance ?? balance) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Nessie unavailable" }, { status: 502 });
  }
}

// Dissociate: refund open-market trades from the pool, then delete the
// Nessie-side account and clear every wallet link to it. The refund has to
// land before the account exists no longer, so this order is load-bearing.
// With reset:true this becomes a demo reset instead: no refund is posted and
// the whole decision chain plus open-market pools are wiped for a fresh run.
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const accountId = String(body.accountId ?? "");
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const reset = body.reset === true;
    const poolId = process.env.NESSIE_POOL_ACCOUNT_ID || "";
    let refunded = 0;
    let cancelled = 0;
    let wiped = 0;
    if (reset) {
      // Demo reset: the hash chain is global, so a partial wipe would leave
      // dangling hash_prev links - wipe every decision and zero every open
      // pool instead, and the next demo run starts from a clean genesis.
      const { count } = await db().from("trade_decisions").select("trade_id", { count: "exact", head: true });
      await db().from("trade_decisions").delete().neq("trade_id", "00000000-0000-0000-0000-000000000000");
      await db().from("markets").update({ outcome_a_total: 0, outcome_b_total: 0 }).eq("status", "open");
      await db().from("agent_identities").update({ wallet_id: "" }).neq("wallet_id", "");
      wiped = count ?? 0;
    }
    if (poolId && !reset) {
      const { data: agents } = await db().from("agent_identities").select("agent_id").eq("wallet_id", accountId);
      for (const a of agents ?? []) {
        const { data: rows } = await db().from("trade_decisions").select("trade_id, market_id, outcome, amount").eq("agent_id", a.agent_id).in("decision", ["allowed", "flagged"]);
        const trades = (rows ?? []).filter(r => r.market_id && r.outcome && Number(r.amount) > 0);
        if (!trades.length) continue;
        // Only open markets can refund - a resolved market has settled.
        const { data: openRows } = await db().from("markets").select("market_id").eq("status", "open");
        const openIds = new Set((openRows ?? []).map(m => m.market_id));
        const refundable = trades.filter(t => openIds.has(t.market_id));
        if (!refundable.length) continue;
        const total = refundable.reduce((t, r) => t + Number(r.amount), 0);
        const stamp = { medium: "balance", transaction_date: new Date().toISOString().slice(0, 10), status: "completed" };
        const desc = `Refund of ${refundable.length} cleared trade(s) on account closure`;
        await nessie(`/accounts/${encodeURIComponent(poolId)}/withdrawals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...stamp, amount: total, description: desc }) });
        await nessie(`/accounts/${encodeURIComponent(accountId)}/deposits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...stamp, amount: total, description: desc }) });
        // Release the stakes from the pool so the odds unwind as well.
        for (const t of refundable) {
          await db().rpc("apply_cleared_trade", { p_market_id: t.market_id, p_outcome: t.outcome, p_amount: -Number(t.amount) });
        }
        // The hash chain is append-only, so the cancellation is its own entry.
        await db().rpc("append_trade_decision", { p_trade_id: crypto.randomUUID(), p_decision: "flagged", p_reasons: [`Account closed: ${refundable.length} cleared trade(s) cancelled and refunded ($${total.toFixed(2)}).`], p_timestamp: new Date().toISOString(), p_agent_id: a.agent_id, p_market_id: null, p_market_subject: null, p_amount: -total, p_outcome: null, p_contracts: null });
        refunded += total;
        cancelled += refundable.length;
      }
    }
    // A 404 here means the account was already gone - the link must still be
    // cleared, so a stale cache can never wedge a trader in "linked" state.
    let nessieDeleted = true;
    try {
      await nessie(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
    } catch {
      nessieDeleted = false;
    }
    // wallet_id is NOT NULL, so the empty slot is '' - and this write must be
    // checked, because a silent failure here is exactly how a trader wedges.
    const { error: unlinkErr } = await db().from("agent_identities").update({ wallet_id: "" }).eq("wallet_id", accountId);
    if (unlinkErr) throw new Error("Account deleted but wallet unlink failed: " + unlinkErr.message);
    return NextResponse.json({ deleted: true, nessieDeleted, reset, cancelledTrades: cancelled, refunded, wipedDecisions: wiped });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Nessie unavailable" }, { status: 502 });
  }
}

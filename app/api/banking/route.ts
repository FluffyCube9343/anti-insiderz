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
    return NextResponse.json({ accountId: a._id ?? accountId, accountNumber: a.account_number ?? null, type: a.type ?? "Checking", nickname: a.nickname ?? "Nessie Checking", balance: Number(a.balance ?? 0), customerId: a.customer_id ?? null });
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
      const { error } = await db().from("agent_identities").update({ wallet_id: created._id }).eq("agent_id", body.agentId);
      if (error) throw new Error("Account created but wallet link failed: " + error.message);
    }
    return NextResponse.json({ accountId: created._id, customerId, type: created.type ?? type, nickname: created.nickname ?? "Not An Insider Trading Account", balance: Number(created.balance ?? balance) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Nessie unavailable" }, { status: 502 });
  }
}

// Dissociate: delete the Nessie-side account and clear every wallet link to it.
export async function DELETE(request: Request) {
  try {
    const body = await request.json().catch(() => ({} as Record<string, unknown>));
    const accountId = String(body.accountId ?? "");
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    await nessie(`/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" });
    await db().from("agent_identities").update({ wallet_id: null }).eq("wallet_id", accountId);
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Nessie unavailable" }, { status: 502 });
  }
}

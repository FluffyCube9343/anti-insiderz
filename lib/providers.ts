import { createClient } from "@supabase/supabase-js";
import type { AgentIdentity, AnsRegistry, Market, Outcome, PaymentRail, TradeDecision, TradeStore } from "./domain";

export class SupabaseTradeStore implements TradeStore {
  private db;
  constructor(url: string, serviceKey: string) { this.db = createClient(url, serviceKey, { auth: { persistSession: false } }); }
  async getAgent(agentId: string): Promise<AgentIdentity | null> { const { data, error } = await this.db.from("agent_identities").select("*").eq("agent_id", agentId).maybeSingle(); if (error) throw error; return data && { agentId: data.agent_id, walletId: data.wallet_id, affiliations: data.affiliations, publicKey: data.public_key, registeredAt: data.registered_at, email: data.email ?? null, birthday: data.birthday ?? null, role: data.role ?? null }; }
  async getMarket(marketId: string): Promise<Market | null> { const { data, error } = await this.db.from("markets").select("*").eq("market_id", marketId).maybeSingle(); if (error) throw error; return data && { marketId: data.market_id, subject: data.subject, restrictedAffiliations: data.restricted_affiliations, pool: { outcomeA: Number(data.outcome_a_total), outcomeB: Number(data.outcome_b_total) }, status: data.status, materialEventAt: data.material_event_at }; }
  async reserveNonce(nonce: string, tradeId: string): Promise<boolean> { const { error } = await this.db.from("trade_nonces").insert({ nonce, trade_id: tradeId }); return !error; }
  async applyClearedTrade(marketId: string, outcome: Outcome, amount: number) { const { error } = await this.db.rpc("apply_cleared_trade", { p_market_id: marketId, p_outcome: outcome, p_amount: amount }); if (error) throw error; }
  async appendDecision(input: Omit<TradeDecision, "hashPrev" | "hash">): Promise<TradeDecision> {
    const { data, error } = await this.db.rpc("append_trade_decision", { p_trade_id: input.tradeId, p_decision: input.decision, p_reasons: input.reasons, p_timestamp: input.timestamp }).single(); if (error) throw error;
    const row = data as { trade_id: string; decision: TradeDecision["decision"]; reasons: string[]; created_at: string; hash_prev: string | null; hash: string };
    return { tradeId: row.trade_id, decision: row.decision, reasons: row.reasons, timestamp: row.created_at, hashPrev: row.hash_prev, hash: row.hash };
  }
}

export class NessiePayments implements PaymentRail {
  constructor(private baseUrl: string, private key: string) {}
  private async request(path: string, init?: RequestInit) { const r = await fetch(`${this.baseUrl}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(this.key)}`, init); if (!r.ok) throw new Error(`Nessie ${r.status}: ${await r.text()}`); return r; }
  async balance(accountId: string) { const data = await (await this.request(`/accounts/${encodeURIComponent(accountId)}`)).json() as { balance: number }; if (typeof data.balance !== "number") throw new Error("Nessie account response did not contain a numeric balance."); return data.balance; }
  async transfer(fromAccountId: string, toAccountId: string, amount: number, description: string) { await this.request(`/accounts/${encodeURIComponent(fromAccountId)}/transfers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ medium: "balance", payee_id: toAccountId, amount, description }) }); }
}

export class AnsHttpRegistry implements AnsRegistry {
  constructor(private baseUrl: string, private key: string, private secret: string, private template: string) {}
  async validate(agent: AgentIdentity) {
    const agentId = agent.agentId.replace(/^ans:\/\//, ""); const endpoint = this.template.replace("{agentId}", encodeURIComponent(agentId));
    const r = await fetch(`${this.baseUrl}${endpoint}`, { headers: { Authorization: `sso-key ${this.key}:${this.secret}`, Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return { valid: false, reason: `ANS returned HTTP ${r.status}` };
    const data = await r.json() as Record<string, unknown>;
    // agentStatus comes back as a plain string on /v1/agents/{id}, an object on other lanes; accept both plus flat shapes.
    const rawStatus = data.agentStatus;
    const status = String(typeof rawStatus === "string" ? rawStatus : ((rawStatus as Record<string, unknown> | null)?.status ?? data.status ?? data.lifecycleStatus ?? "")).toUpperCase();
    const expiresAt = String(typeof rawStatus === "object" && rawStatus ? ((rawStatus as Record<string, unknown>).expiresAt ?? "") : (data.expiresAt ?? ""));
    if (status !== "ACTIVE") return { valid: false, reason: `ANS lifecycle status is ${status || "missing"}` };
    // 0001-01-01 is the registry's zero time, not a real expiry.
    const exp = new Date(expiresAt);
    if (expiresAt && Number.isFinite(exp.getTime()) && exp.getFullYear() > 2000 && exp <= new Date()) return { valid: false, reason: "ANS registration has expired" };
    // Public key extraction is deployment-specific; only compare when the RA returns it explicitly.
    return { valid: true, publicKey: typeof data.publicKey === "string" ? data.publicKey : undefined };
  }
}

// Demo-only rail used when NESSIE_API_KEY is unset: every wallet looks funded and no money actually moves.
export class DemoPayments implements PaymentRail {
  async balance(_accountId: string) { return 1_000_000; }
  async transfer(_fromAccountId: string, _toAccountId: string, _amount: number, _description: string) { /* intentionally empty: demo mode */ }
}

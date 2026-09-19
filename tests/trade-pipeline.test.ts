import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalTradePayload } from "../lib/crypto";
import { TradePipeline } from "../lib/trade-pipeline";
import type { AgentIdentity, AnsRegistry, Market, PaymentRail, TradeDecision, TradeRequest, TradeStore } from "../lib/domain";

class MemoryStore implements TradeStore {
  nonces = new Set<string>(); decisions: TradeDecision[] = []; pool = { outcomeA: 0, outcomeB: 0 };
  constructor(readonly agent: AgentIdentity, readonly market: Market) {}
  async getAgent(id: string) { return id === this.agent.agentId ? this.agent : null; }
  async getMarket(id: string) { return id === this.market.marketId ? { ...this.market, pool: this.pool } : null; }
  async reserveNonce(nonce: string) { if (this.nonces.has(nonce)) return false; this.nonces.add(nonce); return true; }
  async applyClearedTrade(_: string, outcome: "A" | "B", amount: number) { if (outcome === "A") this.pool.outcomeA += amount; else this.pool.outcomeB += amount; }
  async appendDecision(input: Omit<TradeDecision, "hashPrev" | "hash">) { const result = { ...input, hashPrev: this.decisions.at(-1)?.hash ?? null, hash: `hash-${this.decisions.length}` }; this.decisions.push(result); return result; }
}
const key = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const clean: AgentIdentity = { agentId: "ans://clean.demo", walletId: "clean-wallet", affiliations: [], publicKey: key.publicKey.export({ type: "pkcs1", format: "pem" }).toString(), registeredAt: new Date().toISOString() };
const market: Market = { marketId: "market-1", subject: "Team A wins", restrictedAffiliations: ["Team A"], pool: { outcomeA: 0, outcomeB: 0 }, status: "open", materialEventAt: null };
const ans: AnsRegistry = { validate: async () => ({ valid: true, publicKey: clean.publicKey }) };
const payments: PaymentRail = { balance: async () => 100, transfer: async () => undefined };
function signed(agent = clean, nonce = crypto.randomUUID()): TradeRequest { const base = { tradeId: crypto.randomUUID(), agentId: agent.agentId, marketId: market.marketId, outcome: "A" as const, amount: 10, nonce, timestamp: new Date().toISOString() }; return { ...base, signature: crypto.sign("RSA-SHA256", Buffer.from(canonicalTradePayload(base)), key.privateKey).toString("base64") }; }

describe("six-step trade pipeline", () => {
  it("clears a correctly signed, solvent, clean trade and updates the pari-mutuel pool", async () => { const store = new MemoryStore(clean, market); const result = await new TradePipeline(store, ans, payments, "pool", 60).execute(signed()); expect(result.decision).toBe("allowed"); expect(store.pool.outcomeA).toBe(10); expect(result.reasons[0]).toContain("All six checks passed"); });
  it("hard-blocks an affiliated Team A trader and records the exact reason", async () => { const affiliated = { ...clean, agentId: "ans://team-a.demo", affiliations: ["Team A"] }; const store = new MemoryStore(affiliated, market); const result = await new TradePipeline(store, ans, payments, "pool", 60).execute(signed(affiliated)); expect(result.decision).toBe("blocked"); expect(result.reasons.join(" ")).toContain('restricted party "Team A"'); expect(store.pool.outcomeA).toBe(0); });
  it("rejects a replayed nonce on the second request", async () => { const store = new MemoryStore(clean, market); const pipeline = new TradePipeline(store, ans, payments, "pool", 60); const nonce = crypto.randomUUID(); expect((await pipeline.execute(signed(clean, nonce))).decision).toBe("allowed"); expect((await pipeline.execute(signed(clean, nonce))).reasons.join(" ")).toContain("Replay protection rejected"); });
});

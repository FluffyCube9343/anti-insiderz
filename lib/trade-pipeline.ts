import { verifyTradeSignature } from "./crypto";
import type { AnsRegistry, DecisionKind, PaymentRail, TradeDecision, TradeRequest, TradeStore } from "./domain";

export class TradePipeline {
  constructor(private readonly store: TradeStore, private readonly ans: AnsRegistry, private readonly payments: PaymentRail, private readonly poolAccountId: string, private readonly timingWindowMinutes: number) {}

  async execute(trade: TradeRequest): Promise<TradeDecision> {
    const reasons: string[] = [];
    const block = async (reason: string) => this.record(trade.tradeId, "blocked", [...reasons, reason]);
    const agent = await this.store.getAgent(trade.agentId);
    if (!agent) return block("Unknown agent identity.");
    // 1. Verify an exact canonical payload before touching replay state.
    if (!verifyTradeSignature(trade, agent.publicKey)) return block("Signature verification failed: the request does not match the ANS-registered public key.");
    // 2. Atomic uniqueness is enforced by the database.
    if (!(await this.store.reserveNonce(trade.nonce, trade.tradeId))) return block("Replay protection rejected a nonce that was already used.");
    // 3. Registry must say that this identity is currently valid; a changed key is a hard failure.
    let registration;
    try { registration = await this.ans.validate(agent); } catch (error) { return block(`ANS identity validation could not be completed: ${error instanceof Error ? error.message : "unknown registry error"}`); }
    if (!registration.valid) return block(`ANS identity validation failed${registration.reason ? `: ${registration.reason}` : "."}`);
    if (registration.publicKey && registration.publicKey.trim() !== agent.publicKey.trim()) return block("ANS identity validation failed: the registry public key differs from the registered key.");
    const market = await this.store.getMarket(trade.marketId);
    if (!market || market.status !== "open") return block("Market is not open for trading.");
    // 4. A declared affiliation match is a hard exclusion - checked before any money movement.
    const forbidden = agent.affiliations.find(a => market.restrictedAffiliations.some(r => r.toLowerCase() === a.toLowerCase()));
    if (forbidden) return block(`Affiliation check blocked trade: agent is affiliated with restricted party \"${forbidden}\".`);
    // 4b. Minors cannot trade on any market, regardless of affiliation.
    if (agent.birthday) {
      const ageYears = (Date.now() - new Date(agent.birthday).getTime()) / (365.25 * 24 * 3600 * 1000);
      if (ageYears < 18) return block("Age check blocked trade: account holder is under 18 and cannot trade on any market.");
    }
    // 5. Never submit a transfer without an observed sufficient balance.
    let balance: number;
    try { balance = await this.payments.balance(agent.walletId); } catch (error) { return block(`Solvency check could not be completed: ${error instanceof Error ? error.message : "unknown Nessie error"}`); }
    if (balance < trade.amount) return block(`Solvency check failed: available balance ${balance} is less than requested amount ${trade.amount}.`);
    // 6. Timing is auditable but intentionally non-blocking.
    const inWindow = market.materialEventAt && new Date(market.materialEventAt).getTime() - new Date(trade.timestamp).getTime() <= this.timingWindowMinutes * 60_000 && new Date(market.materialEventAt).getTime() >= new Date(trade.timestamp).getTime();
    if (inWindow) reasons.push(`Timing flag: trade is within ${this.timingWindowMinutes} minutes of the material event.`);
    try { await this.payments.transfer(agent.walletId, this.poolAccountId, trade.amount, `Prediction-market trade ${trade.tradeId}`); await this.store.applyClearedTrade(trade.marketId, trade.outcome, trade.amount); }
    catch (error) { return block(`Trade execution failed after checks passed: ${error instanceof Error ? error.message : "unknown payment or pool error"}`); }
    return this.record(trade.tradeId, inWindow ? "flagged" : "allowed", reasons.length ? reasons : [`All six checks passed; transfer cleared and market pool updated via the ${(this.payments as { rail?: string }).rail ?? "unknown"} rail.`]);
  }

  private record(tradeId: string, decision: DecisionKind, reasons: string[]) { return this.store.appendDecision({ tradeId, decision, reasons, timestamp: new Date().toISOString() }); }
}

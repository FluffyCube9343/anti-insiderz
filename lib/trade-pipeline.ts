import { verifyTradeSignature } from "./crypto";
import { isTrade } from "./validation";
import type { AnsRegistry, PaymentRail, TradeRequest, TradeResult, TradeStore } from "./domain";
import { settleEvidence, paymentDescription } from "./payments";

export class TradePipeline {
  constructor(private store:TradeStore,private ans:AnsRegistry,private payments:PaymentRail,private pool:()=>string,private windowMinutes:number,private now=()=>Date.now()) {}
  async execute(trade:TradeRequest):Promise<TradeResult> {
    if(!isTrade(trade))throw new Error("Invalid trade request.");
    const block=(reason:string)=>this.store.appendDecision(trade,"blocked",[reason]);
    const agent=await this.store.getAgent(trade.agentId);
    if(!agent)return block("Identity lookup: no provisioned agent matches this ANS URI.");
    try {
      // 1: Bind the verification key to a live certificate fetched from the trusted ANS registry.
      const key=await this.ans.publicKey(agent);
      if(!verifyTradeSignature(trade,key))return block("Gate 1: signature verification failed.");
    } catch { return block("Gate 1: could not verify the registered identity certificate/key. Check ANS configuration and certificate validity."); }
    try {
      // 2: Atomic database uniqueness protects both nonce and trade ID.
      if(!await this.store.reserveNonce(trade.nonce,trade.tradeId))return block("Gate 2: replay rejected; nonce or trade ID already used.");
    } catch { return block("Gate 2: replay store unavailable; no payment attempted."); }
    if(Math.abs(this.now()-Date.parse(trade.timestamp))>300000)return block("Gate 2: signed timestamp is outside the five-minute freshness window.");
    try {
      // 3: Fetch lifecycle state after nonce consumption; revocation cannot be bypassed.
      const registration=await this.ans.validate(agent);
      if(!registration.valid)return block("Gate 3: "+registration.reason);
    } catch { return block("Gate 3: live ANS status could not be confirmed."); }
    try {
      // 4
      if(await this.payments.balance(agent.walletId)<trade.amount)return block("Gate 4: insufficient Nessie account balance.");
    } catch { return block("Gate 4: Nessie balance unavailable; check credentials and connectivity."); }
    const market=await this.store.getMarket(trade.marketId);
    if(!market || market.status!=="open")return block("Market is not open.");
    // 5
    const overlap=agent.affiliations.find(a=>market.restrictedAffiliations.some(r=>r.trim().toLowerCase()===a.trim().toLowerCase()));
    if(overlap)return block(`Gate 5: affiliation "${overlap}" is restricted on this market.`);
    // 6: Use server arrival time, never a trader-controlled timestamp, for the timing flag.
    const delta=market.materialEventAt ? Date.parse(market.materialEventAt)-this.now():Infinity;
    const flagged=delta>=0 && delta<=this.windowMinutes*60000;
    const reasons=flagged?[`Gate 6: within ${this.windowMinutes} minutes before the material event.`]:["All six gates passed."];
    let job;
    try { job=await this.store.prepare(trade,this.pool(),reasons,flagged); }
    catch { return block("Execution reservation failed: market changed, wallet has an unresolved payment, or payment configuration is missing. No transfer attempted."); }
    try {
      // Recheck balance while holding the durable payer reservation to serialize this app's spending.
      if(await this.payments.balance(job.payer)<trade.amount) {
        const result=await this.store.finish(job.id,"failed",null,"Balance changed before execution; no payment sent.");
        return {tradeId:job.id,decision:"blocked",reasons:result.decision?.reasons || ["Insufficient balance."],paymentStatus:"failed"};
      }
      const transfer=await this.payments.transfer(job.payer,job.payee,Number(job.amount),paymentDescription(job));
      const result=await settleEvidence(this.store,job,transfer);
      return {tradeId:job.id,decision:result.decision?.decision || "flagged",reasons:result.decision?.reasons || ["Payment state recorded."],paymentStatus:result.state};
    } catch {
      // Do not repeat POST after an ambiguous result. The persisted intent survives process crashes.
      const result=await this.store.finish(job.id,"review",null,"Payment outcome uncertain. Reconcile this intent; do not resubmit funds.");
      return {tradeId:job.id,decision:"flagged",reasons:result.decision?.reasons || ["Payment requires reconciliation."],paymentStatus:"review"};
    }
  }
}

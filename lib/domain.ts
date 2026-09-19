export type Outcome = "A" | "B";
export type DecisionKind = "allowed" | "blocked" | "flagged";

export interface AgentIdentity { agentId: string; registryId: string; displayName: string; walletId: string; affiliations: string[]; publicKey: string; registeredAt: string; }
export interface Market { marketId: string; subject: string; restrictedAffiliations: string[]; pool: { outcomeA: number; outcomeB: number }; status: "open" | "resolving" | "resolved"; materialEventAt: string | null; winningOutcome?: Outcome; }
export interface TradeRequest { tradeId: string; agentId: string; marketId: string; outcome: Outcome; amount: number; nonce: string; timestamp: string; signature: string; }
export interface TradeDecision { tradeId: string; decision: DecisionKind; reasons: string[]; timestamp: string; hashPrev: string | null; hash: string; sequence?: number; }
export type PaymentState = "queued" | "sending" | "pending" | "review" | "settled" | "failed";
export interface PaymentJob { id: string; market_id: string; agent_id: string; kind: "trade" | "payout"; payer: string; payee: string; amount: number; state: PaymentState; transfer_id: string | null; request: TradeRequest | null; decision?: TradeDecision; }
export interface TradeResult { tradeId: string; decision: DecisionKind; reasons: string[]; paymentStatus?: PaymentState; }

export interface TradeStore {
  getAgent(agentId: string): Promise<AgentIdentity | null>;
  getMarket(marketId: string): Promise<Market | null>;
  reserveNonce(nonce: string, tradeId: string): Promise<boolean>;
  prepare(trade: TradeRequest, pool: string, reasons: string[], flag: boolean): Promise<PaymentJob>;
  finish(id: string, state: PaymentState, transferId: string | null, reason: string): Promise<PaymentJob>;
  appendDecision(trade: TradeRequest, decision: DecisionKind, reasons: string[]): Promise<TradeDecision>;
}

export interface AnsRegistry { publicKey(agent: AgentIdentity): Promise<string>; validate(agent: AgentIdentity): Promise<{ valid: boolean; reason?: string }>; }
export interface Transfer { id: string; status: "pending" | "executed" | "cancelled"; payer: string; payee: string; amount: number; description: string; }
export interface PaymentRail { balance(accountId: string): Promise<number>; transfer(fromAccountId: string, toAccountId: string, amount: number, description: string): Promise<Transfer>; getTransfer(id: string): Promise<Transfer>; findTransfer(payer: string, description: string): Promise<Transfer | null>; }

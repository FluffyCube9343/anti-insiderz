export type Outcome = "A" | "B";
export type DecisionKind = "allowed" | "blocked" | "flagged";

export interface AgentIdentity { agentId: string; walletId: string; affiliations: string[]; publicKey: string; registeredAt: string; email?: string | null; birthday?: string | null; role?: string | null; }
export interface Market { marketId: string; subject: string; restrictedAffiliations: string[]; pool: { outcomeA: number; outcomeB: number }; status: "open" | "resolved"; materialEventAt: string | null; }
export interface TradeRequest { tradeId: string; agentId: string; marketId: string; outcome: Outcome; amount: number; nonce: string; timestamp: string; signature: string; }
export interface TradeDecision { tradeId: string; decision: DecisionKind; reasons: string[]; timestamp: string; hashPrev: string | null; hash: string; }

export interface TradeStore {
  getAgent(agentId: string): Promise<AgentIdentity | null>;
  getMarket(marketId: string): Promise<Market | null>;
  reserveNonce(nonce: string, tradeId: string): Promise<boolean>;
  applyClearedTrade(marketId: string, outcome: Outcome, amount: number): Promise<void>;
  appendDecision(decision: Omit<TradeDecision, "hashPrev" | "hash">): Promise<TradeDecision>;
}

export interface AnsRegistry { validate(agent: AgentIdentity): Promise<{ valid: boolean; publicKey?: string; reason?: string }>; }
export interface PaymentRail { balance(accountId: string): Promise<number>; transfer(fromAccountId: string, toAccountId: string, amount: number, description: string): Promise<void>; }

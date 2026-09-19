import crypto from "node:crypto";
import type { TradeRequest } from "./domain";

export function canonicalTradePayload(trade: Omit<TradeRequest, "signature">): string {
  return JSON.stringify({ tradeId: trade.tradeId, agentId: trade.agentId, marketId: trade.marketId, outcome: trade.outcome, amount: trade.amount, nonce: trade.nonce, timestamp: trade.timestamp });
}

export function verifyTradeSignature(trade: TradeRequest, publicKey: string): boolean {
  try { return crypto.verify("RSA-SHA256", Buffer.from(canonicalTradePayload(trade)), publicKey, Buffer.from(trade.signature, "base64")); } catch { return false; }
}

export function sha256(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }

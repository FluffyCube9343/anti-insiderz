import crypto from "node:crypto";
import type { CloseRequest, TradeRequest } from "./domain";

export function canonicalTradePayload(trade: Omit<TradeRequest, "signature">): string {
  return JSON.stringify({ tradeId: trade.tradeId, agentId: trade.agentId, marketId: trade.marketId, outcome: trade.outcome, amount: trade.amount, nonce: trade.nonce, timestamp: trade.timestamp });
}

export function verifyTradeSignature(trade: TradeRequest, publicKey: string): boolean {
  try { return crypto.verify("RSA-SHA256", Buffer.from(canonicalTradePayload(trade)), publicKey, Buffer.from(trade.signature, "base64")); } catch { return false; }
}

export function sha256(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }

export function canonicalClosePayload(close: Omit<CloseRequest, "signature">): string {
  return JSON.stringify({ closeId: close.closeId, agentId: close.agentId, marketId: close.marketId, outcome: close.outcome, contracts: close.contracts, timestamp: close.timestamp });
}

export function verifyCloseSignature(close: CloseRequest, publicKey: string): boolean {
  try { return crypto.verify("RSA-SHA256", Buffer.from(canonicalClosePayload(close)), publicKey, Buffer.from(close.signature, "base64")); } catch { return false; }
}

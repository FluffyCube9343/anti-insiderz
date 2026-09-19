import crypto from "node:crypto";
import type { TradeRequest } from "./domain";

export function canonicalTradePayload(trade: Omit<TradeRequest, "signature">): string {
  return JSON.stringify({ tradeId: trade.tradeId, agentId: trade.agentId, marketId: trade.marketId, outcome: trade.outcome, amount: trade.amount, nonce: trade.nonce, timestamp: trade.timestamp });
}

export function verifyTradeSignature(trade: TradeRequest, publicKey: string): boolean {
  try {
    const key=crypto.createPublicKey(publicKey);
    if(key.asymmetricKeyType==="rsa")return crypto.verify("sha256",Buffer.from(canonicalTradePayload(trade)),key,Buffer.from(trade.signature,"base64"));
    if(key.asymmetricKeyType==="ec" && key.asymmetricKeyDetails?.namedCurve==="prime256v1")return crypto.verify("sha256",Buffer.from(canonicalTradePayload(trade)),{key,dsaEncoding:"ieee-p1363"},Buffer.from(trade.signature,"base64"));
    return false;
  } catch { return false; }
}

export function sha256(value: string): string { return crypto.createHash("sha256").update(value).digest("hex"); }

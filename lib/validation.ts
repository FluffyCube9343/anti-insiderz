import type { TradeRequest } from "./domain";
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isTrade(value: unknown): value is TradeRequest {
  if (!value || typeof value !== "object") return false;
  const t = value as TradeRequest;
  return uuid.test(t.tradeId) && uuid.test(t.marketId) && typeof t.agentId === "string" && /^ans:\/\/[a-z0-9.-]+$/i.test(t.agentId) && t.agentId.length <= 300 &&
    (t.outcome === "A" || t.outcome === "B") && typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount > 0 && t.amount <= 10000 && Math.abs(t.amount * 100 - Math.round(t.amount * 100)) < 1e-7 &&
    typeof t.nonce === "string" && /^[a-zA-Z0-9_-]{16,128}$/.test(t.nonce) && typeof t.timestamp === "string" && Number.isFinite(Date.parse(t.timestamp)) &&
    typeof t.signature === "string" && t.signature.length >= 40 && t.signature.length <= 2048 && /^[A-Za-z0-9+/]+={0,2}$/.test(t.signature);
}

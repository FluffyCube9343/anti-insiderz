// Sign and submit a real trade as one of the registered trader agents.
// Usage: node scripts/sign-trade.mjs <traderDir> <marketId> <A|B> <amount>
// Example: node scripts/sign-trade.mjs agents/trader4 10000000-0000-4000-8000-000000000004 A 10
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [dir, marketId, outcome, amountStr] = process.argv.slice(2);
if (!dir || !marketId || !outcome || !amountStr) {
  console.error("Usage: node scripts/sign-trade.mjs <traderDir> <marketId> <A|B> <amount>");
  process.exit(1);
}

const agentId = fs.readFileSync(path.join(dir, "agent_id"), "utf8").trim();

// ans-cli writes the private key next to the CSRs under its own name, so probe the certs dir for whatever parses as a private key.
const certsDir = path.join(dir, "certs");
const candidates = fs.readdirSync(certsDir).filter(f => /\.(key|pem)$/i.test(f) || !/\.(csr|crt|json)$/i.test(f));
let privateKey = null, keyFile = null;
for (const f of candidates) {
  try {
    const pem = fs.readFileSync(path.join(certsDir, f), "utf8");
    crypto.createPrivateKey(pem);
    privateKey = pem; keyFile = f; break;
  } catch { /* not a private key, keep looking */ }
}
if (!privateKey) {
  console.error(`No private key found in ${certsDir} - expected the identity key ans-cli generated during register.sh (files present: ${candidates.join(", ") || "none"})`);
  process.exit(1);
}

const trade = {
  tradeId: crypto.randomUUID(),
  agentId,
  marketId,
  outcome,
  amount: Number(amountStr),
  nonce: crypto.randomUUID(),
  timestamp: new Date().toISOString(),
};

// Must match lib/crypto.ts canonicalTradePayload exactly (key order matters).
const canonical = JSON.stringify({
  tradeId: trade.tradeId, agentId: trade.agentId, marketId: trade.marketId,
  outcome: trade.outcome, amount: trade.amount, nonce: trade.nonce, timestamp: trade.timestamp,
});
const signature = crypto.sign("sha256", Buffer.from(canonical), privateKey).toString("base64");

const base = process.env.APP_BASE_URL || "http://localhost:3000";
const r = await fetch(`${base}/api/trades`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...trade, signature }),
});
console.log(`signed with ${keyFile}`);
console.log(r.status, JSON.stringify(await r.json(), null, 2));

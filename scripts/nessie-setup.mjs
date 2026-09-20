// One-time demo wiring: create a real Nessie account per trader + a market
// pool account, then point each Supabase agent's wallet_id at its Nessie
// account so the trade pipeline's solvency check and transfers hit real rails.
// Run: node scripts/nessie-setup.mjs   (reads .env.local)
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// .env.local uses `export KEY=value` lines; strip the prefix for plain node.
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}

const NESSIE = (process.env.NESSIE_BASE_URL || "https://prod-api.nessieisreal.com").replace(/\/$/, "");
const KEY = process.env.NESSIE_API_KEY;
if (!KEY) throw new Error("NESSIE_API_KEY missing from .env.local");

async function nessie(path, body) {
  const r = await fetch(`${NESSIE}${path}?key=${encodeURIComponent(KEY)}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Nessie ${r.status}: ${data?.message ?? "unknown"}`);
  return data?.objectCreated ?? data;
}

async function makeAccount(first, last, nickname, balance) {
  const customer = await nessie("/customers", { first_name: first, last_name: last, address: { street_number: "1", street_name: "Hackathon Way", city: "Blacksburg", state: "VA", zip: "24060" } });
  const account = await nessie(`/customers/${customer._id}/accounts`, { type: "Checking", nickname, rewards: 0, balance });
  console.log(`  ${nickname}: account ${account._id} ($${balance})`);
  return account._id;
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: agents, error } = await db.from("agent_identities").select("agent_id, full_name, wallet_id");
if (error) throw error;

for (const agent of agents) {
  const [first, ...rest] = (agent.full_name || "Demo Trader").split(" ");
  const walletId = await makeAccount(first, rest.join(" ") || "Trader", `NAI wallet - ${agent.full_name ?? agent.agent_id}`, 10000);
  const { error: upErr } = await db.from("agent_identities").update({ wallet_id: walletId }).eq("agent_id", agent.agent_id);
  if (upErr) throw upErr;
  console.log(`  -> agent ${agent.agent_id} wallet_id set`);
}

const poolId = await makeAccount("Market", "Pool", "NAI market pool", 0);
console.log(`\nAdd to .env.local:\nexport NESSIE_POOL_ACCOUNT_ID=${poolId}`);

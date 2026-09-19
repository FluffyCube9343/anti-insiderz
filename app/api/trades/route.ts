import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { AnsHttpRegistry, NessiePayments, SupabaseTradeStore } from "@/lib/providers";
import { TradePipeline } from "@/lib/trade-pipeline";
import type { TradeRequest } from "@/lib/domain";

function validTrade(value: unknown): value is TradeRequest { const x = value as Record<string, unknown>; return !!x && ["tradeId", "agentId", "marketId", "nonce", "timestamp", "signature"].every(k => typeof x[k] === "string" && x[k]) && (x.outcome === "A" || x.outcome === "B") && typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount > 0; }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!validTrade(body)) return NextResponse.json({ error: "A signed trade requires tradeId, agentId, marketId, outcome, positive amount, nonce, timestamp, and signature." }, { status: 400 });
  try { const c = config(); const pipeline = new TradePipeline(new SupabaseTradeStore(c.supabaseUrl, c.supabaseServiceKey), new AnsHttpRegistry(c.ansBaseUrl, c.ansKey, c.ansSecret, c.ansLookupTemplate), new NessiePayments(c.nessieBaseUrl, c.nessieKey), c.poolAccountId, c.timingWindowMinutes); return NextResponse.json(await pipeline.execute(body)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Trade processing failed." }, { status: 503 }); }
}

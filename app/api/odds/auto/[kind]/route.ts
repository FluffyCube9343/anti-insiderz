// app/api/odds/auto/[kind]/route.ts
// btc | eth: resolve the CURRENT rolling 5-minute Polymarket up/down market
// vt0 | vt1: resolve the nearest upcoming Virginia Tech football game markets (0 = next, 1 = after that)
import { NextResponse } from "next/server";

const SERIES: Record<string, string> = { btc: "10684", eth: "10683" };

async function rolling5m(kind: string) {
  const seriesId = SERIES[kind];
  const now = new Date();
  const max = new Date(now.getTime() + 15 * 60_000);
  const u = new URL("https://gamma-api.polymarket.com/events");
  u.search = new URLSearchParams({
    series_id: seriesId,
    end_date_min: now.toISOString(),
    end_date_max: max.toISOString(),
    limit: "10",
    order: "endDate",
    ascending: "true",
  }).toString();
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(5000) });
  if (!r.ok) return NextResponse.json({ error: `Polymarket ${r.status}` }, { status: 502 });
  const events = await r.json();
  const t = now.getTime();
  const current = events.find((e: any) =>
    Date.parse(e.startTime) <= t && t < Date.parse(e.endDate) && e.active && !e.closed
  ) || events.find((e: any) => Date.parse(e.startTime) > t && e.active && !e.closed);
  const market = current?.markets?.[0];
  if (!market) return NextResponse.json({ error: "no active 5m market found" }, { status: 404 });
  const outcomes: string[] = JSON.parse(market.outcomes || "[]");
  const prices: string[] = JSON.parse(market.outcomePrices || "[]");
  return NextResponse.json({
    question: market.question,
    slug: market.slug,
    outcomes: outcomes.map((name, i) => ({ name, price: Number(prices[i]) })),
    updatedAt: market.updatedAt,
    close: current.endDate,
  });
}

async function vtGame(n: number) {
  const u = new URL("https://gamma-api.polymarket.com/public-search");
  u.search = new URLSearchParams({ q: "Virginia Tech football", limit_per_type: "20" }).toString();
  const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!r.ok) return NextResponse.json({ error: `Polymarket ${r.status}` }, { status: 502 });
  const data = await r.json();
  const now = Date.now();
  const games = (data.events || [])
    .filter((e: any) => !e.closed && Date.parse(e.endDate) > now)
    .filter((e: any) => /virginia tech/i.test(e.title || "") && /vs\.?/i.test(e.title || ""))
    .sort((a: any, b: any) => Date.parse(a.endDate) - Date.parse(b.endDate));
  const event = games[n];
  const market = event?.markets?.[0];
  if (!market) return NextResponse.json({ error: "no upcoming VT game market posted yet" }, { status: 404 });
  const outcomes: string[] = JSON.parse(market.outcomes || "[]");
  const prices: string[] = JSON.parse(market.outcomePrices || "[]");
  return NextResponse.json({
    question: market.question || event.title,
    slug: market.slug,
    outcomes: outcomes.map((name, i) => ({ name, price: Number(prices[i]) })),
    updatedAt: market.updatedAt,
    close: event.endDate,
  });
}

export async function GET(_req: Request, { params }: { params: { kind: string } }) {
  const { kind } = params;
  const k = kind.toLowerCase();
  try {
  if (k === "btc" || k === "eth") return await rolling5m(k);
  if (k === "vt0") return await vtGame(0);
  if (k === "vt1") return await vtGame(1);
  return NextResponse.json({ error: "unknown kind, use btc, eth, vt0, vt1" }, { status: 404 });
  } catch {return NextResponse.json({error:"Polymarket reference odds unavailable"},{status:502});}
}

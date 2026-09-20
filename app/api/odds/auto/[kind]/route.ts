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

// sim5 / sim5b: fake rolling 5-minute markets for demo purposes. A true
// random walk in whole cents, replayed from a fixed epoch: each 10-second
// bucket takes a deterministic 1-3c step (hash of bucket index XOR a
// per-market seed), with the direction biased back toward 50c the further it
// strays. Stateless, so every viewer sees the SAME quote, and the rails at
// 10c/90c can never be crossed. seed 0 reproduces the original sim5 path
// exactly; seed 1 is an independent walk for the second card.
function sim5m(seed: number, tag: string) {
  const bucketMs = 10_000;
  const epoch = Math.floor(Date.parse("2026-09-19T00:00:00-04:00") / bucketMs);
  const now = Math.floor(Date.now() / bucketMs);
  const hash = (n: number) => { let x = ((n ^ (seed * 0x9e3779b9)) * 2654435761) >>> 0; x ^= x >>> 15; x = (x * 2246822519) >>> 0; x ^= x >>> 13; return x >>> 0; };
  let p = 50; // cents
  for (let i = epoch; i <= now; i++) {
    const r = hash(i);
    const step = 1 + (r % 3); // 1-3 cents per bucket
    const homeBias = 50 + Math.round(((50 - p) * 60) / 40); // 50/50 at mean, pinned at the rails
    p += (r % 100) < homeBias ? step : -step;
    p = Math.min(90, Math.max(10, p));
  }
  const windowEnd = new Date(Math.ceil(Date.now() / 300_000) * 300_000);
  return NextResponse.json({
    question: `Simulated 5-minute index${tag}: up or down at window close?`,
    slug: `sim-5m-index${tag === "" ? "" : "-b"}`,
    outcomes: [{ name: "Up", price: p / 100 }, { name: "Down", price: (100 - p) / 100 }],
    updatedAt: new Date().toISOString(),
    close: windowEnd.toISOString(),
  });
}

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const k = kind.toLowerCase();
  if (k === "btc" || k === "eth") return rolling5m(k);
  if (k === "vt0") return vtGame(0);
  if (k === "vt1") return vtGame(1);
  if (k === "sim5") return sim5m(0, "");
  if (k === "sim5b") return sim5m(1, " B");
  return NextResponse.json({ error: "unknown kind, use btc, eth, vt0, vt1, sim5, sim5b" }, { status: 404 });
}

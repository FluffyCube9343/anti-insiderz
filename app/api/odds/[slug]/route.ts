// app/api/odds/[slug]/route.ts - live Polymarket odds, no auth
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await fetch(
    `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`,
    { next: { revalidate: 10 }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return NextResponse.json({ error: `Polymarket ${r.status}` }, { status: 502 });
  const m = await r.json();
  const outcomes: string[] = JSON.parse(m.outcomes || "[]");
  const prices: string[] = JSON.parse(m.outcomePrices || "[]");
  return NextResponse.json({
    question: m.question,
    slug: m.slug,
    outcomes: outcomes.map((name, i) => ({ name, price: Number(prices[i]) })),
    updatedAt: m.updatedAt,
  });
}

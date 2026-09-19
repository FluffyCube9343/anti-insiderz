// app/api/odds/[slug]/route.ts - live Polymarket odds, no auth
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const { slug } = params;
  if(!/^[a-z0-9-]{1,200}$/.test(slug))return NextResponse.json({error:"Invalid market slug"},{status:400});
  try {
  const r = await fetch(
    `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(slug)}`,
    { next: { revalidate: 10 }, signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return NextResponse.json({ error: `Polymarket ${r.status}` }, { status: 502 });
  const m = await r.json();
  const outcomes: string[] = JSON.parse(m.outcomes || "[]");
  const prices: string[] = JSON.parse(m.outcomePrices || "[]");
  if(!Array.isArray(outcomes)||!Array.isArray(prices)||outcomes.length!==prices.length||!outcomes.length||outcomes.some(n=>typeof n!=="string")||prices.some(p=>p===null||p===""||!Number.isFinite(Number(p))||Number(p)<0||Number(p)>1))throw new Error("Invalid odds");
  return NextResponse.json({
    question: m.question,
    slug: m.slug,
    outcomes: outcomes.map((name, i) => ({ name, price: Number(prices[i]) })),
    updatedAt: m.updatedAt,
    closed: Boolean(m.closed),
  });
  } catch {return NextResponse.json({error:"Polymarket reference odds unavailable"},{status:502});}
}

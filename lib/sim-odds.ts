// Deterministic 5-minute simulated index walk, shared by the odds route
// (the quote a card displays) and the position-close route (the exit price
// a close settles at) - one walk, so mark-to-market and cash-out can never
// disagree about the current price.
export function simPriceCents(seed: number): number {
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
  return p;
}

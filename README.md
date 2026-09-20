# Not An Insider (Just Lucky)

**Price discovery, without privileged access.**

A pari-mutuel prediction market that enforces conflicts of interest *before* money moves. Real markets handle insider risk with policy documents and after-the-fact investigations; here the restrictions live in the trade path itself. Every trade is signed in the browser, passes six enforcement gates, and gets a receipt in a hash-chained audit trail — including the blocked ones.

Identities are registered agents in GoDaddy's **ANS** (Agent Name Service) registry. Money moves through the **Capital One Nessie API**. Market data comes from Polymarket's public API plus two deterministic simulated indices.

**Live deployment:** https://anti-insiderz.vercel.app

## The six gates

Every trade, in this order, fail-closed:

1. **Signature** — RSA-SHA256 over the canonical payload, verified against the ANS-registered public key. Private keys never leave the browser.
2. **Replay protection** — each nonce is consumed exactly once; a resubmitted signed trade is rejected.
3. **ANS registry** — live lookup on every trade: registration must be ACTIVE and unexpired, and the registry key must match.
4. **Affiliation + age** — a declared affiliation matching the market's restricted party is a hard exclusion; minors are barred from every market outright.
5. **Solvency** — the live Nessie wallet balance must cover the trade.
6. **Timing** — trades inside the window before a declared material event are FLAGGED (auditable, intentionally non-blocking).

Any gate fails: `BLOCKED`, no money moves, and the block is appended to the audit chain. A restricted identity can always *exit* — it just can never *enter*.

## Demo personas

Four agents, each with their own ANS registration and validation tokens, over the 9 demo markets:

| Persona | Affiliation | Access score | Can trade |
|---|---|---|---|
| Dario (trader4) | anthropic-staff | 67/100 | 6 of 9 — banned from the three Claude Opus release-date markets |
| Marcus (trader2) | vt-athletics | 78/100 | 7 of 9 — banned from both Hokies game markets |
| Eleanor (trader1) | va-politician-household | 78/100 | 7 of 9 — banned from the VA governor + congressional map markets |
| Timmy (trader3) | — (age 5) | 0/100 | none — the age gate bars every market |

## Identity: ANS in one breath

ANS (GoDaddy's Agent Name Service) is DNS plus a certificate authority for software agents: it registers a human-meaningful name (`ans://v1.0.0.<name>.not-an-insider-just-lucky.biz`), binds it to the agent's public key, validates control with ACME-style challenges, and tracks lifecycle status. Gate 3 checks that status live per trade, so an expired or revoked identity is blocked immediately. Registration records live in [`agents/`](agents/).

## Money: Nessie

Each persona attaches a real Nessie sandbox account. Buys move wallet → pool; signed close-outs refund pool → wallet. Every movement posts its own ledger entry (amount, description, timestamp), and the profile page reads the same ledger live. Pricing is parimutuel off pool shares; an empty pool quotes 50¢.

## Audit trail

Every decision — ALLOWED, FLAGGED, BLOCKED, CLOSED — appends with `hashPrev`/`hash`. Replaying the chain exposes any edit or deletion. `GET /api/audit` returns the chain in order.

## API surface

Documented with live examples on `/api-docs.html`:

| Route | Purpose |
|---|---|
| `GET /api/markets` | Active markets, pricing, restrictions |
| `GET /api/agents/:id` | Market-visible identity and affiliations |
| `POST /api/trades` | Execute a signed trade through the six gates |
| `POST /api/positions/close` | Signed whole-position close at the current price |
| `GET /api/audit` | Hash-chained enforcement history |

Supporting routes: `GET/POST /api/banking` (Nessie balance + ledger, account creation), `GET /api/odds/:slug` and `/api/odds/auto/:kind` (quote helpers), `POST /api/markets/ensure`, and `POST /api/admin/material-event` (admin key timestamps a material event; it cannot bypass any enforcement gate).

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. The HTML/CSS/JS interface lives in `public/` and is served alongside the `/api/*` routes.

## Configure the backend

1. Create a Supabase project and run [`supabase/migrations/0001_market.sql`](supabase/migrations/0001_market.sql) in its SQL editor, then [`supabase/seed-demo-markets.sql`](supabase/seed-demo-markets.sql).
2. Copy `.env.example` to `.env.local` and fill in `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NESSIE_API_KEY`, and the ANS values (`ANS_API_KEY`, `ANS_BASE_URL`; `ANS_AGENT_LOOKUP_URL_TEMPLATE` if your registry lane differs). Trade submission fails closed until ANS and Nessie are configured. Keep all keys server-side.
3. Seed the ANS-registered identities and their Nessie account IDs in `agent_identities` (ANS must report each as `ACTIVE`), and the demo markets in `markets`. [`scripts/nessie-setup.mjs`](scripts/nessie-setup.mjs) provisions the sandbox accounts.
4. `npm test`, then `npm run dev`.

## Signing contract

Clients submit a base64 **RSA-SHA256** signature over the canonical payload. Private keys never enter the server; the server verifies against the ANS-registered public key.

- Trade: `tradeId`, `agentId`, `marketId`, `outcome`, `amount`, `nonce`, `timestamp` (exact key order)
- Close: `closeId`, `agentId`, `marketId`, `outcome`, `contracts`, `timestamp`

[`lib/crypto.ts`](lib/crypto.ts) is the source of truth.

## Repo layout

- `app/api/` — Next.js API routes (the surface above)
- `lib/` — trade pipeline, ANS/Nessie providers, crypto, sim odds
- `public/` — the interface (markets, profile, banking, audit, API docs)
- `agents/` — per-trader ANS registration records
- `supabase/` — schema migration + demo seed
- `scripts/nessie-setup.mjs` — Nessie sandbox provisioning

## What's next

Affiliations are currently declared, not attested — the honest soft spot. The growth path is employer- and league-issued attestations with ANS revocation as the consequence layer. Then: resolved-market settlement and partial position closes.

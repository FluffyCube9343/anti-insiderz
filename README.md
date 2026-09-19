# Insider-Free Prediction Market

A pari-mutuel prediction market that rejects trades from restricted insiders. Every submitted trade follows one mandatory pipeline: RSA signature verification → nonce replay protection → live ANS status validation → live Nessie balance check → affiliation restriction → material-event timing flag. Each result is stored in a hash-chained Supabase audit log.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 for the current interface, or http://localhost:3000/markets.html for the market board. Next.js serves the HTML and CSS in `public/` alongside the existing `/api/*` backend routes. Edit `public/` when updating the interface; the old React dashboard and duplicate `UI/index.html` have been removed.

The interface currently uses illustrative demo data and does not submit real trades. Connecting it to the backend is still required. No credentials are needed to preview it.

## Configure the backend

1. Create a Supabase project and run [`supabase/migrations/0001_market.sql`](supabase/migrations/0001_market.sql) in its SQL editor, then run [`supabase/seed-demo-markets.sql`](supabase/seed-demo-markets.sql).
2. Copy `.env.example` to `.env.local` and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The `/api/markets` and `/api/audit` endpoints can read Supabase at this stage. Trade submission fails closed until its ANS and Nessie values are present. Keep the service-role key on the server.
3. Seed real ANS-registered identities and their Nessie account IDs in `agent_identities`, then create the two demo markets in `markets`. ANS must report each identity as `ACTIVE`.
4. `npm install`, `npm test`, then `npm run dev`.

## Signing contract

The client submits a base64 RSA-SHA256 signature over this exact JSON key order:
`tradeId`, `agentId`, `marketId`, `outcome`, `amount`, `nonce`, `timestamp`. [`canonicalTradePayload`](lib/crypto.ts) is the source of truth. Private keys never enter the server.

## Demo controls

The backend accepts signed requests at `/api/trades`. The admin key only timestamps a market's material event through `/api/admin/material-event`; it cannot bypass signature, identity, balance, affiliation, or nonce enforcement. The static interface's trade tickets are separate demo controls and are not yet connected to these endpoints.

Nessie calls use its sandbox account read and account-transfer endpoints. ANS lookup uses a configurable path template because the deployed RA API lane is environment-specific; keep the template aligned with your ANS environment.

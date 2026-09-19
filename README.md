# Insider-Free Prediction Market

A pari-mutuel prediction market that rejects trades from restricted insiders. Every submitted trade follows one mandatory pipeline: RSA signature verification → nonce replay protection → live ANS status validation → live Nessie balance check → affiliation restriction → material-event timing flag. Each result is stored in a hash-chained Supabase audit log.

## Run it

1. Create a Supabase project and run [`supabase/migrations/0001_market.sql`](supabase/migrations/0001_market.sql) in its SQL editor, then run [`supabase/seed-demo-markets.sql`](supabase/seed-demo-markets.sql).
2. Copy `.env.example` to `.env.local` and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. You can browse markets and the audit panel at this stage. Trade submission fails closed until its ANS and Nessie values are present.
3. Seed real ANS-registered identities and their Nessie account IDs in `agent_identities`, then create the two demo markets in `markets`. ANS must report each identity as `ACTIVE`.
4. `npm install`, `npm test`, then `npm run dev`.

## Signing contract

The client submits a base64 RSA-SHA256 signature over this exact JSON key order:
`tradeId`, `agentId`, `marketId`, `outcome`, `amount`, `nonce`, `timestamp`. [`canonicalTradePayload`](lib/crypto.ts) is the source of truth. Private keys never enter the server.

## Demo controls

Enter the selected test agent's ANS URI as the active trader and provide its detached signature. The admin key only timestamps a market's material event; it cannot bypass signature, identity, balance, affiliation, or nonce enforcement.

Nessie calls use its sandbox account read and account-transfer endpoints. ANS lookup uses a configurable path template because the deployed RA API lane is environment-specific; keep the template aligned with your ANS environment.

# Not An Insider (Just Lucky)

A hackathon prediction market with signed trades, live GoDaddy ANS identity checks, Capital One Nessie **sandbox** payments, per-market affiliation restrictions, and a Tiger Data PostgreSQL hash-chained audit trail. This is an enforcement prototype, not an insider detector or a production financial service.

## Run the team's current interface

```bash
git clone https://github.com/FluffyCube9343/anti-insiderz.git
cd anti-insiderz
npm ci
cp .env.example .env.local
# Fill the server credentials described below; never commit .env.local.
npm run dev
```

Open [the market board](http://localhost:3000/markets.html). Next.js serves the partner's interface from `public/` and the backend from `app/api/`. There is no separate old dashboard or second frontend server. Before starting new work in an existing clean checkout, run `git pull --ff-only` to get teammates' updates.

The board reads Tiger Data markets and agents, signs and submits trades, displays persisted audit decisions and payment states, and provides operator controls for event timing and resolution. Missing configuration appears on the page; it does not fall back to fake successful trades. The collapsed **market proposal** section remains a clearly labeled, unconnected UI prototype.

Your teammate's live Polymarket feed is preserved in **External reference odds**. It is read-only context, distinct from local market pools and payout accounting. Unavailable external prices are labeled unavailable, not replaced by static demo odds. The former demo email code/session redirect is replaced by the local signing-key flow, eliminating the login loop without pretending to provide email authentication.

## One-time Tiger Data setup

1. Create a dedicated PostgreSQL service in the [Tiger Data console](https://console.cloud.tigerdata.com/). Review its plan and charges before creating it.
2. Copy the PostgreSQL connection URI into `.env.local` as `TIGER_DATABASE_URL=postgresql://...`. Use the database owner account for both migration and this server-only hackathon app. Never send this credential to browsers.
3. Run `npm run db:migrate`. This applies `tigerdata/migrations/0001_market.sql` transactionally and records its checksum. Repeating the command skips already-applied migrations; edit schema through new migrations, not by changing an applied file.
4. **Either** import the existing team data as below **or** run `npm run db:seed` for a fresh demo. Import must happen before seeding.
5. Run `npm run db:check`, then start/restart the app.

The backend uses the `pg` driver, parameterized SQL and a bounded connection pool. TLS certificate verification is always enabled, including when copied URLs specify a weaker SSL mode. If your service uses a custom certificate authority, configure Node's `NODE_EXTRA_CA_CERTS` with its trusted CA file; do not disable verification. The schema requires `pgcrypto` for audit hashing. It uses ordinary PostgreSQL tables to preserve unique nonces, foreign keys and payment transactions; this does not yet use Timescale hypertables or claim time-series performance gains.

Mutation functions have no PUBLIC execution privilege, and app tables have row-level security. The server uses the schema owner's access; there are no Supabase-specific roles or public database credentials. A separately scoped runtime role is recommended before production deployment.

### Preserve the existing Supabase data

The `supabase/` folder is retained as historical migration material, **not** the active backend. Supabase credentials are needed only for this optional one-time importer; runtime never falls back to Supabase.

1. Back up the source and coordinate a maintenance window: stop **all** old app instances and teammate writes. REST pagination cannot provide a consistent snapshot while people keep changing the source.
2. Keep the existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in your local environment alongside `TIGER_DATABASE_URL`. Initialize an empty Tiger target with `db:migrate`; do not seed it yet.
3. Run `npm run db:import-supabase -- --source-paused`. This reads the five application tables, then imports them in one target transaction. It refuses a nonempty target, preserves audit payloads/hashes/sequences and payment IDs, and maps the four legacy UUID identity rows to the committed ANS names. The original source is never modified. A missing legacy payment ledger is allowed; other source errors fail the import.
4. Check counts, personas, pool totals, audit integrity, and a full sandbox trade/payment flow before teammates switch. Nonzero historical pools without a settled position ledger will still block payout resolution intentionally.
5. Update each deployment's environment and restart it. Keep Supabase intact for rollback. Once Tiger receives new writes, do **not** blindly switch back to the stale source; reconcile those new records first.

Do not run both databases as active writers. Do not expose credentials in import logs, commits, or chat. The importer is for this project's small hackathon dataset, not a large-scale online migration.

## Server configuration

Edit `.env.local`; restart the development server after changes. All values are server-only; never prefix them with `NEXT_PUBLIC_` or share keys in GitHub/chat.

| Variable | What to put there |
| --- | --- |
| `TIGER_DATABASE_URL` | Tiger Data PostgreSQL connection string, including database username/password, host, port and database name; **not** a dashboard URL |
| `ANS_BASE_URL` | The registry environment used for these identities; defaults to GoDaddy OTE |
| `ANS_API_KEY`, `ANS_API_SECRET` | Registry credentials; a combined `key:secret` in `ANS_API_KEY` is also supported |
| `NESSIE_BASE_URL` | The reachable Nessie sandbox API endpoint for the event |
| `NESSIE_API_KEY` | Team's Nessie sandbox API key |
| `NESSIE_POOL_ACCOUNT_ID` | An existing sandbox account dedicated to this market pool |
| `ADMIN_DEMO_KEY` | A long random operator secret; the default `change-me` is rejected |
| `MATERIAL_EVENT_WINDOW_MINUTES` | Timing-flag window; default 60 |

`GET /api/status` checks schema access and missing settings, not whether external credentials actually authenticate. Provider authentication and funds are checked during trading. Never use real-money accounts. The Nessie endpoint must be reachable from the server; a 403 or timeout must be fixed with the event/provider before the live demo.

## Connect the real trader identities

1. Have the key owner keep each trader's private key **on their own computer**. Only CSRs/public metadata belong in Git.
2. With ANS/Nessie configured, open **Operator controls** on the market board and enter the admin secret.
3. Provision each trader using its committed registry UUID, its actual Nessie account ID, and the intended affiliations. Provisioning fetches the current identity certificate, checks live ACTIVE registration, and checks that the wallet exists. A placeholder wallet may be replaced before any payment intent exists; wallet bindings are locked afterward.
4. Select the trader and choose the matching unencrypted PKCS#8 PEM private key in the local key picker. The key is verified against the stored public key and stays in browser memory, never uploaded or saved by this app. Changing traders or reloading clears it.

Both RSA-SHA256 (2048+ bits) and ECDSA P-256/SHA-256 are supported; the committed trader CSRs use P-256. If your local private key has `BEGIN EC PRIVATE KEY` or `BEGIN RSA PRIVATE KEY`, convert a copy locally:

```bash
openssl pkcs8 -topk8 -nocrypt -in /path/to/identity.key -out /path/to/identity.pk8.pem
chmod 600 /path/to/identity.pk8.pem
```

Do not commit either file. This demo does not provide a production login/session system; possession of the matching private key authorizes signing, not selecting a name in the dropdown.

## Trade and payment flow

Every validly shaped request passes ordered checks: certified signature → atomic nonce/trade-ID replay protection and freshness → live ANS status → live Nessie balance → market affiliation restrictions → material-event timing. The timing check uses the server clock. Near-event trades are flagged but may still proceed; affiliation and identity failures block before funds move.

The signed JSON key order is exactly `tradeId`, `agentId`, `marketId`, `outcome`, `amount`, `nonce`, `timestamp`. Signatures are base64; ECDSA uses IEEE-P1363 format. The server and browser share the same canonical layout. Invalid request shapes return 400; infrastructure failures return 503 without inventing an audit receipt.

A durable payment intent reserves the payer before any transfer POST. The pool is credited **only after Nessie reports `executed`**, with pool and audit updates in one database transaction. `pending` and uncertain `review` payments do not credit the pool. The operator's **Reconcile payments** button checks existing provider evidence; it never resends an uncertain payment. If no evidence exists after a timeout, operator/provider investigation is required. Do not clear locks or resubmit funds casually.

To resolve a market, choose the winning outcome and confirm **Close + queue payouts**. This freezes new trades and creates deterministic pro-rata payouts rounded to distribute the entire pot. If nobody staked on the winning outcome, stakes are refunded. **Send next payout** sends one sandbox transfer at a time; reconcile pending transfers before continuing. The market becomes resolved only when all payouts are confirmed. Failed/uncertain payouts require investigation, not an automatic retry. Legacy pool totals without matching settled positions deliberately block resolution.

## Demo checklist

- Confirm `/api/status` reports schema/settings ready, then verify live provider access and actual funded wallets.
- Use the clean trader for a small signed trade. Confirm the payment executes, pool changes, and the audit entry verifies.
- Use `vt-athletics` on the Hokies market: blocked; use that same trader on the governor market: eligible.
- Use `va-politician-household` on the governor market: blocked; on sports: eligible.
- Replay a submitted signature: blocked, no second payment.
- Schedule a material event, then submit a fresh eligible trade: timing flagged.
- If demonstrating ANS revocation, coordinate with the identity owner first. Submit a **newly signed** request after revocation, not a replay.
- Resolve a test market, send/reconcile payouts, and verify totals.

The team's existing data identifies trader3 as `minor` and trader4 as clean, which differs from the original three-persona write-up. This integration preserves that data. Restrictions are per-market declared affiliations, not an implemented universal age-verification policy; agree on the intended demo policy before presenting it.

## Verification and limits

```bash
npm test
npm run build
```

Tests cover the pipeline, RSA/P-256 signing, replay, fail-closed behavior, payment reconciliation, TLS configuration, and the actual PostgreSQL adapter and Tiger schema using embedded PostgreSQL with pgcrypto. Provider doubles are confined to tests; passing tests do **not** establish that the live Tiger service, credentials, certificates, wallet IDs, or network access work.

The audit exposes hashes, signed requests, reasons, and link/payload verification. Old rows lacking canonical payloads are labeled legacy. A database owner could rewrite an entire unanchored chain or delete its tail; external checkpoints are still needed for stronger tamper evidence. ANS establishes identity, not the truth of operator-entered affiliations. Admin resolution is not an oracle, and selecting a persona is not user authentication. The operator secret now authorizes provisioning, reconciliation, and payout/resolution controls as well as event timing; none bypass the trade gates.

Kalshi execution, AI insider detection, automated affiliation attestation, a published MCP trading endpoint, production authentication/rate limits, external audit checkpoints, and deployment are not included in this integration. Keep the hackathon story focused on the working signed-enforcement flow.

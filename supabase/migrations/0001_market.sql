create table agent_identities (
  agent_id text primary key check (agent_id like 'ans://%'),
  wallet_id text not null,
  affiliations text[] not null default '{}',
  public_key text not null,
  registered_at timestamptz not null
);

create table markets (
  market_id uuid primary key,
  subject text not null,
  restricted_affiliations text[] not null default '{}',
  outcome_a_total numeric(14,2) not null default 0 check (outcome_a_total >= 0),
  outcome_b_total numeric(14,2) not null default 0 check (outcome_b_total >= 0),
  status text not null check (status in ('open', 'resolved')) default 'open',
  material_event_at timestamptz
);

create table trade_nonces (
  nonce text primary key,
  trade_id uuid not null unique,
  used_at timestamptz not null default now()
);

create table trade_decisions (
  sequence bigint generated always as identity primary key,
  trade_id uuid not null,
  decision text not null check (decision in ('allowed', 'blocked', 'flagged')),
  reasons text[] not null,
  created_at timestamptz not null default now(),
  hash_prev text,
  hash text not null unique
);

create extension if not exists pgcrypto;

-- One transaction reads the previous hash and inserts its successor, preserving
-- a linear tamper-evident chain even when decisions arrive concurrently.
create or replace function append_trade_decision(p_trade_id uuid, p_decision text, p_reasons text[], p_timestamp timestamptz)
returns table(trade_id uuid, decision text, reasons text[], created_at timestamptz, hash_prev text, hash text)
language plpgsql security definer as $$
declare previous_hash text; next_hash text;
begin
  perform pg_advisory_xact_lock(773311);
  select d.hash into previous_hash from trade_decisions d order by sequence desc limit 1;
  next_hash := encode(digest(jsonb_build_object('tradeId', p_trade_id, 'decision', p_decision, 'reasons', p_reasons, 'timestamp', p_timestamp, 'hashPrev', previous_hash)::text, 'sha256'), 'hex');
  return query insert into trade_decisions(trade_id, decision, reasons, created_at, hash_prev, hash)
    values(p_trade_id, p_decision, p_reasons, p_timestamp, previous_hash, next_hash)
    returning trade_decisions.trade_id, trade_decisions.decision, trade_decisions.reasons, trade_decisions.created_at, trade_decisions.hash_prev, trade_decisions.hash;
end $$;

-- Serializes pool changes to prevent lost updates under concurrent trades.
create or replace function apply_cleared_trade(p_market_id uuid, p_outcome text, p_amount numeric)
returns void language plpgsql security definer as $$
begin
  if p_outcome = 'A' then update markets set outcome_a_total = outcome_a_total + p_amount where market_id = p_market_id and status = 'open';
  elsif p_outcome = 'B' then update markets set outcome_b_total = outcome_b_total + p_amount where market_id = p_market_id and status = 'open';
  else raise exception 'invalid outcome'; end if;
  if not found then raise exception 'market is not open'; end if;
end $$;

alter table agent_identities enable row level security;
alter table markets enable row level security;
alter table trade_nonces enable row level security;
alter table trade_decisions enable row level security;

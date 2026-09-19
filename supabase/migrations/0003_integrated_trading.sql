begin;

alter table public.agent_identities add column if not exists registry_id uuid;
alter table public.agent_identities add column if not exists display_name text;
-- The team's seeded deployment uses UUIDs in agent_id. Preserve those as registry_id
-- and bind the ANS URI from each committed registration, retaining wallet/key/affiliations.
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='agent_identities' and column_name='agent_id' and data_type<>'text') then
    alter table public.agent_identities alter column agent_id type text using agent_id::text;
  end if;
end $$;
update public.agent_identities a set registry_id=v.registry_id::uuid, agent_id=v.ans_name,
  display_name=coalesce(a.display_name,v.display_name)
from (values
  ('50babc18-b9e6-44a9-81aa-86c657cec956','ans://v1.0.0.trader1.not-an-insider-just-lucky.biz','Trader 1'),
  ('80dd1770-b27e-4f74-9c77-ee768120ad2b','ans://v1.0.0.trader2.not-an-insider-just-lucky.biz','Trader 2'),
  ('9a71ee03-316c-4c3c-86e1-7e8f68cdffa3','ans://v1.0.0.trader3.not-an-insider-just-lucky.biz','Trader 3'),
  ('939b792e-9c8f-445c-920c-618179a76c93','ans://v1.0.0.trader4.not-an-insider-just-lucky.biz','Trader 4')
) as v(registry_id,ans_name,display_name)
where a.agent_id=v.registry_id or a.agent_id=v.ans_name;
alter table public.markets drop constraint if exists markets_status_check;
alter table public.markets add constraint markets_status_check check (status in ('open','resolving','resolved'));
alter table public.markets add column if not exists winning_outcome text check (winning_outcome in ('A','B'));
alter table public.trade_decisions add column if not exists canonical_payload text;
alter table public.trade_decisions add column if not exists trade_data jsonb;

-- Durable payment intent: a crash/timeout never permits an automatic second POST.
create table if not exists public.payment_jobs (
  id uuid primary key,
  market_id uuid not null references public.markets(market_id),
  agent_id text not null references public.agent_identities(agent_id),
  kind text not null check (kind in ('trade','payout')),
  payer text not null,
  payee text not null check (payer <> payee),
  amount numeric(14,2) not null check (amount > 0),
  outcome text check (outcome in ('A','B')),
  state text not null check (state in ('queued','sending','pending','review','settled','failed')),
  transfer_id text unique,
  request jsonb,
  reasons text[] not null default '{}',
  timing_flag boolean not null default false,
  created_at timestamptz not null default now()
);
-- Hold the payer until Nessie settlement (or an explicit failure) is confirmed.
create unique index if not exists payment_payer_inflight on public.payment_jobs(payer)
where state in ('sending','pending','review');
create unique index if not exists market_agent_payout on public.payment_jobs(market_id, agent_id) where kind = 'payout';
alter table public.payment_jobs enable row level security;

create or replace function public.protect_wallet_binding() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.wallet_id is distinct from old.wallet_id and exists(select 1 from public.payment_jobs where agent_id=old.agent_id) then
    raise exception 'Wallet binding cannot change after a payment intent exists';
  end if;
  return new;
end $$;
drop trigger if exists protect_wallet_binding on public.agent_identities;
create trigger protect_wallet_binding before update on public.agent_identities
for each row execute function public.protect_wallet_binding();

create or replace function public.append_decision_v2(p_trade_id uuid, p_decision text, p_reasons text[], p_trade jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare previous_hash text; payload text; result public.trade_decisions;
begin
  perform pg_advisory_xact_lock(773311);
  select hash into previous_hash from public.trade_decisions order by sequence desc limit 1;
  payload := jsonb_build_object('tradeId', p_trade_id, 'decision', p_decision, 'reasons', p_reasons,
    'timestamp', clock_timestamp(), 'hashPrev', previous_hash, 'trade', p_trade)::text;
  insert into public.trade_decisions(trade_id, decision, reasons, hash_prev, hash, canonical_payload, trade_data, created_at)
  values(p_trade_id, p_decision, p_reasons, previous_hash, encode(digest(payload,'sha256'),'hex'), payload, p_trade,(payload::jsonb->>'timestamp')::timestamptz)
  returning * into result;
  return to_jsonb(result);
end $$;

create or replace function public.prepare_trade(p_trade jsonb, p_pool text, p_reasons text[], p_flag boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.markets; a public.agent_identities; j public.payment_jobs; amount_value numeric;
begin
  select * into m from public.markets where market_id = (p_trade->>'marketId')::uuid for update;
  if not found or m.status <> 'open' then raise exception 'Market is not open'; end if;
  select * into a from public.agent_identities where agent_id = p_trade->>'agentId' for update;
  if not found then raise exception 'Unknown agent'; end if;
  if exists(select 1 from unnest(a.affiliations) x join unnest(m.restricted_affiliations) y on lower(trim(x))=lower(trim(y))) then
    raise exception 'Affiliation changed; trade blocked';
  end if;
  amount_value := (p_trade->>'amount')::numeric;
  if amount_value <= 0 or amount_value > 10000 or amount_value <> round(amount_value,2) then raise exception 'Invalid amount'; end if;
  if not exists(select 1 from public.trade_nonces where nonce=p_trade->>'nonce' and trade_id=(p_trade->>'tradeId')::uuid) then raise exception 'Nonce not reserved'; end if;
  insert into public.payment_jobs(id,market_id,agent_id,kind,payer,payee,amount,outcome,state,request,reasons,timing_flag)
  values((p_trade->>'tradeId')::uuid,m.market_id,a.agent_id,'trade',a.wallet_id,p_pool,amount_value,p_trade->>'outcome','sending',p_trade,p_reasons,p_flag)
  returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.finish_payment(p_id uuid, p_status text, p_transfer_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare j public.payment_jobs; d jsonb; verdict text;
begin
  select * into j from public.payment_jobs where id=p_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if j.state in ('settled','failed') then return to_jsonb(j); end if;
  if p_status not in ('pending','review','settled','failed') then raise exception 'Invalid payment status'; end if;
  if p_status='settled' and p_transfer_id is null then raise exception 'Transfer evidence required'; end if;
  if j.transfer_id is not null and p_transfer_id is distinct from j.transfer_id then raise exception 'Transfer mismatch'; end if;
  if j.state=p_status and j.transfer_id is not distinct from p_transfer_id then return to_jsonb(j); end if;
  update public.payment_jobs set state=p_status, transfer_id=coalesce(p_transfer_id,transfer_id) where id=p_id returning * into j;
  if j.kind='trade' and p_status='settled' then
    update public.markets set outcome_a_total=outcome_a_total+case when j.outcome='A' then j.amount else 0 end,
      outcome_b_total=outcome_b_total+case when j.outcome='B' then j.amount else 0 end where market_id=j.market_id;
  end if;
  verdict := case when p_status='failed' then 'blocked' when p_status in ('pending','review') or j.timing_flag then 'flagged' else 'allowed' end;
  d := public.append_decision_v2(j.id,verdict,j.reasons || array[p_reason],coalesce(j.request,to_jsonb(j)));
  if j.kind='payout' and p_status='settled' then
    update public.markets set status='resolved' where market_id=j.market_id and status='resolving'
      and not exists(select 1 from public.payment_jobs where market_id=j.market_id and kind='payout' and state<>'settled');
  end if;
  return to_jsonb(j) || jsonb_build_object('decision',d);
end $$;

create or replace function public.prepare_resolution(p_market uuid, p_outcome text, p_pool text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare m public.markets; pot bigint; winning numeric;
begin
  if p_outcome not in ('A','B') then raise exception 'Invalid winning outcome'; end if;
  select * into m from public.markets where market_id=p_market for update;
  if not found then raise exception 'Market not found'; end if;
  if m.status <> 'open' then
    if m.winning_outcome=p_outcome then return; end if;
    raise exception 'Market already resolving with another outcome';
  end if;
  if exists(select 1 from public.payment_jobs where market_id=p_market and kind='trade' and state not in ('settled','failed')) then raise exception 'Reconcile pending trades first'; end if;
  pot := round((m.outcome_a_total+m.outcome_b_total)*100);
  select coalesce(sum(amount),0) into winning from public.payment_jobs where market_id=p_market and kind='trade' and state='settled' and outcome=p_outcome;
  -- Never invent payouts for historical pool totals without a position ledger.
  if pot <> (select coalesce(sum(amount)*100,0) from public.payment_jobs where market_id=p_market and kind='trade' and state='settled') then raise exception 'Pool and position ledger do not match'; end if;
  update public.markets set status=case when pot=0 then 'resolved' else 'resolving' end, winning_outcome=p_outcome where market_id=p_market;
  -- No winning stakes: refund all stakers. Otherwise distribute every cent using largest remainder.
  insert into public.payment_jobs(id,market_id,agent_id,kind,payer,payee,amount,state,reasons)
  with stakes as (
    select agent_id, payer as wallet, sum(amount) as stake from public.payment_jobs
    where market_id=p_market and kind='trade' and state='settled' and (winning=0 or outcome=p_outcome)
    group by agent_id,payer
  ), shares as (
    select *, pot * stake / sum(stake) over () as exact_cents from stakes
  ), rounded as (
    select *, floor(exact_cents) as base, row_number() over(order by exact_cents-floor(exact_cents) desc,agent_id) as rank,
      pot-sum(floor(exact_cents)) over() as leftover from shares
  )
  select gen_random_uuid(),p_market,agent_id,'payout',p_pool,wallet,(base+case when rank<=leftover then 1 else 0 end)/100,
    'queued',array[case when winning=0 then 'No winning stakes: refund.' else 'Pari-mutuel payout; winning outcome '||p_outcome end]
  from rounded where base+case when rank<=leftover then 1 else 0 end>0;
end $$;

create or replace function public.claim_payout(p_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare j public.payment_jobs;
begin
  update public.payment_jobs set state='sending' where id=p_id and kind='payout' and state='queued' returning * into j;
  if not found then raise exception 'Payout already claimed'; end if;
  return to_jsonb(j);
end $$;

-- RLS alone does not restrict SECURITY DEFINER RPCs. Only the server may call them.
revoke all on function public.apply_cleared_trade(uuid,text,numeric) from public,anon,authenticated;
revoke all on function public.append_trade_decision(uuid,text,text[],timestamptz) from public,anon,authenticated;
revoke all on function public.append_decision_v2(uuid,text,text[],jsonb) from public,anon,authenticated;
revoke all on function public.prepare_trade(jsonb,text,text[],boolean) from public,anon,authenticated;
revoke all on function public.finish_payment(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.prepare_resolution(uuid,text,text) from public,anon,authenticated;
revoke all on function public.claim_payout(uuid) from public,anon,authenticated;
grant execute on function public.append_decision_v2(uuid,text,text[],jsonb), public.prepare_trade(jsonb,text,text[],boolean), public.finish_payment(uuid,text,text,text), public.prepare_resolution(uuid,text,text), public.claim_payout(uuid) to service_role;
commit;

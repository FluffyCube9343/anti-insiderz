-- Activity fields on the decision chain so the profile audit log can show
-- real pipeline trades per identity. Hash payload is unchanged: the chain
-- stays verifiable against rows written before this migration.
alter table trade_decisions
  add column if not exists agent_id text,
  add column if not exists market_id uuid,
  add column if not exists market_subject text,
  add column if not exists amount numeric,
  add column if not exists outcome text;

drop function if exists append_trade_decision(uuid, text, text[], timestamptz);

create function append_trade_decision(p_trade_id uuid, p_decision text, p_reasons text[], p_timestamp timestamptz, p_agent_id text, p_market_id uuid, p_market_subject text, p_amount numeric, p_outcome text)
returns table(trade_id uuid, decision text, reasons text[], created_at timestamptz, hash_prev text, hash text)
language plpgsql security definer as $$
declare previous_hash text; next_hash text;
begin
  perform pg_advisory_xact_lock(773311);
  select d.hash into previous_hash from trade_decisions d order by sequence desc limit 1;
  next_hash := encode(digest(jsonb_build_object('tradeId', p_trade_id, 'decision', p_decision, 'reasons', p_reasons, 'timestamp', p_timestamp, 'hashPrev', previous_hash)::text, 'sha256'), 'hex');
  return query insert into trade_decisions(trade_id, decision, reasons, created_at, hash_prev, hash, agent_id, market_id, market_subject, amount, outcome)
    values(p_trade_id, p_decision, p_reasons, p_timestamp, previous_hash, next_hash, p_agent_id, p_market_id, p_market_subject, p_amount, p_outcome)
    returning trade_decisions.trade_id, trade_decisions.decision, trade_decisions.reasons, trade_decisions.created_at, trade_decisions.hash_prev, trade_decisions.hash;
end $$;

-- Contracts bought, recorded at trade time from the pre-trade pool price,
-- so the profile audit log can show a real position instead of 0.
alter table trade_decisions
  add column if not exists contracts numeric;

drop function if exists append_trade_decision(uuid, text, text[], timestamptz, text, uuid, text, numeric, text);

create function append_trade_decision(p_trade_id uuid, p_decision text, p_reasons text[], p_timestamp timestamptz, p_agent_id text, p_market_id uuid, p_market_subject text, p_amount numeric, p_outcome text, p_contracts numeric)
returns table(trade_id uuid, decision text, reasons text[], created_at timestamptz, hash_prev text, hash text)
language plpgsql security definer as $$
declare previous_hash text; next_hash text;
begin
  perform pg_advisory_xact_lock(773311);
  select d.hash into previous_hash from trade_decisions d order by sequence desc limit 1;
  next_hash := encode(digest(jsonb_build_object('tradeId', p_trade_id, 'decision', p_decision, 'reasons', p_reasons, 'timestamp', p_timestamp, 'hashPrev', previous_hash)::text, 'sha256'), 'hex');
  return query insert into trade_decisions(trade_id, decision, reasons, created_at, hash_prev, hash, agent_id, market_id, market_subject, amount, outcome, contracts)
    values(p_trade_id, p_decision, p_reasons, p_timestamp, previous_hash, next_hash, p_agent_id, p_market_id, p_market_subject, p_amount, p_outcome, p_contracts)
    returning trade_decisions.trade_id, trade_decisions.decision, trade_decisions.reasons, trade_decisions.created_at, trade_decisions.hash_prev, trade_decisions.hash;
end $$;

-- Run this once in Supabase SQL Editor after 0001_market.sql.
-- These are the two demo markets; agent identities are added after ANS setup.
insert into markets (market_id, subject, restricted_affiliations, status, material_event_at)
values
  ('10000000-0000-4000-8000-000000000001', 'Will Team A win the championship?', array['Team A'], 'open', now() + interval '7 days'),
  ('10000000-0000-4000-8000-000000000002', 'Will the city host the event?', array[]::text[], 'open', now() + interval '14 days')
on conflict (market_id) do nothing;

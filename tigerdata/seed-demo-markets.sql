-- Run with npm run db:seed after db:migrate (or import existing data instead).
-- These are the two demo markets; agent identities are added after ANS setup.
insert into markets (market_id, subject, restricted_affiliations, status, material_event_at)
values
  ('10000000-0000-4000-8000-000000000001', 'Will Virginia Tech win its next Hokies game?', array['vt-athletics'], 'open', now() + interval '7 days'),
  ('10000000-0000-4000-8000-000000000002', 'Will the Virginia governor election result favor candidate A?', array['va-politician-household'], 'open', now() + interval '14 days')
on conflict (market_id) do nothing;

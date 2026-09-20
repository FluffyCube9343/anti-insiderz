-- Run once in the Supabase SQL Editor. Self-sufficient: creates the columns
-- from 0003 too, so it works even if 0003 was never applied.
alter table agent_identities
  add column if not exists full_name text,
  add column if not exists email text,
  add column if not exists birthday date,
  add column if not exists role text;

-- Demo personas per the team: trader1 = official's wife, trader2 = the QB,
-- trader3 = five years old (total ban via the backend age gate), trader4 = Dario.
-- Dario Amodei's birth year is real (1983); Jan 13 supplied by the team.
update agent_identities set full_name = 'Eleanor Vance', email = 'eleanor.vance@example.com', birthday = '1979-12-02', role = 'Spouse of a Virginia state official', affiliations = array['va-politician-household']
  where agent_id like '%50babc18-b9e6-44a9-81aa-86c657cec956';
update agent_identities set full_name = 'Marcus Reed', email = 'marcus.reed@example.com', birthday = '2003-09-08', role = 'Quarterback, Virginia Tech football', affiliations = array['vt-athletics']
  where agent_id like '%80dd1770-b27e-4f74-9c77-ee768120ad2b';
update agent_identities set full_name = 'Timmy Parker', email = 'timmy.parker@example.com', birthday = '2021-03-15', role = 'Kindergartener', affiliations = array[]::text[]
  where agent_id like '%9a71ee03-316c-4c3c-86e1-7e8f68cdffa3';
update agent_identities set full_name = 'Dario Amodei', email = 'dario@anthropic.com', birthday = '1983-01-13', role = 'CEO, Anthropic', affiliations = array['anthropic-staff']
  where agent_id like '%939b792e-9c8f-445c-920c-618179a76c93';

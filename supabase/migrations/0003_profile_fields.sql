-- Run this once in the Supabase SQL Editor after 0002.
-- Adds the declared-profile fields the client shows on profile.html.
alter table agent_identities
  add column if not exists email text,
  add column if not exists birthday date,
  add column if not exists role text;

-- Demo values - edit these to whatever the team wants on camera.
update agent_identities set email = 'trader1@example.com', birthday = '2002-04-17', role = 'Retail trader'
  where agent_id like '%50babc18-b9e6-44a9-81aa-86c657cec956';
update agent_identities set email = 'trader2@example.com', birthday = '1998-11-03', role = 'Retail trader'
  where agent_id like '%80dd1770-b27e-4f74-9c77-ee768120ad2b';
update agent_identities set email = 'trader3@example.com', birthday = '2001-07-26', role = 'Retail trader'
  where agent_id like '%9a71ee03-316c-4c3c-86e1-7e8f68cdffa3';
update agent_identities set email = 'dario@example.com', birthday = '1995-02-14', role = 'Anthropic staff'
  where agent_id like '%939b792e-9c8f-445c-920c-618179a76c93';

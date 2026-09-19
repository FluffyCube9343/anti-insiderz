-- Apply this after 0001 if the original generic demo markets were already seeded.
update markets
set subject = 'Will Virginia Tech win its next Hokies game?',
    restricted_affiliations = array['vt-athletics']
where market_id = '10000000-0000-4000-8000-000000000001';

update markets
set subject = 'Will the Virginia governor election result favor candidate A?',
    restricted_affiliations = array['va-politician-household']
where market_id = '10000000-0000-4000-8000-000000000002';

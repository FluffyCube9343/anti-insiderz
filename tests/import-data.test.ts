import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {importData} from '../scripts/import-supabase.cjs';
let db:PGlite;
beforeEach(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.exec(readFileSync('tigerdata/migrations/0001_market.sql','utf8'));},30000);
afterEach(async()=>{await db.close();});
function data(){
  const timestamp=new Date().toISOString(),tradeId=randomUUID();
  const payload=JSON.stringify({tradeId,decision:'blocked',reasons:['test'],timestamp,hashPrev:null,trade:null});
  return {agent_identities:[{agent_id:'50babc18-b9e6-44a9-81aa-86c657cec956',wallet_id:'wallet',public_key:'public',registered_at:timestamp,affiliations:['va-politician-household']}],
    markets:[{market_id:randomUUID() as string,subject:'Preserved market',status:'open'}],trade_nonces:[],payment_jobs:[],
    trade_decisions:[{sequence:12,trade_id:tradeId,decision:'blocked',reasons:['test'],created_at:timestamp,hash_prev:null,hash:createHash('sha256').update(payload).digest('hex'),canonical_payload:payload,trade_data:null}]};
}
it('preserves source audit bytes, sequence, identity binding, and next audit ID',async()=>{
  const source=data();await importData(db,source);
  const agents=await db.query<{agent_id:string;registry_id:string}>('select * from agent_identities');
  expect(agents.rows[0].agent_id).toBe('ans://v1.0.0.trader1.not-an-insider-just-lucky.biz');expect(agents.rows[0].registry_id).toBe(source.agent_identities[0].agent_id);
  const decisions=await db.query<{hash:string;canonical_payload:string}>('select * from trade_decisions');
  expect(decisions.rows[0].canonical_payload).toBe(source.trade_decisions[0].canonical_payload);expect(decisions.rows[0].hash).toBe(source.trade_decisions[0].hash);
  const next=await db.query<{decision:{sequence:number}}>("select append_decision_v2($1,'blocked',array['test'],null) as decision",[randomUUID()]);expect(next.rows[0].decision.sequence).toBe(13);
});
it('rolls back every imported row on a later invalid row',async()=>{
  const source=data();source.markets[0].market_id='invalid';await expect(importData(db,source)).rejects.toThrow();
  const r=await db.query('select * from agent_identities');expect(r.rows).toHaveLength(0);
});
it('refuses to overwrite a populated target',async()=>{
  await importData(db,data());await expect(importData(db,data())).rejects.toThrow('Target must be empty');
  const r=await db.query('select * from trade_decisions');expect(r.rows).toHaveLength(1);
});

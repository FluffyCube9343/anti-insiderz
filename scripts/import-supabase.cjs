// One-time, read-only source export. Stop ALL source writers before running.
const {loadEnvConfig}=require('@next/env');
const {Client}=require('pg');
const options=require('../lib/postgres-options.cjs');
const tables=['agent_identities','markets','trade_nonces','trade_decisions','payment_jobs'];
const orders={agent_identities:'agent_id',markets:'market_id',trade_nonces:'nonce',trade_decisions:'sequence',payment_jobs:'id'};
const identities={
  '50babc18-b9e6-44a9-81aa-86c657cec956':1,'80dd1770-b27e-4f74-9c77-ee768120ad2b':2,
  '9a71ee03-316c-4c3c-86e1-7e8f68cdffa3':3,'939b792e-9c8f-445c-920c-618179a76c93':4
};
const uri=id=>identities[id]?`ans://v1.0.0.trader${identities[id]}.not-an-insider-just-lucky.biz`:id;
async function sourceRows(table){
  const base=new URL(process.env.SUPABASE_URL);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))throw new Error('Expected a Supabase project HTTPS URL.');
  const rows=[];
  for(let offset=0;;){
    const url=new URL('/rest/v1/'+table,base);url.searchParams.set('select','*');url.searchParams.set('order',orders[table]+'.asc');url.searchParams.set('offset',String(offset));url.searchParams.set('limit','500');
    const r=await fetch(url,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!r.ok){const b=await r.json().catch(()=>({}));if(table==='payment_jobs'&&r.status===404&&b.code==='PGRST205')return [];throw new Error('Source read failed.');}
    const batch=await r.json();if(!Array.isArray(batch))throw new Error('Invalid source response.');
    rows.push(...batch);if(!batch.length)break;offset+=batch.length;
  }
  return rows;
}
async function main(){
  loadEnvConfig(process.cwd());
  if(!process.argv.includes('--source-paused'))throw new Error('Stop all source writers and explicitly pass --source-paused.');
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('Legacy source credentials required only for import.');
  // Nothing is written until every source table has been read successfully.
  const exported={};for(const table of tables)exported[table]=await sourceRows(table);
  const client=new Client(options());
  try{await client.connect();await importData(client,exported);}finally{await client.end();}
}
async function importData(client,exported){
  try{
    await client.query('begin');await client.query('select pg_advisory_xact_lock(773312)');
    for(const table of tables){await client.query(`lock table public.${table} in access exclusive mode`);const {rows}=await client.query(`select 1 from public.${table} limit 1`);if(rows.length)throw new Error('Target must be empty. Import before seeding.');}
    for(const table of tables){
      const {rows:columns}=await client.query("select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1",[table]);
      const allowed=new Map(columns.map(c=>[c.column_name,c.data_type]));
      for(const source of exported[table]){
        const row={...source};
        if(table==='agent_identities'&&identities[row.agent_id]){row.registry_id=row.agent_id;row.display_name ||= 'Trader '+identities[row.agent_id];row.agent_id=uri(row.agent_id);}
        if(table==='payment_jobs')row.agent_id=uri(row.agent_id);
        // Audit canonical strings, hashes and signed trade payloads must NEVER be rewritten.
        const keys=Object.keys(row).filter(k=>allowed.has(k));
        const values=keys.map(k=>allowed.get(k)==='jsonb'&&row[k]!==null?JSON.stringify(row[k]):row[k]);
        await client.query(`insert into public.${table} (${keys.map(k=>'"'+k+'"').join(',')}) ${table==='trade_decisions'?'overriding system value':''} values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,values);
      }
      console.log(table+': '+exported[table].length+' rows copied');
    }
    await client.query("select setval(pg_get_serial_sequence('public.trade_decisions','sequence'),coalesce((select max(sequence) from public.trade_decisions),1),exists(select 1 from public.trade_decisions))");
    await client.query('commit');console.log('Import committed. Supabase source was not modified.');
  }catch(e){await client.query('rollback').catch(()=>{});throw e;}
}
module.exports={importData};
if(require.main===module)main().catch(()=>{console.error('Import failed; no secrets logged. Pause source writers, verify source credentials, and initialize an EMPTY Tiger Data target. Any target inserts from this run are rolled back.');process.exitCode=1;});

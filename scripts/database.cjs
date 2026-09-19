const {loadEnvConfig}=require('@next/env');
const {Client}=require('pg');
const {readFileSync,readdirSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
const options=require('../lib/postgres-options.cjs');
loadEnvConfig(process.cwd());
async function main(){
  const command=process.argv[2];
  if(!['migrate','seed','check'].includes(command))throw new Error('Use migrate, seed, or check.');
  const client=new Client(options());
  try {
    await client.connect();
    if(command==='check'){
      await client.query('select id from public.payment_jobs limit 1');
      const {rows}=await client.query('select count(*)::int as agents from public.agent_identities');
      console.log('Tiger Data connected; application schema available; agents:',rows[0].agents);return;
    }
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(773312)');
    if(command==='migrate'){
      await client.query('create table if not exists public.app_schema_migrations(version text primary key, checksum text not null, applied_at timestamptz not null default now())');
      const dir=join(__dirname,'../tigerdata/migrations');
      for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort()){
        const sql=readFileSync(join(dir,file),'utf8'),checksum=createHash('sha256').update(sql).digest('hex');
        const {rows}=await client.query('select checksum from public.app_schema_migrations where version=$1',[file]);
        if(rows.length){if(rows[0].checksum!==checksum)throw new Error('Applied migration changed. Add a new migration instead.');continue;}
        await client.query(sql);
        await client.query('insert into public.app_schema_migrations(version,checksum) values ($1,$2)',[file,checksum]);
        console.log('Applied',file);
      }
    }else{
      await client.query(readFileSync(join(__dirname,'../tigerdata/seed-demo-markets.sql'),'utf8'));
      console.log('Demo market seed applied (existing rows retained).');
    }
    await client.query('commit');
  }catch(e){await client.query('rollback').catch(()=>{});throw e;}
  finally{await client.end();}
}
main().catch(e=>{console.error('Database command failed; no connection details logged. Check the URL, TLS trust, schema ownership, and pgcrypto availability. Error code:',/^[A-Z0-9_]+$/.test(e.code||'')?e.code:'CONFIG_OR_SCHEMA');process.exitCode=1;});

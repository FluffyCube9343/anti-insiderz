import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { PostgresTradeStore } from "../lib/providers";
let db:PGlite;
const mid=randomUUID();
beforeAll(async()=>{
  db=new PGlite({extensions:{pgcrypto}});
  await db.exec("create role untrusted;");
  await db.exec(readFileSync("tigerdata/migrations/0001_market.sql","utf8"));
  await db.exec("insert into agent_identities(agent_id,wallet_id,public_key,registered_at) values ('ans://one','one','key',now()),('ans://two','two','key',now()),('ans://three','three','key',now());");
},30000);
afterAll(async()=>{await db.close();});
async function market(id=mid){await db.query("insert into markets(market_id,subject) values ($1,'Test market')",[id]);return id;}
async function trade(m:string,agent:string,amount:number,outcome="A") {
  const t={tradeId:randomUUID(),agentId:"ans://"+agent,marketId:m,amount,outcome,nonce:randomUUID(),timestamp:new Date().toISOString(),signature:"signed"};
  await db.query("insert into trade_nonces(nonce,trade_id) values ($1,$2)",[t.nonce,t.tradeId]);
  await db.query("select prepare_trade($1::jsonb,'pool','{}',false)",[JSON.stringify(t)]);
  return t;
}
async function finish(id:string,status="settled"){return db.query("select finish_payment($1,$2,$3,'Confirmed by provider') as job",[id,status,"transfer-"+id]);}
describe("Postgres integration",()=>{
  it("applies all migrations and denies anonymous mutation RPCs",async()=>{
    const r=await db.query<{allowed:boolean}>("select has_function_privilege('untrusted','public.prepare_trade(jsonb,text,text[],boolean)','execute') as allowed");expect(r.rows[0].allowed).toBe(false);
    const s=await db.query<{allowed:boolean}>("select has_function_privilege(current_user,'public.finish_payment(uuid,text,text,text)','execute') as allowed");expect(s.rows[0].allowed).toBe(true);
  });
  it("reserves wallets and finalizes pool + audit atomically and idempotently",async()=>{
    await market();const t=await trade(mid,"one",10);
    await expect(trade(mid,"one",5)).rejects.toThrow(/payment_payer_inflight/);
    await finish(t.tradeId,"pending");
    let r=await db.query<{outcome_a_total:string}>("select outcome_a_total from markets where market_id=$1",[mid]);expect(Number(r.rows[0].outcome_a_total)).toBe(0);
    await finish(t.tradeId);await finish(t.tradeId);
    r=await db.query("select outcome_a_total from markets where market_id=$1",[mid]);expect(Number(r.rows[0].outcome_a_total)).toBe(10);
    const d=await db.query<{hash:string;canonical_payload:string;hash_prev:string|null}>("select hash,hash_prev,canonical_payload from trade_decisions order by sequence");
    expect(d.rows.length).toBe(2);expect(d.rows[1].hash_prev).toBe(d.rows[0].hash);
    for(const row of d.rows)expect(createHash("sha256").update(row.canonical_payload).digest("hex")).toBe(row.hash);
  });
  it("blocks resolution while a transfer is unresolved",async()=>{
    const t=await trade(mid,"two",1);
    await expect(db.query("select prepare_resolution($1,'A','pool')",[mid])).rejects.toThrow(/Reconcile/);
    await finish(t.tradeId,"failed");
  });
  it("distributes the entire pool to winners with deterministic cent rounding",async()=>{
    const id=await market(randomUUID());
    await finish((await trade(id,"one",1)).tradeId);
    await finish((await trade(id,"two",2)).tradeId);
    await finish((await trade(id,"three",1,"B")).tradeId);
    await db.query("select prepare_resolution($1,'A','pool')",[id]);
    const r=await db.query<{agent_id:string;amount:string;id:string}>("select id,agent_id,amount from payment_jobs where market_id=$1 and kind='payout' order by agent_id",[id]);
    expect(r.rows.map(r=>Number(r.amount))).toEqual([1.33,2.67]);
    for(const payout of r.rows){await db.query("select claim_payout($1)",[payout.id]);await finish(payout.id);}
    const m=await db.query<{status:string}>("select status from markets where market_id=$1",[id]);expect(m.rows[0].status).toBe("resolved");
    await db.query("select prepare_resolution($1,'A','pool')",[id]);
    await expect(db.query("select prepare_resolution($1,'B','pool')",[id])).rejects.toThrow(/another outcome/);
  });
  it("refunds stakes when the winning outcome has no stakers",async()=>{
    const id=await market(randomUUID());await finish((await trade(id,"one",3,"A")).tradeId);
    await db.query("select prepare_resolution($1,'B','pool')",[id]);
    const r=await db.query<{amount:string}>("select amount from payment_jobs where market_id=$1 and kind='payout'",[id]);expect(Number(r.rows[0].amount)).toBe(3);
  });
  it("allows correcting a placeholder wallet only before its first intent",async()=>{
    await db.exec("insert into agent_identities(agent_id,wallet_id,public_key,registered_at) values ('ans://new','placeholder','key',now());");
    await db.exec("update agent_identities set wallet_id='verified-wallet' where agent_id='ans://new';");
    const id=await market(randomUUID());await trade(id,"new",1);
    await expect(db.exec("update agent_identities set wallet_id='another-wallet' where agent_id='ans://new';")).rejects.toThrow(/Wallet binding/);
  });
  it("executes the actual Postgres adapter against the Tiger schema",async()=>{
    const store=new PostgresTradeStore(db);
    expect((await store.getAgent('ans://three'))?.walletId).toBe('three');
    expect(await store.getAgent("' or 1=1 --")).toBeNull();
    const id=await market(randomUUID()),tid=randomUUID(),nonce=randomUUID();
    expect(await store.reserveNonce(nonce,tid)).toBe(true);
    expect(await store.reserveNonce(nonce,randomUUID())).toBe(false);
    expect(await store.reserveNonce(randomUUID(),tid)).toBe(false);
    const t={tradeId:tid,agentId:'ans://three',marketId:id,amount:1,outcome:'A' as const,nonce,timestamp:new Date().toISOString(),signature:'test'};
    const job=await store.prepare(t,'pool',[],false);expect(job.state).toBe('sending');
    const result=await store.finish(job.id,'settled','adapter-transfer','Provider confirmed');
    expect(result.decision?.decision).toBe('allowed');
    expect((await store.getMarket(id))?.pool.outcomeA).toBe(1);
    const blocked=await store.appendDecision({...t,tradeId:randomUUID()},'blocked',['Test']);expect(blocked.decision).toBe('blocked');
  });
});

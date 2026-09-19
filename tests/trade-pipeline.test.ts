import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { canonicalTradePayload, verifyTradeSignature } from "../lib/crypto";
import { TradePipeline } from "../lib/trade-pipeline";
import { reconcile, paymentDescription } from "../lib/payments";
import type { AgentIdentity, AnsRegistry, Market, PaymentRail, PaymentJob, PaymentState, TradeDecision, TradeRequest, TradeStore, DecisionKind } from "../lib/domain";

const keys=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
const publicKey=keys.publicKey.export({type:"spki",format:"pem"}).toString();
const now=Date.now();
const agent:AgentIdentity={agentId:"ans://v1.0.0.trader.example.com",registryId:crypto.randomUUID(),displayName:"Trader",walletId:"wallet",affiliations:[],publicKey,registeredAt:new Date(now).toISOString()};
const market:Market={marketId:crypto.randomUUID(),subject:"Hokies win?",restrictedAffiliations:["vt-athletics"],pool:{outcomeA:0,outcomeB:0},status:"open",materialEventAt:null};
class MemoryStore implements TradeStore {
  nonces=new Set<string>(); ids=new Set<string>();decisions:TradeDecision[]=[];jobs=new Map<string,PaymentJob>();pool=0;
  agent={...agent};market={...market};
  async getAgent(id:string){return id===this.agent.agentId?this.agent:null;}
  async getMarket(){return this.market;}
  async reserveNonce(nonce:string,id:string){if(this.nonces.has(nonce)||this.ids.has(id))return false;this.nonces.add(nonce);this.ids.add(id);return true;}
  async appendDecision(t:TradeRequest,decision:DecisionKind,reasons:string[]){const d={tradeId:t.tradeId,decision,reasons,timestamp:new Date().toISOString(),hashPrev:this.decisions.at(-1)?.hash??null,hash:String(this.decisions.length)};this.decisions.push(d);return d;}
  async prepare(t:TradeRequest,pool:string,reasons:string[],flag:boolean){if([...this.jobs.values()].some(j=>["sending","pending","review"].includes(j.state)))throw new Error("Wallet busy");const j:PaymentJob={id:t.tradeId,market_id:t.marketId,agent_id:t.agentId,kind:"trade",payer:"wallet",payee:pool,amount:t.amount,state:"sending",transfer_id:null,request:t};this.jobs.set(j.id,j);return j;}
  async finish(id:string,state:PaymentState,transferId:string|null,reason:string){const j=this.jobs.get(id)!;if(j.state==="settled"||j.state==="failed")return j;if(state==="settled")this.pool+=Number(j.amount);j.state=state;j.transfer_id=transferId;j.decision=await this.appendDecision(j.request!,state==="settled"?"allowed":state==="failed"?"blocked":"flagged",[reason]);return j;}
}
function signed(patch:Partial<TradeRequest>={}) {
  const t:TradeRequest={tradeId:crypto.randomUUID(),agentId:agent.agentId,marketId:market.marketId,outcome:"A",amount:10,nonce:crypto.randomUUID(),timestamp:new Date(now).toISOString(),signature:"",...patch};
  t.signature=crypto.sign("sha256",Buffer.from(canonicalTradePayload(t)),keys.privateKey).toString("base64");return t;
}
function fixture() {
  const store=new MemoryStore();
  const ans:AnsRegistry={publicKey:vi.fn(async()=>publicKey),validate:vi.fn(async()=>({valid:true}))};
  const rail:PaymentRail={balance:vi.fn(async()=>100),transfer:vi.fn(async(payer,payee,amount,description)=>({id:"nessie-1",status:"executed" as const,payer,payee,amount,description})),getTransfer:vi.fn(),findTransfer:vi.fn()};
  const pipeline=new TradePipeline(store,ans,rail,()=> "pool",60,()=>now);
  return {store,ans,rail,pipeline};
}
describe("mandatory trade gates",()=>{
  it("settles a valid trade only after all six checks",async()=>{const f=fixture();const d=await f.pipeline.execute(signed());expect(d.paymentStatus).toBe("settled");expect(f.store.pool).toBe(10);});
  it("rejects tampering before nonce consumption",async()=>{const f=fixture(),t=signed();t.amount=20;const d=await f.pipeline.execute(t);expect(d.reasons[0]).toContain("Gate 1");expect(f.store.nonces.size).toBe(0);expect(f.rail.transfer).not.toHaveBeenCalled();});
  it("blocks a nonce replay before checking registry status again",async()=>{const f=fixture(),t=signed();await f.pipeline.execute(t);const d=await f.pipeline.execute(t);expect(d.reasons[0]).toContain("replay");expect(f.ans.validate).toHaveBeenCalledTimes(1);expect(f.rail.transfer).toHaveBeenCalledTimes(1);});
  it("rejects expired signed payloads",async()=>{const f=fixture();const d=await f.pipeline.execute(signed({timestamp:new Date(now-600001).toISOString()}));expect(d.reasons[0]).toContain("freshness");});
  it("fails closed on live revocation",async()=>{const f=fixture();f.ans.validate=vi.fn(async()=>({valid:false,reason:"revoked"}));expect((await f.pipeline.execute(signed())).reasons[0]).toContain("revoked");expect(f.rail.balance).not.toHaveBeenCalled();});
  it("blocks insufficient funds before affiliation",async()=>{const f=fixture();f.rail.balance=vi.fn(async()=>0);f.store.agent.affiliations=["vt-athletics"];expect((await f.pipeline.execute(signed())).reasons[0]).toContain("Gate 4");});
  it("blocks exact normalized affiliation",async()=>{const f=fixture();f.store.agent.affiliations=["VT-Athletics"];expect((await f.pipeline.execute(signed())).reasons[0]).toContain("VT-Athletics");expect(f.rail.transfer).not.toHaveBeenCalled();});
  it("does not block the same identity on unrestricted markets",async()=>{const f=fixture();f.store.agent.affiliations=["vt-athletics"];f.store.market.restrictedAffiliations=[];expect((await f.pipeline.execute(signed())).paymentStatus).toBe("settled");});
  it("uses server time for the material-event flag",async()=>{const f=fixture();f.store.market.materialEventAt=new Date(now+1000).toISOString();const prepare=vi.spyOn(f.store,"prepare");await f.pipeline.execute(signed({timestamp:new Date(now-240000).toISOString()}));expect(prepare.mock.calls[0][3]).toBe(true);});
  it("does not credit a pending transfer",async()=>{const f=fixture();f.rail.transfer=vi.fn(async(payer,payee,amount,description)=>({id:"pending",status:"pending" as const,payer,payee,amount,description}));expect((await f.pipeline.execute(signed())).paymentStatus).toBe("pending");expect(f.store.pool).toBe(0);});
  it("holds ambiguous transfers for reconciliation, without resending",async()=>{const f=fixture();f.rail.transfer=vi.fn(async()=>{throw new Error("timeout");});expect((await f.pipeline.execute(signed())).paymentStatus).toBe("review");expect(f.store.pool).toBe(0);await f.pipeline.execute(signed());expect(f.rail.transfer).toHaveBeenCalledTimes(1);});
  it("distinguishes replay-store failure from a reused nonce",async()=>{const f=fixture();f.store.reserveNonce=async()=>{throw new Error("database");};expect((await f.pipeline.execute(signed())).reasons[0]).toContain("unavailable");});
  it("rechecks balance while holding the wallet reservation",async()=>{const f=fixture();f.rail.balance=vi.fn().mockResolvedValueOnce(100).mockResolvedValueOnce(0);expect((await f.pipeline.execute(signed())).paymentStatus).toBe("failed");expect(f.rail.transfer).not.toHaveBeenCalled();});
  it("reconciles settlement once without another transfer",async()=>{const f=fixture();f.rail.transfer=vi.fn(async()=>{throw new Error("timeout");});const t=signed();await f.pipeline.execute(t);const j=f.store.jobs.get(t.tradeId)!;f.rail.findTransfer=vi.fn(async()=>({id:"late",status:"executed" as const,payer:j.payer,payee:j.payee,amount:j.amount,description:paymentDescription(j)}));await reconcile(f.store,f.rail,j);await reconcile(f.store,f.rail,j);expect(f.store.pool).toBe(10);expect(f.rail.transfer).toHaveBeenCalledTimes(1);});
  it("rejects negative and fractional-cent requests",async()=>{const f=fixture();await expect(f.pipeline.execute(signed({amount:-1}))).rejects.toThrow();await expect(f.pipeline.execute(signed({amount:1.001}))).rejects.toThrow();});
  it("verifies the team's P-256 browser signature format",()=>{const pair=crypto.generateKeyPairSync("ec",{namedCurve:"prime256v1"});const t=signed();t.signature=crypto.sign("sha256",Buffer.from(canonicalTradePayload(t)),{key:pair.privateKey,dsaEncoding:"ieee-p1363"}).toString("base64");expect(verifyTradeSignature(t,pair.publicKey.export({type:"spki",format:"pem"}).toString())).toBe(true);});
});

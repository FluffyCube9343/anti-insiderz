import { createPublicKey, X509Certificate } from "node:crypto";
import { ansConfig, nessieConfig } from "./config";
import type { AgentIdentity, AnsRegistry, DecisionKind, Market, PaymentJob, PaymentRail, PaymentState, TradeDecision, TradeRequest, TradeStore, Transfer } from "./domain";

export function agentFromRow(d: any): AgentIdentity {
  let publicKey=d.public_key;
  try {publicKey=normalizedKey(publicKey);}catch{ /* Setup screen will report an unusable stored key. */ }
  return { agentId:d.agent_id, registryId:d.registry_id, displayName:d.display_name || d.agent_id, walletId:d.wallet_id, affiliations:d.affiliations, publicKey, registeredAt:d.registered_at instanceof Date?d.registered_at.toISOString():d.registered_at };
}
export function marketFromRow(d: any): Market {
  return { marketId:d.market_id, subject:d.subject, restrictedAffiliations:d.restricted_affiliations, pool:{outcomeA:Number(d.outcome_a_total),outcomeB:Number(d.outcome_b_total)},status:d.status, materialEventAt:d.material_event_at instanceof Date?d.material_event_at.toISOString():d.material_event_at, winningOutcome:d.winning_outcome };
}
export function decisionFromRow(d: any): TradeDecision {
  return {tradeId:d.trade_id, decision:d.decision, reasons:d.reasons, timestamp:d.created_at instanceof Date?d.created_at.toISOString():d.created_at, hashPrev:d.hash_prev, hash:d.hash, sequence:Number(d.sequence)};
}
export interface SqlClient {
  query(text:string, values?:any[]):Promise<{rows:any[]}>;
}
export class PostgresTradeStore implements TradeStore {
  constructor(readonly db:SqlClient) {}
  async getAgent(id:string) {const {rows}=await this.db.query("select * from public.agent_identities where agent_id=$1",[id]);return rows[0]?agentFromRow(rows[0]):null;}
  async getMarket(id:string) {const {rows}=await this.db.query("select * from public.markets where market_id=$1",[id]);return rows[0]?marketFromRow(rows[0]):null;}
  async reserveNonce(nonce:string,tradeId:string) {
    const {rows}=await this.db.query("insert into public.trade_nonces(nonce,trade_id) values ($1,$2) on conflict do nothing returning nonce",[nonce,tradeId]);
    return rows.length===1;
  }
  async prepare(trade:TradeRequest,pool:string,reasons:string[],flag:boolean):Promise<PaymentJob> {
    const {rows}=await this.db.query("select public.prepare_trade($1::jsonb,$2,$3::text[],$4) as job",[JSON.stringify(trade),pool,reasons,flag]);return rows[0].job;
  }
  async finish(id:string,state:PaymentState,transferId:string|null,reason:string):Promise<PaymentJob> {
    const {rows}=await this.db.query("select public.finish_payment($1::uuid,$2,$3,$4) as job",[id,state,transferId,reason]);
    const job=rows[0].job;return {...job,decision:job.decision?decisionFromRow(job.decision):undefined};
  }
  async appendDecision(trade:TradeRequest,decision:DecisionKind,reasons:string[]) {
    const {rows}=await this.db.query("select public.append_decision_v2($1::uuid,$2,$3::text[],$4::jsonb) as decision",[trade.tradeId,decision,reasons,JSON.stringify(trade)]);
    return decisionFromRow(rows[0].decision);
  }
}

export function normalizedKey(pem:string) {
  return createPublicKey(pem).export({type:"spki",format:"pem"}).toString().trim();
}
export function certificateKey(pem:string,ansName:string,now=Date.now()) {
  const cert=new X509Certificate(pem);
  const sans=(cert.subjectAltName || "").split(/,\s*/);
  if(!sans.includes("URI:"+ansName))throw new Error("Certificate does not bind this ANS URI.");
  if(now<Date.parse(cert.validFrom) || now>=Date.parse(cert.validTo))throw new Error("ANS identity certificate is not currently valid.");
  const type=cert.publicKey.asymmetricKeyType,details=cert.publicKey.asymmetricKeyDetails;
  if(!((type==="rsa" && (details?.modulusLength ?? 0)>=2048)||(type==="ec" && details?.namedCurve==="prime256v1")))throw new Error("RSA 2048+ or ECDSA P-256 identity key required.");
  return cert.publicKey.export({type:"spki",format:"pem"}).toString();
}
export class AnsHttpRegistry implements AnsRegistry {
  private async request(path:string) {
    const c=ansConfig();
    const r=await fetch(c.base+path,{headers:{Authorization:c.authorization,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(10000),redirect:"error"});
    if(!r.ok)throw new Error(`ANS returned HTTP ${r.status}.`);
    return r.json();
  }
  private path(agent:AgentIdentity) {
    if(!agent.registryId || !/^[0-9a-f-]{36}$/i.test(agent.registryId))throw new Error("Agent registry UUID is missing.");
    // Official SDK V1 endpoints match this project's issued registrations.
    return "/v1/agents/"+encodeURIComponent(agent.registryId);
  }
  async publicKey(agent:AgentIdentity) {
    const rows=await this.request(this.path(agent)+"/certificates/identity");
    if(!Array.isArray(rows))throw new Error("Invalid ANS certificate response.");
    for(const row of rows) {
      try { const key=certificateKey(row.certificatePEM,agent.agentId); if(normalizedKey(key)===normalizedKey(agent.publicKey))return key; } catch { /* Examine other rotation certificates. */ }
    }
    throw new Error("No current ANS-issued certificate matches this agent and stored public key.");
  }
  async validate(agent:AgentIdentity) {
    const d=await this.request(this.path(agent));
    if(d.agentId!==agent.registryId || d.ansName!==agent.agentId)return {valid:false,reason:"Registry UUID / ANS URI mismatch."};
    const s=d.agentStatus;
    if((typeof s==="string"?s:s?.status)!=="ACTIVE")return {valid:false,reason:"ANS registration is not ACTIVE (revoked, pending, or expired)."};
    // Go's zero timestamp means unspecified. The issued certificate provides a mandatory expiry in gate 1.
    const expiry=typeof s==="object"?s?.expiresAt:undefined;
    if(expiry && !expiry.startsWith("0001-01-01")) {
      if(!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry)<=Date.now())return {valid:false,reason:"ANS registration expired or expiry is invalid."};
    }
    return {valid:true};
  }
}

export function parseTransfer(d:any):Transfer {
  if(!d || typeof d._id!=="string" || !["pending","executed","cancelled"].includes(d.status) || typeof d.payer_id!=="string" || typeof d.payee_id!=="string" || !Number.isFinite(d.amount) || d.amount<=0)throw new Error("Unrecognized Nessie transfer response; manual reconciliation required.");
  return {id:d._id,status:d.status,payer:d.payer_id,payee:d.payee_id,amount:d.amount,description:d.description || ""};
}
export class NessiePayments implements PaymentRail {
  private async request(path:string,init?:RequestInit) {
    const c=nessieConfig();
    const url=new URL(path,c.base.endsWith("/")?c.base:c.base+"/"); url.searchParams.set("key",c.key);
    const r=await fetch(url,{...init,cache:"no-store",signal:AbortSignal.timeout(15000),redirect:"error"});
    if(!r.ok)throw new Error(`Nessie returned HTTP ${r.status}.`);
    return r.json();
  }
  async balance(account:string) {
    const d=await this.request("/accounts/"+encodeURIComponent(account));
    if(typeof d.balance!=="number" || !Number.isFinite(d.balance) || d.balance<0)throw new Error("Invalid Nessie balance.");
    return d.balance;
  }
  async transfer(payer:string,payee:string,amount:number,description:string) {
    const d=await this.request("/accounts/"+encodeURIComponent(payer)+"/transfers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({medium:"balance",payee_id:payee,amount,description,transaction_date:new Date().toISOString().slice(0,10)})});
    if(typeof d.objectCreated?._id!=="string")throw new Error("Nessie transfer ID missing; do not retry the payment.");
    return this.getTransfer(d.objectCreated._id);
  }
  async getTransfer(id:string) { return parseTransfer(await this.request("/transfers/"+encodeURIComponent(id))); }
  async findTransfer(payer:string,description:string) {
    const data=await this.request("/accounts/"+encodeURIComponent(payer)+"/transfers");
    if(!Array.isArray(data))throw new Error("Invalid Nessie transfer list.");
    const matches=data.filter(d=>d.description===description && d.payer_id===payer);
    if(matches.length>1)throw new Error("Multiple matching transfers; manual review required.");
    return matches.length ? parseTransfer(matches[0]):null;
  }
}

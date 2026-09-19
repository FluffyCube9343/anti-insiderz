import { NextResponse } from "next/server";
import { adminAuthorized,unavailable } from "@/lib/http";
import { database } from "@/lib/db";
import { ansConfig } from "@/lib/config";
import { certificateKey, AnsHttpRegistry, NessiePayments } from "@/lib/providers";
import { uuid } from "@/lib/validation";
export async function POST(request:Request) {
  if(!adminAuthorized(request))return NextResponse.json({error:"Valid admin key required."},{status:401});
  const b=await request.json().catch(()=>null);
  if(!b||!uuid.test(b.registryId)||typeof b.walletId!=="string"||!b.walletId.trim()||!Array.isArray(b.affiliations)||b.affiliations.some((x:unknown)=>typeof x!=="string"||x.length>100))return NextResponse.json({error:"Registry UUID, Nessie wallet ID, and affiliation array required."},{status:400});
  try {
    const c=ansConfig(),path=`${c.base}/v1/agents/${b.registryId}`;
    const options={headers:{Authorization:c.authorization},cache:"no-store" as const,signal:AbortSignal.timeout(10000),redirect:"error" as const};
    const [detailsResponse,certResponse]=await Promise.all([fetch(path,options),fetch(path+"/certificates/identity",options)]);
    if(!detailsResponse.ok||!certResponse.ok)throw new Error("ANS provisioning failed");
    const details=await detailsResponse.json(),certificates=await certResponse.json();
    if(details.agentId!==b.registryId||typeof details.ansName!=="string"||!Array.isArray(certificates))throw new Error("Invalid registry data");
    let publicKey="";
    for(const cert of certificates) {try {publicKey=certificateKey(cert.certificatePEM,details.ansName);break;}catch{}}
    if(!publicKey)return NextResponse.json({error:"No valid RSA or P-256 identity certificate for this agent."},{status:409});
    const identity={agentId:details.ansName,registryId:b.registryId,displayName:details.agentDisplayName,publicKey,walletId:b.walletId,affiliations:b.affiliations,registeredAt:details.registrationTimestamp};
    const valid=await new AnsHttpRegistry().validate(identity);
    if(!valid.valid)return NextResponse.json({error:valid.reason},{status:409});
    const balance=await new NessiePayments().balance(b.walletId);
    const db=database();
    // The database locks this identity and prevents wallet replacement once any
    // payment intent exists. Placeholder wallets can be corrected before trading.
    const {error}=await db.from("agent_identities").upsert({agent_id:identity.agentId,registry_id:b.registryId,display_name:identity.displayName,public_key:publicKey,wallet_id:b.walletId,affiliations:b.affiliations,registered_at:identity.registeredAt});
    if(error?.message.includes("Wallet binding"))return NextResponse.json({error:"Wallet binding cannot change after a payment intent exists."},{status:409});
    if(error)throw error;return NextResponse.json({agentId:identity.agentId,balance});
  }catch(e){return unavailable(e);}
}

import { NextResponse } from "next/server";
import { adminAuthorized,unavailable } from "@/lib/http";
import { store } from "@/lib/services";
import { NessiePayments } from "@/lib/providers";
import { paymentDescription,settleEvidence } from "@/lib/payments";
import type { PaymentJob } from "@/lib/domain";
export async function POST(request:Request) {
  if(!adminAuthorized(request))return NextResponse.json({error:"Valid admin key required."},{status:401});
  try {const s=store();const {rows:data}=await s.db.query("select * from public.payment_jobs where kind='payout' and state='queued' order by id limit 1");
    if(!data.length)return NextResponse.json({message:"No queued payouts."});
    let claimed;
    try {const {rows}=await s.db.query("select public.claim_payout($1::uuid) as job",[data[0].id]);claimed=rows[0].job;}
    catch{return NextResponse.json({error:"Pool account has an unresolved payment or this payout was already claimed. Reconcile first."},{status:409});}
    const job=claimed as PaymentJob,rail=new NessiePayments();
    try {if(await rail.balance(job.payer)<Number(job.amount))throw new Error("Insufficient pool balance");
      const t=await rail.transfer(job.payer,job.payee,Number(job.amount),paymentDescription(job));
      const r=await settleEvidence(s,job,t);return NextResponse.json({id:r.id,state:r.state});
    }catch{await s.finish(job.id,"review",null,"Payout outcome requires review; no automatic resend.");return NextResponse.json({id:job.id,state:"review"});}
  }catch(e){return unavailable(e);}
}

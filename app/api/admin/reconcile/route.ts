import { NextResponse } from "next/server";
import { adminAuthorized,unavailable } from "@/lib/http";
import { store } from "@/lib/services";
import { NessiePayments } from "@/lib/providers";
import { reconcile } from "@/lib/payments";
import type { PaymentJob } from "@/lib/domain";
export async function POST(request:Request) {
  if(!adminAuthorized(request))return NextResponse.json({error:"Valid admin key required."},{status:401});
  try {const s=store();const {rows:data}=await s.db.query("select * from public.payment_jobs where state in ('sending','pending','review') order by created_at limit 20");
    const results=[];for(const job of data as PaymentJob[]) {try {const r=await reconcile(s,new NessiePayments(),job);results.push({id:r.id,state:r.state});}catch{results.push({id:job.id,state:job.state,error:"Provider lookup failed or evidence mismatched; no payment resent."});}}
    return NextResponse.json({results});
  }catch(e){return unavailable(e);}
}

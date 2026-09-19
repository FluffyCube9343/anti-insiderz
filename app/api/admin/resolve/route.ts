import { NextResponse } from "next/server";
import { adminAuthorized,unavailable } from "@/lib/http";
import { store } from "@/lib/services";
import { nessieConfig } from "@/lib/config";
import { uuid } from "@/lib/validation";
export async function POST(request:Request) {
  if(!adminAuthorized(request))return NextResponse.json({error:"Valid admin key required."},{status:401});
  const b=await request.json().catch(()=>null);
  if(!b||!uuid.test(b.marketId)||!["A","B"].includes(b.outcome))return NextResponse.json({error:"Market UUID and winning outcome A/B required."},{status:400});
  try {const {error}=await store().db.rpc("prepare_resolution",{p_market:b.marketId,p_outcome:b.outcome,p_pool:nessieConfig().pool});
    if(error)return NextResponse.json({error:"Resolution refused. Reconcile pending trades, verify the position ledger, and confirm the market outcome has not already been set."},{status:409});
    return NextResponse.json({ok:true,message:"Market closed. Payouts queued; process payouts to send funds."});
  }catch(e){return unavailable(e);}
}

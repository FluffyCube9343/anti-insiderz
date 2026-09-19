import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { adminAuthorized, unavailable } from "@/lib/http";
import { uuid } from "@/lib/validation";
export async function POST(request:Request) {
  if(!adminAuthorized(request))return NextResponse.json({error:"Valid admin key required."},{status:401});
  const body=await request.json().catch(()=>null);
  if(!body || !uuid.test(body.marketId) || typeof body.materialEventAt!=="string" || !Number.isFinite(Date.parse(body.materialEventAt)))return NextResponse.json({error:"Market UUID and valid materialEventAt timestamp required."},{status:400});
  try {
    const {data,error}=await database().from("markets").update({material_event_at:body.materialEventAt}).eq("market_id",body.marketId).eq("status","open").select("market_id").maybeSingle();
    if(error)throw error;if(!data)return NextResponse.json({error:"Open market not found."},{status:404});
    return NextResponse.json({ok:true});
  }catch(e){return unavailable(e);}
}

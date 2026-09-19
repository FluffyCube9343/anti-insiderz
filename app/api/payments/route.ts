import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {data,error}=await database().from("payment_jobs").select("id,market_id,agent_id,kind,amount,state,transfer_id,created_at").order("created_at",{ascending:false}).limit(100);if(error)throw error;return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}});}
  catch(e){return unavailable(e);}
}

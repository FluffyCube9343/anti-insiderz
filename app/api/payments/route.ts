import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {rows}=await database().query("select id,market_id,agent_id,kind,amount,state,transfer_id,created_at from public.payment_jobs order by created_at desc limit 100");return NextResponse.json(rows,{headers:{"Cache-Control":"no-store"}});}
  catch(e){return unavailable(e);}
}

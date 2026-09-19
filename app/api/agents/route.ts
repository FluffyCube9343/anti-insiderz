import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { agentFromRow } from "@/lib/providers";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {data,error}=await database().from("agent_identities").select("*").order("agent_id");if(error)throw error;
    return NextResponse.json(data.map(d=>{const {walletId,...a}=agentFromRow(d);return a;}),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return unavailable(e);}
}

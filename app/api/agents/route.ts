import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { agentFromRow } from "@/lib/providers";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {rows}=await database().query("select * from public.agent_identities order by agent_id");
    return NextResponse.json(rows.map(d=>{const {walletId,...a}=agentFromRow(d);return a;}),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return unavailable(e);}
}

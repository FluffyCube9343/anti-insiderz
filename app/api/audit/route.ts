import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { decisionFromRow } from "@/lib/providers";
import { unavailable } from "@/lib/http";
import { sha256 } from "@/lib/crypto";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
  try {
    const url=new URL(request.url);const after=Number(url.searchParams.get("after")||0);
    if(!Number.isSafeInteger(after)||after<0)return NextResponse.json({error:"Invalid audit cursor."},{status:400});
    const db=database();
    const {rows:data}=await db.query("select * from public.trade_decisions where sequence>$1 order by sequence limit 200",[after]);
    const {rows:previousRows}=after?await db.query("select hash from public.trade_decisions where sequence<=$1 order by sequence desc limit 1",[after]):{rows:[]};
    const prior=previousRows[0];
    let previous=prior?.hash ?? null;
    const rows=data.map(d=>{
      const linkValid=d.hash_prev===previous;
      let payloadValid:boolean|null=null;
      if(d.canonical_payload) {
        try {const p=JSON.parse(d.canonical_payload);payloadValid=sha256(d.canonical_payload)===d.hash && p.hashPrev===d.hash_prev && p.tradeId===d.trade_id && p.decision===d.decision && Date.parse(p.timestamp)===new Date(d.created_at).getTime() && JSON.stringify(p.reasons)===JSON.stringify(d.reasons) && JSON.stringify(p.trade)===JSON.stringify(d.trade_data);}
        catch{payloadValid=false;}
      }
      previous=d.hash;
      return {...decisionFromRow(d),sequence:Number(d.sequence),integrity:!linkValid||payloadValid===false?"invalid":payloadValid===null?"legacy":"verified",trade:d.trade_data};
    });
    return NextResponse.json({decisions:rows,nextCursor:Number(data.at(-1)?.sequence ?? after),hasMore:data.length===200},{headers:{"Cache-Control":"no-store"}});
  } catch(e){return unavailable(e);}
}

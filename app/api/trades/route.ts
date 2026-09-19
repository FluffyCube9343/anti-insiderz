import { NextResponse } from "next/server";
import { supabaseConfig, nessieConfig, timingWindow } from "@/lib/config";
import { AnsHttpRegistry, NessiePayments, SupabaseTradeStore } from "@/lib/providers";
import { TradePipeline } from "@/lib/trade-pipeline";
import { isTrade } from "@/lib/validation";
import { unavailable } from "@/lib/http";
export const runtime="nodejs";
export async function POST(request:Request) {
  const body=await request.json().catch(()=>null);
  if(!isTrade(body))return NextResponse.json({error:"Invalid signed trade. UUID IDs, one-time nonce, ISO timestamp, RSA signature, and a positive amount up to $10,000 with at most two decimals are required."},{status:400});
  try {
    const c=supabaseConfig();
    const pipeline=new TradePipeline(new SupabaseTradeStore(c.supabaseUrl,c.supabaseServiceKey),new AnsHttpRegistry(),new NessiePayments(),()=>nessieConfig().pool,timingWindow());
    return NextResponse.json(await pipeline.execute(body),{headers:{"Cache-Control":"no-store"}});
  } catch(e) {return unavailable(e);}
}

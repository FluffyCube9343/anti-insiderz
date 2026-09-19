import { NextResponse } from "next/server";
import { database } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET() {
  const names=["SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","ANS_API_KEY","NESSIE_API_KEY","NESSIE_POOL_ACCOUNT_ID"];
  const missing=names.filter(n=>!process.env[n]?.trim());
  if(!process.env.ANS_API_SECRET && !process.env.ANS_API_KEY?.includes(":"))missing.push("ANS_API_SECRET");
  let databaseReady=false,agents=0,error:string|null=null;
  try {
    const db=database();const checks=await Promise.all([db.from("payment_jobs").select("id").limit(1),db.from("agent_identities").select("registry_id",{count:"exact"}).not("registry_id","is",null).limit(1)]);
    databaseReady=checks.every(c=>!c.error);agents=checks[1].count||0;
    if(!databaseReady)error="Supabase unavailable or migration 0003 is not applied.";
  }catch{error="Supabase connection is not configured or unavailable.";}
  return NextResponse.json({missing,databaseReady,agents,ready:databaseReady&&agents>0&&!missing.length,error},{headers:{"Cache-Control":"no-store"}});
}

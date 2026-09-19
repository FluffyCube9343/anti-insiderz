import { NextResponse } from "next/server";
import { database } from "@/lib/db";
export const dynamic="force-dynamic";
export async function GET() {
  const names=["TIGER_DATABASE_URL","ANS_API_KEY","NESSIE_API_KEY","NESSIE_POOL_ACCOUNT_ID"];
  const missing=names.filter(n=>!process.env[n]?.trim());
  if(!process.env.ANS_API_SECRET && !process.env.ANS_API_KEY?.includes(":"))missing.push("ANS_API_SECRET");
  let databaseReady=false,agents=0,error:string|null=null;
  try {
    const db=database();await db.query("select id from public.payment_jobs limit 1");
    const {rows}=await db.query("select count(*)::int as count from public.agent_identities where registry_id is not null");
    databaseReady=true;agents=rows[0].count;
  }catch{error="Tiger Data unavailable or not initialized. Set TIGER_DATABASE_URL and run npm run db:migrate.";}
  return NextResponse.json({provider:"tigerdata",missing,databaseReady,agents,ready:databaseReady&&agents>0&&!missing.length,error},{headers:{"Cache-Control":"no-store"}});
}

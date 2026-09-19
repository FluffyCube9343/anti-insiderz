import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { marketFromRow } from "@/lib/providers";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {rows}=await database().query("select * from public.markets order by market_id");return NextResponse.json(rows.map(marketFromRow),{headers:{"Cache-Control":"no-store"}});}
  catch(e){return unavailable(e);}
}

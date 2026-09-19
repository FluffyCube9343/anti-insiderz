import { NextResponse } from "next/server";
import { database } from "@/lib/db";
import { marketFromRow } from "@/lib/providers";
import { unavailable } from "@/lib/http";
export const dynamic="force-dynamic";
export async function GET() {
  try {const {data,error}=await database().from("markets").select("*").order("market_id");if(error)throw error;return NextResponse.json(data.map(marketFromRow),{headers:{"Cache-Control":"no-store"}});}
  catch(e){return unavailable(e);}
}

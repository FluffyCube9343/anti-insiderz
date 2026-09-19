import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/config";
import { createClient } from "@supabase/supabase-js";
export async function GET() { try { const c = supabaseConfig(); const db = createClient(c.supabaseUrl, c.supabaseServiceKey, { auth: { persistSession: false } }); const { data, error } = await db.from("trade_decisions").select("*").order("sequence", { ascending: false }).limit(100); if (error) throw error; return NextResponse.json(data.map(d => ({ tradeId: d.trade_id, decision: d.decision, reasons: d.reasons, timestamp: d.created_at, hashPrev: d.hash_prev, hash: d.hash }))); } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Unavailable" }, { status: 503 }); } }

import { NextResponse } from "next/server";
import { supabaseConfig } from "@/lib/config";
import { SupabaseTradeStore } from "@/lib/providers";

// Public agent record for client-side key verification. Returns only what the
// registry itself would show: id, affiliations, and the PUBLIC key. Never the wallet balance.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const c = supabaseConfig();
    const store = new SupabaseTradeStore(c.supabaseUrl, c.supabaseServiceKey);
    const agent = await store.getAgent(id);
    if (!agent) return NextResponse.json({ error: "Unknown agent identity." }, { status: 404 });
    return NextResponse.json({ agentId: agent.agentId, affiliations: agent.affiliations, publicKey: agent.publicKey, registeredAt: agent.registeredAt, email: agent.email ?? null, birthday: agent.birthday ?? null, role: agent.role ?? null, fullName: agent.fullName ?? null });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unavailable" }, { status: 503 });
  }
}

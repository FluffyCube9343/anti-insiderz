import { supabaseConfig } from "./config";
import { SupabaseTradeStore } from "./providers";
export function store() {const c=supabaseConfig();return new SupabaseTradeStore(c.supabaseUrl,c.supabaseServiceKey);}

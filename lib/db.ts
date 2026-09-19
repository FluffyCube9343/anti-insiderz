import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
export function database() { const c = supabaseConfig(); return createClient(c.supabaseUrl, c.supabaseServiceKey, { auth: { persistSession: false } }); }

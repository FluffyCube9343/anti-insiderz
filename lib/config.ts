function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing required configuration: ${name}`); return value; }
export function supabaseConfig() {
  return {
    supabaseUrl: required("SUPABASE_URL"), supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY")
  };
}
export function tradeConfig() {
  return {
    ...supabaseConfig(),
    nessieBaseUrl: required("NESSIE_BASE_URL"), nessieKey: required("NESSIE_API_KEY"), poolAccountId: required("NESSIE_POOL_ACCOUNT_ID"),
    ansBaseUrl: required("ANS_BASE_URL"), ansKey: required("ANS_API_KEY"), ansSecret: required("ANS_API_SECRET"), ansLookupTemplate: required("ANS_AGENT_LOOKUP_URL_TEMPLATE"),
    timingWindowMinutes: Number(process.env.MATERIAL_EVENT_WINDOW_MINUTES ?? 60)
  };
}

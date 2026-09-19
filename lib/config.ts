function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`Missing required configuration: ${name}`); return value; }
function optional(name: string, fallback = ""): string { return process.env[name] ?? fallback; }
export function supabaseConfig() {
  return {
    supabaseUrl: required("SUPABASE_URL"), supabaseServiceKey: required("SUPABASE_SERVICE_ROLE_KEY")
  };
}
export function tradeConfig() {
  const ansRaw = required("ANS_API_KEY");
  // Accept both ans-cli's combined key:secret and a separate ANS_API_SECRET.
  const [ansKeyPart, ansSecretPart] = ansRaw.split(":");
  return {
    ...supabaseConfig(),
    nessieBaseUrl: optional("NESSIE_BASE_URL"), nessieKey: optional("NESSIE_API_KEY"), poolAccountId: optional("NESSIE_POOL_ACCOUNT_ID", "demo-pool"),
    ansBaseUrl: required("ANS_BASE_URL"), ansKey: ansKeyPart, ansSecret: optional("ANS_API_SECRET", ansSecretPart ?? ""), ansLookupTemplate: optional("ANS_AGENT_LOOKUP_URL_TEMPLATE", "/v1/agents/{agentId}"),
    timingWindowMinutes: Number(process.env.MATERIAL_EVENT_WINDOW_MINUTES ?? 60)
  };
}

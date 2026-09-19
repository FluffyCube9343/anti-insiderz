function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /paste.*here/i.test(value)) throw new Error(`Missing required configuration: ${name}`);
  return value;
}
export function timingWindow() {
  const n = Number(process.env.MATERIAL_EVENT_WINDOW_MINUTES ?? 60);
  if (!Number.isFinite(n) || n < 0 || n > 10080) throw new Error("Invalid material-event window.");
  return n;
}
export function nessieConfig() {
  return { base: required("NESSIE_BASE_URL"), key: required("NESSIE_API_KEY"), pool: required("NESSIE_POOL_ACCOUNT_ID") };
}
export function ansConfig() {
  const base = process.env.ANS_BASE_URL || "https://api.ote-godaddy.com";
  if (!base.startsWith("https://")) throw new Error("ANS requires HTTPS.");
  const key = required("ANS_API_KEY");
  const secret = process.env.ANS_API_SECRET;
  const authorization = secret ? `sso-key ${key}:${secret}` : key.includes(":") ? `sso-key ${key}` : "";
  if (!authorization) throw new Error("Missing required configuration: ANS_API_SECRET");
  return { base: base.replace(/\/$/,""), authorization };
}

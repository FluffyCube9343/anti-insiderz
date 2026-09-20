// Browser-side trade signing for the live backend. The identity key stays in
// this page: it is imported into WebCrypto, used for signatures, and never
// sent anywhere. Server only ever sees signatures, same as scripts/sign-trade.mjs.
"use strict";

// Base64 helpers for PEM <-> ArrayBuffer.
function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// --- Key import -----------------------------------------------------------

// SEC1 ("BEGIN EC PRIVATE KEY") -> JWK. P-256 only, expects the public point
// included (Go's x509.MarshalECPrivateKey writes it).
function sec1ToJwk(der) {
  const b = new Uint8Array(der);
  let i = 0;
  if (b[i++] !== 0x30) throw new Error("Not a SEC1 key.");
  let l = b[i++]; if (l & 0x80) i += l & 0x7f;
  if (b[i++] !== 0x02 || b[i++] !== 0x01 || b[i++] !== 0x01) throw new Error("Bad SEC1 version.");
  if (b[i++] !== 0x04) throw new Error("Bad SEC1 private key.");
  const dlen = b[i++];
  const d = b.slice(i, i + dlen); i += dlen;
  let pub = null;
  while (i < b.length) {
    const tag = b[i++];
    let len = b[i++];
    if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | b[i++]; }
    if (tag === 0xa1) {
      let j = i;
      if (b[j++] !== 0x03) throw new Error("Bad SEC1 public key.");
      let bl = b[j++]; if (bl & 0x80) { const n = bl & 0x7f; bl = 0; for (let k = 0; k < n; k++) bl = (bl << 8) | b[j++]; }
      j++; // unused-bits byte
      pub = b.slice(j, j + bl - 1);
    }
    i += len;
  }
  if (!pub || pub.length !== 65 || pub[0] !== 4) throw new Error("Only P-256 SEC1 keys with the public point included are supported.");
  const b64u = a => btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)) };
}

const RSA_ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
const EC_ALG = { name: "ECDSA", namedCurve: "P-256" };

// Accepts SEC1 EC, PKCS#1 RSA, or PKCS#8 (either). Returns a non-extractable signing key.
async function importIdentityKey(pem) {
  if (pem.includes("BEGIN EC PRIVATE KEY")) {
    return crypto.subtle.importKey("jwk", sec1ToJwk(pemToArrayBuffer(pem)), EC_ALG, false, ["sign"]);
  }
  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error("PKCS#1 RSA key - convert it first: openssl pkcs8 -topk8 -nocrypt -in identity.key -out identity-pkcs8.key");
  }
  if (pem.includes("BEGIN PRIVATE KEY")) {
    const der = pemToArrayBuffer(pem);
    try { return await crypto.subtle.importKey("pkcs8", der, EC_ALG, false, ["sign"]); }
    catch { return crypto.subtle.importKey("pkcs8", der, RSA_ALG, false, ["sign"]); }
  }
  throw new Error("Unrecognized key format - expected the identity key ans-cli generated.");
}

// Registered public key (SPKI PEM) for the login proof. Tries EC, then RSA.
async function importPublicKey(pem) {
  const der = pemToArrayBuffer(pem);
  try { return await crypto.subtle.importKey("spki", der, EC_ALG, false, ["verify"]); }
  catch { return crypto.subtle.importKey("spki", der, RSA_ALG, false, ["verify"]); }
}

// --- Signing ---------------------------------------------------------------

// WebCrypto emits raw r||s; Node's crypto.verify expects DER. Encode it.
function derInt(x) {
  let a = new Uint8Array(x), s = 0;
  while (s < a.length - 1 && a[s] === 0 && (a[s + 1] & 0x80) === 0) s++;
  a = a.slice(s);
  const pad = (a[0] & 0x80) ? 1 : 0;
  const out = new Uint8Array(2 + pad + a.length);
  out[0] = 0x02; out[1] = pad + a.length;
  out.set(a, 2 + pad);
  return out;
}
function derEncodeEc(raw) {
  const r = derInt(raw.slice(0, 32)), s = derInt(raw.slice(32, 64));
  const out = new Uint8Array(2 + r.length + s.length);
  out[0] = 0x30; out[1] = r.length + s.length;
  out.set(r, 2); out.set(s, 2 + r.length);
  return out;
}

// Sign bytes with whatever algorithm the imported key actually is.
async function signPayload(key, data) {
  if (key.algorithm.name === "ECDSA") {
    const raw = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
    return derEncodeEc(new Uint8Array(raw)); // DER for Node's verifier
  }
  return new Uint8Array(await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, key, data));
}

// Verify params matching the key, for the login nonce proof (all-WebCrypto, raw is fine).
function sigParams(key) {
  return key.algorithm.name === "ECDSA" ? { name: "ECDSA", hash: "SHA-256" } : { name: "RSASSA-PKCS1-v1_5" };
}

// Must match lib/crypto.ts canonicalTradePayload exactly (key order matters).
function canonicalTradePayload(t) {
  return JSON.stringify({
    tradeId: t.tradeId, agentId: t.agentId, marketId: t.marketId,
    outcome: t.outcome, amount: t.amount, nonce: t.nonce, timestamp: t.timestamp,
  });
}

async function signAndSubmitTrade({ agentId, marketId, outcome, amount, keyPem }) {
  const key = await importIdentityKey(keyPem);
  const trade = {
    tradeId: crypto.randomUUID(),
    agentId,
    marketId,
    outcome,
    amount: Number(amount),
    nonce: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const data = new TextEncoder().encode(canonicalTradePayload(trade));
  const sig = await signPayload(key, data);
  const r = await fetch("/api/trades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...trade, signature: bufferToBase64(sig) }),
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}

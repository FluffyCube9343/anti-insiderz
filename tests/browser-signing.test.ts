import { generateKeyPairSync, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { forgetKey, keyReady, loadKey, signTrade } from "../public/signing.js";
import { canonicalTradePayload, verifyTradeSignature } from "../lib/crypto";
const agentId="ans://browser-test";
const trade=()=>({tradeId:randomUUID(),agentId,marketId:randomUUID(),outcome:"A" as const,amount:1.23,nonce:randomUUID(),timestamp:new Date().toISOString()});
function fixture(type:"rsa"|"ec") {
  const pair=type==="rsa"?generateKeyPairSync("rsa",{modulusLength:2048}):generateKeyPairSync("ec",{namedCurve:"prime256v1"});
  const pem=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString();
  return {file:new File([pem],"test.pem"),agent:{agentId,publicKey:pair.publicKey.export({type:"spki",format:"pem"}).toString()}};
}
beforeEach(()=>forgetKey());
describe("Browser signer interoperates with server verifier",()=>{
  for(const type of ["rsa","ec"] as const)it(`signs canonical ${type} trades using WebCrypto`,async()=>{
    const {file,agent}=fixture(type);await loadKey(file,agent);
    const signed=await signTrade(trade());expect(keyReady(agentId)).toBe(true);
    expect(verifyTradeSignature(signed,agent.publicKey)).toBe(true);
    expect(verifyTradeSignature({...signed,amount:2},agent.publicKey)).toBe(false);
    expect(JSON.parse(canonicalTradePayload(signed)).signature).toBeUndefined();
  });
  it("rejects another trader's key and clears previous signing state",async()=>{
    const a=fixture("ec"),b=fixture("ec");await loadKey(a.file,a.agent);
    await expect(loadKey(b.file,a.agent)).rejects.toThrow(/does not match/);
    expect(keyReady(agentId)).toBe(false);
    await expect(signTrade(trade())).rejects.toThrow(/matching private key/);
  });
  it("forgetting the key prevents further signatures",async()=>{
    const {file,agent}=fixture("ec");await loadKey(file,agent);forgetKey();
    await expect(signTrade(trade())).rejects.toThrow(/matching private key/);
  });
});

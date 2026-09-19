// Private keys exist only in browser memory. No storage, network request, or server upload.
let privateKey=null, signingAlgorithm=null, selectedAgent=null;
const bytes=pem=>Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g,"").replace(/\s/g,"")),c=>c.charCodeAt(0));
export function forgetKey() {privateKey=null;signingAlgorithm=null;selectedAgent=null;}
export function keyReady(agentId) {return !!privateKey && selectedAgent===agentId;}
export function canonicalPayload(t) {return JSON.stringify({tradeId:t.tradeId,agentId:t.agentId,marketId:t.marketId,outcome:t.outcome,amount:t.amount,nonce:t.nonce,timestamp:t.timestamp});}
export async function loadKey(file,agent) {
  forgetKey();
  if(!file||!agent)throw new Error("Choose a provisioned trader and a private key file.");
  if(file.size>20000)throw new Error("Key file is too large.");
  const pem=await file.text();
  if(!pem.includes("-----BEGIN PRIVATE KEY-----"))throw new Error("Use an unencrypted PKCS#8 PEM private key. See README for the local conversion command.");
  for(const algorithm of [{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},{name:"ECDSA",namedCurve:"P-256"}]) {
    try {
      const key=await crypto.subtle.importKey("pkcs8",bytes(pem),algorithm,false,["sign"]);
      const pub=await crypto.subtle.importKey("spki",bytes(agent.publicKey),algorithm,false,["verify"]);
      const sigAlg=algorithm.name==="ECDSA"?{name:"ECDSA",hash:"SHA-256"}:{name:"RSASSA-PKCS1-v1_5"};
      const challenge=crypto.getRandomValues(new Uint8Array(32));
      const proof=await crypto.subtle.sign(sigAlg,key,challenge);
      if(!await crypto.subtle.verify(sigAlg,pub,proof,challenge))continue;
      privateKey=key;signingAlgorithm=sigAlg;selectedAgent=agent.agentId;return;
    }catch{ /* Try the other supported certified key algorithm. */ }
  }
  throw new Error("This private key does not match the selected trader's public key.");
}
export async function signTrade(trade) {
  if(!keyReady(trade.agentId))throw new Error("Load this trader's matching private key first.");
  const signature=await crypto.subtle.sign(signingAlgorithm,privateKey,new TextEncoder().encode(canonicalPayload(trade)));
  return {...trade,signature:btoa(String.fromCharCode(...new Uint8Array(signature)))};
}

import {forgetKey,keyReady,loadKey,signTrade} from "/signing.js";
const el=id=>document.getElementById(id);
let markets=[],agents=[],active=null,side="A",lastSigned=null,cursor=0,busy=false,refreshing=false,returnFocus=null;
const money=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD"}).format(n);
const selected=()=>agents.find(a=>a.agentId===el("agent-select")?.value);
async function api(path,body,admin=false) {
  const r=await fetch(path,{method:body?"POST":"GET",headers:{...(body?{"Content-Type":"application/json"}:{}),...(admin?{"x-demo-key":el("admin-key").value}:{})},body:body?JSON.stringify(body):undefined,cache:"no-store"});
  const data=await r.json();if(!r.ok)throw new Error(data.error || "Request failed.");return data;
}
const text=(id,value)=>{if(el(id))el(id).textContent=value;};
function element(tag,value,className="") {const n=document.createElement(tag);n.textContent=value;n.className=className;return n;}
window.toggleTheme=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==="dark"?"light":"dark";localStorage.theme=document.documentElement.dataset.theme;};
document.documentElement.dataset.theme=localStorage.theme||"light";

function showAgent() {
  const a=selected();text("agent-name",a?.displayName||"No trader provisioned");text("agent-uri",a?.agentId||"Ask the operator to provision the registered traders.");
  text("agent-affiliations",a?.affiliations.join(", ")||"No declared restricted affiliations");
  text("key-status",a&&keyReady(a.agentId)?"Matching key loaded in this tab only.":"Load a matching private key to sign trades.");
  if(a)localStorage.setItem("selectedAgent",a.agentId);
}
async function refreshAgents() {
  agents=await api("/api/agents");const select=el("agent-select");if(!select)return;
  const before=select.value||localStorage.getItem("selectedAgent");select.replaceChildren();
  for(const a of agents){const option=element("option",a.displayName);option.value=a.agentId;select.append(option);}
  if(agents.some(a=>a.agentId===before))select.value=before;
  showAgent();
}
function renderMarkets() {
  const list=el("list");list.replaceChildren();
  if(!markets.length)list.append(element("p","No markets yet. Run the demo-market seed in Tiger Data.","muted"));
  for(const m of markets) {
    const card=element("button","","market card");card.type="button";card.style.cssText="width:100%;text-align:left;color:var(--ink);font:inherit";
    const intro=element("span","");intro.append(element("span",m.status.toUpperCase(),"label"),element("h2",m.subject),element("span",`Restricted affiliations: ${m.restrictedAffiliations.join(", ")||"None"}`,"muted"));
    card.append(intro,element("span",`A pool ${money(m.pool.outcomeA)}`,"quote"),element("span",`B pool ${money(m.pool.outcomeB)}`,"quote"),element("span",m.status==="open"?"Trade →":`Winner: ${m.winningOutcome||"Pending"}`,"muted"));
    card.disabled=m.status!=="open";card.onclick=()=>openTicket(m.marketId);list.append(card);
  }
  const select=el("admin-market"),before=select.value;select.replaceChildren();for(const m of markets){const o=element("option",m.subject);o.value=m.marketId;select.append(o);}if(markets.some(m=>m.marketId===before))select.value=before;
}
function openTicket(id) {
  returnFocus=document.activeElement;
  active=markets.find(m=>m.marketId===id);side="A";text("title",active.subject);text("category","SIGNED PARI-MUTUEL TRADE");
  text("info",`Restricted affiliations: ${active.restrictedAffiliations.join(", ")||"None"}. ${active.materialEventAt?"Material event: "+new Date(active.materialEventAt).toLocaleString():"No material event scheduled."}`);
  text("clearance","The server will check your signature, nonce, live identity, balance, affiliation, and timing before sending funds.");
  el("ticket").classList.add("show");el("overlay").classList.add("show");updateYield();el("ticket").querySelector(".close").focus();
}
window.closeTicket=()=>{if(busy)return;el("ticket").classList.remove("show");el("overlay").classList.remove("show");if(returnFocus?.isConnected)returnFocus.focus();else el("replay").focus();};
window.selectSide=value=>{side=value;updateYield();};
window.updateYield=updateYield;
function updateYield() {
  if(!active)return;
  for(const s of ["A","B"]){el("side-"+s).className="choice "+(side===s?"selected":"");el("side-"+s).setAttribute("aria-pressed",String(side===s));}
  const amount=Number(el("amount").value),pool=active.pool,own=side==="A"?pool.outcomeA:pool.outcomeB;
  if(!Number.isFinite(amount)||amount<=0||amount>10000){text("yield","Enter a stake between $0.01 and $10,000.");return;}
  const total=pool.outcomeA+pool.outcomeB+amount,estimate=amount/(own+amount)*total;
  text("yield",`Stake: ${money(amount)} · Estimated return if ${side} wins: ${money(estimate)}. This is your new stake's share at current pool totals, not a fixed payout. Later trades change the estimate. If your outcome loses, this stake pays $0.`);
}
async function submitTrade(replay=false) {
  if(busy)return;busy=true;el("continue").disabled=true;
  try {
    let trade=lastSigned;
    if(!replay){const a=selected();if(!a)throw new Error("Provision and select a trader first.");
      const amount=Number(el("amount").value);if(!Number.isFinite(amount)||amount<=0||amount>10000||Math.abs(amount*100-Math.round(amount*100))>1e-7)throw new Error("Use a positive dollar amount with at most two decimals, up to $10,000.");
      trade=await signTrade({tradeId:crypto.randomUUID(),agentId:a.agentId,marketId:active.marketId,outcome:side,amount,nonce:crypto.randomUUID(),timestamp:new Date().toISOString()});lastSigned=trade;el("replay").disabled=false;
    }
    if(!trade)throw new Error("Submit a signed trade first.");
    const d=await api("/api/trades",trade);const msg=`${d.decision.toUpperCase()}${d.paymentStatus?" · "+d.paymentStatus:""}: ${d.reasons.join(" ")}`;
    text("clearance",msg);text("trade-result",msg);await refresh();
  }catch(e){text("clearance",e.message);text("trade-result",e.message);}finally{busy=false;el("continue").disabled=false;}
}
async function refreshAudit() {
  // Catch up in pages without resetting the existing visible feed.
  for(let page=0;page<5;page++) {
    const data=await api("/api/audit?after="+cursor);
    for(const d of data.decisions){const entry=element("article","","audit-entry "+d.decision);entry.append(element("time",new Date(d.timestamp).toLocaleString()),element("b",`#${d.sequence} ${d.decision.toUpperCase()}`),element("p",d.reasons.join(" ")));
      const details=element("details","");details.append(element("summary",`Chain: ${d.integrity} · ${d.tradeId}`),element("pre",JSON.stringify({hash:d.hash,hashPrev:d.hashPrev,trade:d.trade},null,2)));entry.append(details);el("audit-feed").prepend(entry);
    }
    cursor=data.nextCursor;if(!data.hasMore)break;
  }
  text("audit-status",cursor?"Persisted decisions, newest first. Hash checks cover the retrieved records; they are not an external immutable checkpoint.":"No decisions recorded yet.");
}
async function refresh() {
  if(refreshing)return;refreshing=true;
  try {
    const status=await api("/api/status");text("setup-status",status.ready?"Backend configured. Live provider checks run on every trade.":[status.error,...status.missing.map(n=>"Missing: "+n),status.agents===0?"No traders provisioned yet.":""].filter(Boolean).join("\n"));
    markets=await api("/api/markets");renderMarkets();if(active){active=markets.find(m=>m.marketId===active.marketId)||active;updateYield();}
    await refreshAudit();const payments=await api("/api/payments");text("payments",payments.length?payments.map(p=>`${p.kind} ${p.id} · ${money(p.amount)} · ${p.state}`).join("\n"):"No payment intents yet.");
    text("refresh-error","");
  }catch(e){text("refresh-error",e.message);}finally{refreshing=false;}
}
async function adminAction(path,body) {
  try {const result=await api(path,body,true);text("admin-result",JSON.stringify(result,null,2));await refresh();}
  catch(e){text("admin-result",e.message);}
}
if(el("agent-select")) {
  el("agent-select").onchange=()=>{forgetKey();el("private-key").value="";showAgent();};
  el("private-key").onchange=async()=>{try{await loadKey(el("private-key").files[0],selected());showAgent();}catch(e){text("key-status",e.message);}finally{el("private-key").value="";}};
  refreshAgents().catch(e=>text("key-status",e.message));
}
if(el("list")) {
  el("continue").onclick=()=>submitTrade();el("replay").onclick=()=>submitTrade(true);
  el("event-button").onclick=()=>adminAction("/api/admin/material-event",{marketId:el("admin-market").value,materialEventAt:new Date(Date.now()+60000).toISOString()});
  el("reconcile-button").onclick=()=>adminAction("/api/admin/reconcile",{});
  el("resolve-button").onclick=()=>{if(confirm("Close this market permanently with outcome "+el("winning-outcome").value+" and queue payouts?"))adminAction("/api/admin/resolve",{marketId:el("admin-market").value,outcome:el("winning-outcome").value});};
  el("payout-button").onclick=()=>{if(confirm("Send the next queued payout through Nessie?"))adminAction("/api/admin/payouts",{});};
  el("provision-form").onsubmit=async e=>{e.preventDefault();await adminAction("/api/admin/agents",{registryId:el("registry-id").value.trim(),walletId:el("wallet-id").value.trim(),affiliations:el("affiliations").value.split(",").map(x=>x.trim()).filter(Boolean)});await refreshAgents().catch(e=>text("key-status",e.message));};
  document.addEventListener("keydown",e=>{
    if(!el("ticket").classList.contains("show"))return;
    if(e.key==="Escape")window.closeTicket();
    if(e.key==="Tab"){
      const nodes=[...el("ticket").querySelectorAll("button:not(:disabled),input:not(:disabled)")],first=nodes[0],last=nodes.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  refresh();setInterval(refresh,3000);
}

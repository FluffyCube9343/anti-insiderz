// Teammate's market selections, preserved separately from actual stake/payout accounting.
const references=[
  {title:"Virginia Tech vs Maryland",slug:"cfb-vtech-mary-2026-09-19"},
  {title:"Virginia abortion protection amendment",slug:"will-the-virginia-abortion-protection-amendment-pass"},
  {title:"Virginia congressional map",slug:"new-virginia-congressional-map-used-in-the-midterms"},
  {title:"Bitcoin above $80,000 on September 25",slug:"bitcoin-above-80k-on-september-25-2026"},
  {title:"Ethereum above $3,000 on September 25",slug:"ethereum-above-3000-on-september-25-2026"}
];
const root=document.getElementById("reference-odds");root.replaceChildren();
for(const r of references){
  const card=document.createElement("article"),title=document.createElement("h3"),value=document.createElement("p"),time=document.createElement("small");
  title.textContent=r.title;value.textContent="Loading…";time.className="muted";card.append(title,value,time);root.append(card);
  r.titleNode=title;r.valueNode=value;r.timeNode=time;
}
let loading=false;
async function refresh(){
  if(loading||document.hidden)return;loading=true;
  await Promise.all(references.map(async r=>{
    try{
      const response=await fetch("/api/odds/"+encodeURIComponent(r.slug),{signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error("Unavailable");const d=await response.json();
      r.titleNode.textContent=d.question||r.title;
      r.valueNode.textContent=(d.closed?"Closed · ":"")+d.outcomes.map(o=>`${o.name}: ${(o.price*100).toFixed(1)}%`).join(" · ");
      r.timeNode.textContent=`Polymarket · Retrieved ${new Date().toLocaleTimeString()}${d.updatedAt?" · Source updated "+new Date(d.updatedAt).toLocaleString():""}`;
    }catch{r.valueNode.textContent="Reference odds unavailable";r.timeNode.textContent="No fallback/demo price is shown.";}
  }));loading=false;
}
refresh();setInterval(refresh,30000);

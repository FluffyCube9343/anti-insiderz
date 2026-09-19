import type { PaymentJob, PaymentRail, TradeStore, Transfer } from "./domain";
export const paymentDescription=(job:PaymentJob)=>`NAI:${job.kind}:${job.id}`;
export async function settleEvidence(store:TradeStore,job:PaymentJob,t:Transfer) {
  if(t.payer!==job.payer || t.payee!==job.payee || Math.round(t.amount*100)!==Math.round(Number(job.amount)*100) || t.description!==paymentDescription(job))throw new Error("Transfer does not match payment intent.");
  const state=t.status==="executed"?"settled":t.status==="cancelled"?"failed":"pending";
  return store.finish(job.id,state,t.id,state==="settled"?`${job.kind} payment confirmed executed by Nessie.`:state==="pending"?"Nessie payment pending; pool not credited yet.":"Nessie payment cancelled; pool not credited.");
}
export async function reconcile(store:TradeStore,rail:PaymentRail,job:PaymentJob) {
  if(job.state==="settled" || job.state==="failed" || job.state==="queued")return job;
  const transfer=job.transfer_id?await rail.getTransfer(job.transfer_id):await rail.findTransfer(job.payer,paymentDescription(job));
  if(!transfer)return job; // Absence is not proof a POST failed; never auto-resend.
  return settleEvidence(store,job,transfer);
}

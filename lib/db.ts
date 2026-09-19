import { Pool } from "pg";
import postgresOptions from "./postgres-options.cjs";
const shared=globalThis as typeof globalThis & { tigerPool?: Pool };
export function database() {
  if(!shared.tigerPool) {
    shared.tigerPool=new Pool(postgresOptions());
    shared.tigerPool.on("error",()=>console.error("Tiger Data idle connection failed."));
  }
  return shared.tigerPool;
}

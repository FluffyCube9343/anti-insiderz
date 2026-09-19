import { database } from "./db";
import { PostgresTradeStore } from "./providers";
export function store() {return new PostgresTradeStore(database());}

import { readFileSync } from "node:fs";
import { runInNewContext, Script } from "node:vm";
import { expect, it } from "vitest";
const scope = { window: {} as any }; runInNewContext(readFileSync("public/bank-state.js", "utf8"), scope);
const account = { connected: true, owner: "demo@example.test", balance: 500 };
function read(value: unknown, email = "demo@example.test") { return scope.window.BankState.account({ getItem: () => JSON.stringify(value) }, email); }
it("shows the linked account and its balance", () => { expect(read(account)).toEqual(account); });
it("accepts a linked zero balance", () => { expect(read({ ...account, balance: 0 }).balance).toBe(0); });
it("does not show cash for an unlinked account", () => { expect(read({ ...account, connected: false })).toBeNull(); expect(read(null)).toBeNull(); });
it("does not show another user's saved balance", () => { expect(read(account, "other@example.test")).toBeNull(); expect(read({ balance: 500, connected: true })).toBeNull(); });
it("rejects corrupted balances", () => { expect(read({ ...account, balance: "500" })).toBeNull(); expect(read({ ...account, balance: -10 })).toBeNull(); });
it("normalizes owner email", () => { expect(read(account, " DEMO@example.test ")).toEqual(account); });
it.each(["profile", "banking"])("parses %s page scripts", name => { const html=readFileSync(`public/${name}.html`,"utf8"); for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(()=>new Script(match[1])).not.toThrow(); });

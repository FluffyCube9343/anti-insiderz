import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
const script = readFileSync("public/demo-session.js", "utf8");
const user = { name: "Demo", email: "demo@example.test", birthday: "1997-08-14", role: "Employee" };
const key = "nai.demo-session.v1";
function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) };
}
function run(local = storage(), session = storage(), pathname = "/login.html") {
  const replace = vi.fn(); const listeners: Record<string, Function> = {};
  const window: any = { addEventListener: (name: string, fn: Function) => listeners[name] = fn };
  runInNewContext(script, { localStorage: local, sessionStorage: session, window, location: { pathname, replace }, document: { addEventListener: vi.fn() } });
  return { api: window.DemoSession, replace, listeners };
}
it("restores a remembered login into a fresh tab and skips signup", () => {
  const session = storage(); const { replace } = run(storage({ [key]: JSON.stringify({ version: 1, user, verified: true }) }), session);
  expect(session.getItem("verified")).toBe("yes"); expect(JSON.parse(session.getItem("user")!)).toEqual(user); expect(replace).toHaveBeenCalledWith("markets.html");
});
it("migrates an existing verified session", () => {
  const local = storage(); run(local, storage({ user: JSON.stringify(user), verified: "yes" }), "/index.html");
  expect(JSON.parse(local.getItem(key)!).user).toEqual(user);
});
it("does not remember an unverified profile", () => {
  const local = storage(); const { api } = run(local, storage({ user: JSON.stringify(user) }));
  expect(api.remember()).toBe(false); expect(local.getItem(key)).toBeNull();
});
it("ignores malformed stored profiles", () => {
  expect(run(storage({ [key]: "invalid" })).replace).not.toHaveBeenCalled();
  expect(run(storage({ [key]: JSON.stringify({ version: 1, verified: true, user: {} }) })).replace).not.toHaveBeenCalled();
});
it("persists only profile fields, not credentials", () => {
  const local = storage(); run(local, storage({ user: JSON.stringify({ ...user, password: "secret", apiKey: "secret" }), verified: "yes" }));
  expect(local.getItem(key)).not.toContain("secret");
});
it("sign out removes remembered state and pending trade", () => {
  const local = storage(); const session = storage({ user: JSON.stringify(user), verified: "yes", pendingTrade: "old" });
  run(local, session).api.clear(); expect(local.getItem(key)).toBeNull(); expect(session.getItem("verified")).toBeNull(); expect(session.getItem("pendingTrade")).toBeNull();
});
it("handles storage disabled by the browser", () => {
  const unavailable = { getItem() { throw Error("unavailable"); }, setItem() { throw Error("unavailable"); }, removeItem() { throw Error("unavailable"); } };
  expect(() => run(unavailable as any)).not.toThrow();
});

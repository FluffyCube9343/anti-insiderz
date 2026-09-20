import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
const script = readFileSync("public/theme.js", "utf8");
function setup(saved: string, blocked = false) {
  const root = { dataset: {} as Record<string, string> }; const listeners: Record<string, Function> = {}; const attributes: Record<string, string> = {};
  const window: any = { addEventListener: (name: string, fn: Function) => listeners[name] = fn };
  const storage = { value: saved, getItem() { if(blocked) throw Error(); return this.value; }, setItem(_key: string, value: string) { if(blocked) throw Error(); this.value=value; } };
  runInNewContext(script, { window, document: { documentElement: root, querySelector: () => ({setAttribute: (k: string,v: string)=>attributes[k]=v}), addEventListener() {} }, localStorage: storage });
  return { root, window, storage, listeners, attributes };
}
it("restores dark mode on entry", () => { expect(setup("dark").root.dataset.theme).toBe("dark"); });
it("toggles and remembers both themes", () => { const s=setup("light"); s.window.toggleTheme(); expect(s.storage.value).toBe("dark"); expect(s.attributes["aria-label"]).toBe("Switch to light mode"); s.window.toggleTheme(); expect(s.storage.value).toBe("light"); });
it("supports blocked browser storage", () => { const s=setup("light",true); expect(()=>s.window.toggleTheme()).not.toThrow(); expect(s.root.dataset.theme).toBe("dark"); });
it("syncs theme changes from another tab", () => { const s=setup("light"); s.listeners.storage({key:"theme",newValue:"dark"}); expect(s.root.dataset.theme).toBe("dark"); });

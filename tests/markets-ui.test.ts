import { readFileSync } from "node:fs";
import { Script, runInNewContext } from "node:vm";
import { expect, it } from "vitest";

const html = readFileSync("public/markets.html", "utf8");
const script = html.split("<script>")[1].split("</script>")[0];
it("parses the market page JavaScript", () => { expect(() => new Script(script)).not.toThrow(); });
function estimate(amount: string, price: number) {
  const elements = { amount: { value: amount }, yield: { textContent: "", innerHTML: "" } };
  const fn = script.slice(script.indexOf("function updateYield()"), script.indexOf("function clearTrade()"));
  const result = runInNewContext(fn + "\nupdateYield()", { get: (id: keyof typeof elements) => elements[id], side: "yes", ticketPrice: price });
  return { result, output: elements.yield.innerHTML };
}
it.each([0, 100])("rejects terminal quote %s instead of dividing by zero", price => { expect(estimate("25", price).result).toBe(false); });
it.each(["", "-1", "10001", "0.001", "Infinity"])("rejects invalid budget %s", amount => { expect(estimate(amount, 50).result).toBe(false); });
it("calculates whole-contract payouts from the displayed snapshot", () => {
  const result = estimate("25", 50);
  expect(result.result).toBe(true); expect(result.output).toContain("$50.00"); expect(result.output).not.toContain("Infinity");
});
it("escapes remote market names before HTML insertion", () => {
  const line = script.split("\n").find(line => line.startsWith("const escapeHtml ="));
  const escaped = runInNewContext(line + '\nescapeHtml(value)', { value: '<img src=x onerror="alert(1)">' });
  expect(escaped).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
});

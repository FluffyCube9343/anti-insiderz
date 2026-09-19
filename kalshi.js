/* Public market data only. No credentials or order submission. */
(() => {
  const board = document.getElementById("kalshi-list");
  const status = document.getElementById("kalshi-status");
  const refresh = document.getElementById("kalshi-refresh");
  const quote = value => {
    if (value === null || value === undefined || value === "") return "Unavailable";
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 1
      ? (number * 100).toFixed(2) + "¢" : "Unavailable";
  };
  async function load() {
    refresh.disabled = true;
    board.replaceChildren();
    status.textContent = "Loading Kalshi open markets…";
    if (location.port !== "8001" || location.protocol === "file:") {
      status.textContent = "Start python3 kalshi_server.py and open http://127.0.0.1:8001/login.html to load API data.";
      refresh.disabled = false;
      return;
    }
    try {
      const response = await fetch("/kalshi/markets", {signal: AbortSignal.timeout(15000)});
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.markets)) throw new Error(data.error || "Invalid response");
      status.textContent = data.markets.length + " open markets · Retrieved " +
        new Date(data.fetchedAt).toLocaleString() + " · Indicative quotes; refresh for updates.";
      for (const market of data.markets) {
        const row = document.createElement("details");
        row.className = "card";
        row.style.cssText = "padding:18px;margin:10px 0";
        const summary = document.createElement("summary");
        summary.style.cursor = "pointer";
        summary.textContent = (market.title || market.ticker) + " — YES ask " +
          quote(market.yes_ask_dollars) + " / NO ask " + quote(market.no_ask_dollars);
        const info = document.createElement("p");
        info.textContent = "Ticker: " + market.ticker + " · Closes: " + market.close_time +
          " · Volume (contracts): " + (market.volume_fp ?? "Unavailable");
        const rules = document.createElement("p");
        rules.textContent = [market.rules_primary, market.rules_secondary].filter(Boolean).join(" ") || "No resolution rules supplied.";
        const note = document.createElement("p");
        note.className = "muted";
        note.textContent = "Source: Kalshi public API. Platform affiliation and evidence review pending; trading disabled for imported markets.";
        row.append(summary, info, rules, note);
        board.append(row);
      }
    } catch (error) {
      status.textContent = "Data unavailable: " + error.message + " No sample prices substituted.";
    } finally {
      refresh.disabled = false;
    }
  }
  refresh.addEventListener("click", load);
  load();
})();

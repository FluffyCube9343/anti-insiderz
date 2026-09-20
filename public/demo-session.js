/* Local prototype convenience only; this is not server authentication. */
(function () {
  "use strict";
  const KEY = "nai.demo-session.v1";
  const TKEY = "nai.trader-session.v1";
  // ANS key logins persist here too, so a remembered trader skips re-upload.
  // NOTE: this stores the private key in localStorage - demo keys only.
  function rememberTrader(agentId, keyPem) {
    try { if (typeof agentId !== "string" || typeof keyPem !== "string" || !agentId || !keyPem) return false; localStorage.setItem(TKEY, JSON.stringify({ version: 1, agentId, keyPem })); return true; } catch { return false; }
  }
  function readTrader() {
    try { const t = JSON.parse(localStorage.getItem(TKEY)); return t?.version === 1 && typeof t.agentId === "string" && typeof t.keyPem === "string" ? { agentId: t.agentId, keyPem: t.keyPem } : null; } catch { return null; }
  }
  function currentTrader() {
    try { const t = JSON.parse(sessionStorage.getItem("traderSession")); return t && typeof t.agentId === "string" ? t : null; } catch { return null; }
  }
  function profile(raw) {
    if (!raw || typeof raw !== "object") return null;
    const result = {};
    for (const field of ["name", "email", "birthday", "role"]) {
      if (typeof raw[field] !== "string" || !raw[field].trim() || raw[field].length > 320) return null;
      result[field] = raw[field];
    }
    return result;
  }
  function read() {
    try { const value = JSON.parse(localStorage.getItem(KEY)); return value?.version === 1 && value.verified === true ? profile(value.user) : null; } catch { return null; }
  }
  function remember() {
    try {
      const user = profile(JSON.parse(sessionStorage.getItem("user")));
      if (!user || sessionStorage.getItem("verified") !== "yes") return false;
      localStorage.setItem(KEY, JSON.stringify({ version: 1, user, verified: true }));
      return true;
    } catch { return false; }
  }
  function current() {
    try { return sessionStorage.getItem("verified") === "yes" ? profile(JSON.parse(sessionStorage.getItem("user"))) : null; } catch { return null; }
  }
  function clear() {
    try { localStorage.removeItem(KEY); } catch {}
    try { localStorage.removeItem(TKEY); } catch {}
    try { for (const key of ["user", "verified", "mayaVerified", "pendingTrade", "mayaLastDecision", "traderSession"]) sessionStorage.removeItem(key); } catch {}
  }
  const storedTrader = readTrader();
  if (storedTrader && !sessionStorage.getItem("traderSession")) {
    try { sessionStorage.setItem("traderSession", JSON.stringify(storedTrader)); } catch {}
  }
  const stored = read();
  if (stored) {
    try { sessionStorage.setItem("user", JSON.stringify(stored)); sessionStorage.setItem("verified", "yes"); } catch {}
  } else if (current()) remember(); // Migrate an already verified demo session.
  window.DemoSession = { remember, current, currentTrader, clear, rememberTrader };
  const isLogin = /\/login.html$/.test(location.pathname);
  // Both session kinds count as signed in - mock demo or ANS trader key.
  if (isLogin && (current() || currentTrader())) location.replace("markets.html");
  document.addEventListener("DOMContentLoaded", () => {
    if (!current() && !currentTrader()) return;
    for (const link of document.querySelectorAll('a[href="login.html"]')) {
      link.href = "markets.html";
      link.textContent = link.classList.contains("button") ? "Continue to markets →" : "Markets";
    }
    const nav = document.querySelector(".nav") || document.querySelector(".top");
    if (nav) {
      const logout = document.createElement("button"); logout.type = "button"; logout.className = "theme";
      logout.textContent = "Sign out"; logout.addEventListener("click", () => { clear(); location.assign("login.html"); }); nav.append(logout);
    }
  });
  window.addEventListener("storage", event => {
    if ((event.key === KEY && event.newValue === null) || event.key === null) { clear(); location.replace("login.html"); }
  });
})();

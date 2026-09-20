(function () {
  function apply(value) {
    const theme = value === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    const button = document.querySelector("button.theme");
    if (button) { button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode"); button.setAttribute("aria-pressed", String(theme === "dark")); }
  }
  let saved = "light";
  try { saved = localStorage.getItem("theme") || "light"; } catch {}
  apply(saved);
  window.toggleTheme = function () {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem("theme", next); } catch {}
  };
  document.addEventListener("DOMContentLoaded", () => apply(document.documentElement.dataset.theme));
  window.addEventListener("storage", event => { if (event.key === "theme" || event.key === null) apply(event.newValue); });
})();

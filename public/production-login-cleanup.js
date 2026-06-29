(function () {
  const STYLE_ID = "production-login-cleanup-style";
  const NOTE_ID = "production-login-note";
  const ERROR_ID = "production-login-error";
  const FACTORIES_KEY = "garmentworks_factories";
  const DB_PREFIXES = ["garmentworks_db_staff", "garmentworks_db_workers"];
  const SESSION_KEYS = [
    "garmentworks_admin_session",
    "garmentworks_staff_session",
    "garmentworks_worker_session",
  ];
  const DEMO_EMAILS = new Set(["admin@factory.in", "manager@factory.in", "entry@factory.in"]);
  const DEMO_VALUES = new Set([
    "demo",
    "admin@factory.in",
    "admin123",
    "manager@factory.in",
    "manager123",
    "entry@factory.in",
    "entry123",
    "9810001122",
    "9810001133",
    "9810001144",
    "gw-1001",
    "gw-1002",
    "gw-1003",
    "9876543101",
    "9876543102",
    "9876543103",
  ]);
  const DEMO_TEXT = [
    /Demo Factory Code/i,
    /Demo Admin/i,
    /Demo Factory/i,
    /admin@factory\.in/i,
    /admin123/i,
    /manager@factory\.in/i,
    /manager123/i,
    /entry@factory\.in/i,
    /entry123/i,
  ];
  let cleanupTimer = 0;

  function routeType() {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/staff")) return "staff";
    if (path.startsWith("/worker")) return "worker";
    return "";
  }

  function isLoginScreen() {
    return !!routeType() && !document.querySelector(".portal-shell") && !!document.querySelector(".login-card");
  }

  function loginCard() {
    if (!isLoginScreen()) return null;
    return document.querySelector(".login-card");
  }

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
    return true;
  }

  function isDemoFactory(row) {
    if (!row || typeof row !== "object") return false;
    const id = String(row.id || row.factoryId || "").trim().toLowerCase();
    const code = String(row.code || row.factoryCode || "").trim().toLowerCase();
    const name = String(row.name || row.factoryName || "").trim().toLowerCase();
    return id === "demo" || code === "demo" || name === "demo factory";
  }

  function isDemoMember(row) {
    if (!row || typeof row !== "object") return false;
    const email = String(row.email || "").trim().toLowerCase();
    const password = String(row.password || "").trim().toLowerCase();
    const factoryId = String(row.factoryId || row.factory || row.factoryCode || "").trim().toLowerCase();
    return DEMO_EMAILS.has(email) || DEMO_VALUES.has(password) || factoryId === "demo";
  }

  function scrubArrayKey(key, predicate) {
    const rows = readJson(key, null);
    if (!Array.isArray(rows)) return;
    const filtered = rows.filter((row) => !predicate(row));
    if (filtered.length !== rows.length) writeJson(key, filtered);
  }

  function scrubObjectSession(key) {
    const session = readJson(key, null);
    if (!session || typeof session !== "object") return;
    const email = String(session.email || "").trim().toLowerCase();
    const factoryId = String(session.factoryId || session.factory || session.factoryCode || "").trim().toLowerCase();
    if (DEMO_EMAILS.has(email) || factoryId === "demo") {
      window.localStorage.removeItem(key);
    }
  }

  function scrubDemoStorage() {
    scrubArrayKey(FACTORIES_KEY, isDemoFactory);
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      if (DB_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}_`))) {
        scrubArrayKey(key, isDemoMember);
      }
    }
    SESSION_KEYS.forEach(scrubObjectSession);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .production-login-note {
        margin: 0 0 14px;
        padding: 12px 13px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .12), rgba(255, 255, 255, .96));
        color: var(--primary, #0f766e);
        font-size: 13px;
        font-weight: 850;
        line-height: 1.45;
      }

      .production-login-error {
        margin: 10px 0 0;
        padding: 11px 12px;
        border-radius: 8px;
        background: var(--red-soft, #fee2e2);
        color: var(--red, #dc2626);
        font-size: 13px;
        font-weight: 900;
        line-height: 1.35;
      }

      .login-card [data-production-hidden="true"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  function isDemoValue(value) {
    return DEMO_VALUES.has(String(value || "").trim().toLowerCase());
  }

  function setNativeInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function cleanInputs(card) {
    card.querySelectorAll("input").forEach((input) => {
      if (isDemoValue(input.value) || isDemoValue(input.defaultValue)) {
        setNativeInputValue(input, "");
        input.defaultValue = "";
        input.removeAttribute("value");
      }
      const label = `${input.name || ""} ${input.placeholder || ""}`.toLowerCase();
      if (label.includes("factory")) input.placeholder = "Factory code";
      if (label.includes("email")) input.placeholder = "registered email";
      if (label.includes("password")) input.placeholder = "Password";
    });
  }

  function looksLikeDemoText(text) {
    return DEMO_TEXT.some((pattern) => pattern.test(text));
  }

  function hideDemoHelpers(card) {
    card.querySelectorAll(".login-help, .demo-box, .demo-login, .login-demo").forEach((element) => {
      element.dataset.productionHidden = "true";
    });
    card.querySelectorAll("p, span, div, small, strong").forEach((element) => {
      if (element.id === NOTE_ID || element.id === ERROR_ID) return;
      const text = String(element.innerText || element.textContent || "").trim();
      if (!text || text.length > 260 || !looksLikeDemoText(text)) return;
      const candidate = element.closest(".login-help, .demo-box, .demo-login, .login-demo") || element;
      if (candidate !== card) candidate.dataset.productionHidden = "true";
    });
  }

  function noteText() {
    const type = routeType();
    if (type === "staff") {
      return "Production mode: staff apna assigned factory code, email/mobile aur password use karein. Demo access disabled hai.";
    }
    if (type === "worker") {
      return "Production mode: worker apna assigned factory code, worker ID/mobile aur password use karein. Demo access disabled hai.";
    }
    return "Production mode: registered factory code, admin email aur password use karein. Demo access disabled hai.";
  }

  function ensureNotice(card) {
    if (card.querySelector(`#${NOTE_ID}`)) return;
    const note = document.createElement("div");
    note.id = NOTE_ID;
    note.className = "production-login-note";
    note.textContent = noteText();
    const form = card.querySelector("form");
    if (form) form.insertAdjacentElement("beforebegin", note);
    else card.insertAdjacentElement("afterbegin", note);
  }

  function showError(card) {
    let error = card.querySelector(`#${ERROR_ID}`);
    if (!error) {
      error = document.createElement("div");
      error.id = ERROR_ID;
      error.className = "production-login-error";
      const form = card.querySelector("form");
      if (form) form.insertAdjacentElement("afterend", error);
      else card.appendChild(error);
    }
    error.textContent = "Demo login public use ke liye disabled hai. Registered factory account ya assigned credentials use karein.";
  }

  function cardHasDemoValue(card) {
    return Array.from(card.querySelectorAll("input")).some((input) => isDemoValue(input.value));
  }

  function blockDemoSubmit(event) {
    const card = loginCard();
    if (!card || !card.contains(event.target)) return;
    if (event.type === "click") {
      const clicked = event.target.closest("button, a, input[type='submit']");
      if (!clicked) return;
      const text = String(clicked.innerText || clicked.value || "").toLowerCase();
      if (!text.includes("login")) return;
    }
    if (!cardHasDemoValue(card)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showError(card);
    cleanInputs(card);
  }

  function render() {
    scrubDemoStorage();
    const card = loginCard();
    if (!card) return;
    ensureStyle();
    cleanInputs(card);
    hideDemoHelpers(card);
    ensureNotice(card);
  }

  function scheduleRender() {
    clearTimeout(cleanupTimer);
    cleanupTimer = setTimeout(render, 80);
  }

  document.addEventListener("submit", blockDemoSubmit, true);
  document.addEventListener("click", blockDemoSubmit, true);
  document.addEventListener("input", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(render, 1000);
  render();
})();

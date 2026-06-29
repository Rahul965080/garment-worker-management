(function () {
  const STYLE_ID = "factory-code-recovery-style";
  const BUTTON_ID = "factory-code-recovery-button";
  const MODAL_ID = "factory-code-recovery-modal";
  const FACTORIES_KEY = "garmentworks_factories";
  const DEFAULT_FACTORY = { id: "factory", code: "FACTORY", name: "Registered Factory" };
  const DB_KEYS = {
    staff: "garmentworks_db_staff",
    workers: "garmentworks_db_workers",
  };

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function routeType() {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith("/admin")) return "admin";
    if (path.startsWith("/staff")) return "staff";
    if (path.startsWith("/worker")) return "worker";
    return "";
  }

  function normalizeFactory(row) {
    if (!row || typeof row !== "object") return null;
    const id = String(row.id || row.factoryId || row.code || row.factoryCode || "").trim();
    const code = String(row.code || row.factoryCode || row.shortCode || row.id || "").trim();
    const name = String(row.name || row.factoryName || row.companyName || row.title || "").trim();
    if (!id && !code) return null;
    return {
      id: id || code,
      code: code || id,
      name: name || code || id,
      owner: String(row.owner || row.ownerName || row.adminName || "").trim(),
      email: String(row.email || row.ownerEmail || row.adminEmail || "").trim(),
      mobile: String(row.mobile || row.ownerMobile || row.adminMobile || "").trim(),
    };
  }

  function scopedKey(baseKey, factoryId) {
    const id = String(factoryId || DEFAULT_FACTORY.id).trim() || DEFAULT_FACTORY.id;
    return id === DEFAULT_FACTORY.id ? baseKey : `${baseKey}_${id}`;
  }

  function factoryIdFromDbKey(key, baseKey) {
    if (key === baseKey) return DEFAULT_FACTORY.id;
    if (key.startsWith(`${baseKey}_`)) return key.slice(baseKey.length + 1);
    return "";
  }

  function allFactories() {
    const byId = new Map();

    const stored = readJson(FACTORIES_KEY, []);
    if (Array.isArray(stored)) {
      stored.map(normalizeFactory).filter(Boolean).forEach((factory) => byId.set(factory.id, factory));
    }

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      Object.values(DB_KEYS).forEach((baseKey) => {
        const factoryId = factoryIdFromDbKey(key, baseKey);
        if (factoryId && !byId.has(factoryId)) {
          byId.set(factoryId, { id: factoryId, code: factoryId.toUpperCase(), name: factoryId });
        }
      });
    }

    return Array.from(byId.values());
  }

  function memberMatches(member, query, type) {
    const role = String(member?.role || "").trim().toLowerCase();
    const portal = String(member?.portal || "").trim().toLowerCase();
    if (type === "admin" && role !== "admin" && portal !== "admin") return false;
    if (type === "staff" && (role === "admin" || portal === "admin")) return false;

    const email = String(member?.email || "").trim().toLowerCase();
    const mobile = String(member?.mobile || member?.phone || "").replace(/\D/g, "");
    const workerId = String(member?.workerId || "").trim().toLowerCase();
    const cleanQuery = query.trim().toLowerCase();
    const cleanMobileQuery = query.replace(/\D/g, "");

    return (
      (!!email && email === cleanQuery) ||
      (!!mobile && !!cleanMobileQuery && mobile === cleanMobileQuery) ||
      (type === "worker" && !!workerId && workerId === cleanQuery)
    );
  }

  function factoryMatches(factory, query, type) {
    if (type !== "admin") return false;
    const cleanQuery = query.trim().toLowerCase();
    const cleanMobileQuery = query.replace(/\D/g, "");
    const email = String(factory.email || "").trim().toLowerCase();
    const mobile = String(factory.mobile || "").replace(/\D/g, "");
    return (!!email && email === cleanQuery) || (!!mobile && !!cleanMobileQuery && mobile === cleanMobileQuery);
  }

  function findFactories(query, type) {
    const matches = [];
    allFactories().forEach((factory) => {
      const staffRows = readJson(scopedKey(DB_KEYS.staff, factory.id), []);
      const workerRows = readJson(scopedKey(DB_KEYS.workers, factory.id), []);
      const staff = Array.isArray(staffRows) ? staffRows : [];
      const workers = Array.isArray(workerRows) ? workerRows : [];

      const found =
        factoryMatches(factory, query, type) ||
        (type !== "worker" && staff.some((member) => memberMatches(member, query, type))) ||
        (type === "worker" && workers.some((member) => memberMatches(member, query, type)));

      if (found) {
        matches.push({
          id: factory.id,
          code: factory.code || factory.id,
          name: factory.name || factory.code || factory.id,
        });
      }
    });
    return matches;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .factory-code-link {
        justify-self: center;
        border: 0;
        background: transparent;
        color: var(--primary, #0f766e);
        font-size: 13px;
        font-weight: 900;
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      .factory-recovery-modal {
        width: min(520px, 100%);
      }

      .factory-recovery-form {
        display: grid;
        gap: 12px;
      }

      .factory-recovery-note {
        padding: 11px 12px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: var(--primary-soft, #e4f7f5);
        color: var(--primary, #0f766e);
        font-size: 12px;
        font-weight: 800;
        line-height: 1.45;
      }

      .factory-recovery-result {
        display: grid;
        gap: 8px;
      }

      .factory-recovery-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        padding: 12px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #fff;
      }

      .factory-recovery-card span {
        color: var(--muted, #687683);
        font-size: 12px;
      }

      .factory-recovery-code {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 11px;
        border-radius: 8px;
        background: #0e1b22;
        color: #fff;
        font-size: 13px;
        font-weight: 900;
        letter-spacing: .06em;
      }

      .factory-recovery-error {
        padding: 11px 12px;
        border-radius: 8px;
        background: var(--red-soft, #fee2e2);
        color: var(--red, #dc2626);
        font-size: 13px;
        font-weight: 900;
      }
    `;
    document.head.appendChild(style);
  }

  function loginCard() {
    if (!routeType()) return null;
    if (document.querySelector(".portal-shell")) return null;
    return document.querySelector(".login-card");
  }

  function addRecoveryButton() {
    const card = loginCard();
    if (!card || document.getElementById(BUTTON_ID)) return;
    ensureStyle();
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "factory-code-link";
    button.textContent = "Forgot Factory Code?";
    const help = card.querySelector(".login-help");
    if (help) help.insertAdjacentElement("beforebegin", button);
    else card.appendChild(button);
    button.addEventListener("click", openModal);
  }

  function portalLabel(type) {
    if (type === "worker") return "worker mobile ya worker ID";
    if (type === "staff") return "staff email ya mobile";
    return "admin email ya mobile";
  }

  function openModal() {
    const type = routeType() || "admin";
    closeModal();
    ensureStyle();
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-backdrop";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <section class="profile-modal factory-recovery-modal">
        <div class="panel-header">
          <div>
            <h2>Recover Factory Code</h2>
            <p>Apna registered ${escapeHtml(portalLabel(type))} daalo. Match hone par factory code yahin show hoga.</p>
          </div>
          <button type="button" data-factory-recovery-close>Close</button>
        </div>
        <form class="factory-recovery-form">
          <label class="field">
            <span>${escapeHtml(portalLabel(type))}</span>
            <input type="text" name="query" placeholder="Example: owner@yourfactory.com ya registered mobile" autocomplete="username" required>
          </label>
          <div class="factory-recovery-note">Security ke liye exact email/mobile match par hi code dikhaya jayega. Galat detail par factory list show nahi hogi.</div>
          <button class="primary-button" type="submit">Find Factory Code</button>
          <div class="factory-recovery-result" aria-live="polite"></div>
        </form>
      </section>
    `;
    document.body.appendChild(modal);
    modal.querySelector("[data-factory-recovery-close]").addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    modal.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const query = new FormData(event.currentTarget).get("query") || "";
      renderResults(modal, String(query), type);
    });
    modal.querySelector("input")?.focus();
  }

  function renderResults(modal, query, type) {
    const box = modal.querySelector(".factory-recovery-result");
    const matches = query.trim().length >= 3 ? findFactories(query, type) : [];
    if (!matches.length) {
      box.innerHTML = `<div class="factory-recovery-error">Is detail se factory code nahi mila. Registered ${escapeHtml(portalLabel(type))} check karo ya admin se contact karo.</div>`;
      return;
    }
    box.innerHTML = matches
      .map(
        (factory) => `
          <div class="factory-recovery-card">
            <div>
              <strong>${escapeHtml(factory.name)}</strong>
              <span>Factory Code</span>
            </div>
            <div class="factory-recovery-code">${escapeHtml(factory.code)}</div>
          </div>
        `
      )
      .join("");
  }

  function closeModal() {
    document.getElementById(MODAL_ID)?.remove();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const observer = new MutationObserver(addRecoveryButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(addRecoveryButton, 1200);
  addRecoveryButton();
})();

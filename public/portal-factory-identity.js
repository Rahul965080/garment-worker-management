(function () {
  const STYLE_ID = "portal-factory-identity-style";
  const LOGIN_BOX_ID = "portal-factory-login-identity";
  const PORTAL_BOX_ID = "portal-factory-dashboard-identity";
  const FACTORIES_KEY = "garmentworks_factories";
  const STAFF_SESSION_KEY = "garmentworks_staff_session";
  const WORKER_SESSION_KEY = "garmentworks_worker_session";
  const DEFAULT_FACTORY = {
    id: "demo",
    code: "DEMO",
    name: "Demo Factory",
  };

  let renderTimer = 0;

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function portalType() {
    const path = window.location.pathname.toLowerCase();
    if (path.startsWith("/staff")) return "staff";
    if (path.startsWith("/worker")) return "worker";
    return "";
  }

  function normalizeFactory(row) {
    if (!row || typeof row !== "object") return null;
    return {
      id: String(row.id || row.factoryId || row.code || row.factoryCode || "").trim(),
      code: String(row.code || row.factoryCode || row.shortCode || row.id || "").trim(),
      name: String(row.name || row.factoryName || row.companyName || row.title || "").trim(),
      owner: String(row.owner || row.ownerName || row.adminName || "").trim(),
      address: String(row.address || row.location || row.city || "").trim(),
    };
  }

  function factories() {
    const stored = readJson(FACTORIES_KEY, []);
    const rows = Array.isArray(stored) ? stored : [];
    return rows.map(normalizeFactory).filter(Boolean);
  }

  function sessionForType(type) {
    const key = type === "worker" ? WORKER_SESSION_KEY : STAFF_SESSION_KEY;
    return readJson(key, null);
  }

  function sessionFactoryId(type) {
    const session = sessionForType(type);
    return String(session?.factoryId || session?.factory || session?.factoryCode || "").trim();
  }

  function activeFactory() {
    const type = portalType();
    const id = sessionFactoryId(type);
    if (!id) return null;
    const allFactories = factories();
    const found =
      allFactories.find((factory) => factory.id === id) ||
      allFactories.find((factory) => factory.code.toLowerCase() === String(id).toLowerCase()) ||
      null;
    if (found) {
      return {
        ...DEFAULT_FACTORY,
        ...found,
        id: found.id || id || DEFAULT_FACTORY.id,
        code: found.code || String(id || DEFAULT_FACTORY.code).toUpperCase(),
        name: found.name || DEFAULT_FACTORY.name,
      };
    }
    return {
      ...DEFAULT_FACTORY,
      id,
      code: String(id || DEFAULT_FACTORY.code).toUpperCase(),
      name: id === "demo" || !id ? DEFAULT_FACTORY.name : String(id),
    };
  }

  function isPortalScreen() {
    return !!document.querySelector(".portal-shell");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .portal-factory-identity {
        display: grid;
        gap: 8px;
        width: 100%;
        padding: 13px 14px;
        border: 1px solid rgba(15, 118, 110, .18);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .12), rgba(255, 255, 255, .94)), #fff;
        color: var(--ink, #17212b);
        box-shadow: 0 12px 28px rgba(14, 27, 34, .08);
      }

      .portal-factory-identity.compact {
        margin: 0 0 14px;
      }

      .portal-factory-line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      .portal-factory-kicker {
        color: var(--primary, #0f766e);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .portal-factory-name {
        margin-top: 3px;
        color: var(--ink, #17212b);
        font-size: 18px;
        font-weight: 900;
        line-height: 1.2;
      }

      .portal-factory-code {
        display: inline-flex;
        align-items: center;
        min-height: 34px;
        padding: 0 11px;
        border-radius: 8px;
        background: #0e1b22;
        color: #fff;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .portal-factory-meta {
        color: var(--muted, #687683);
        font-size: 12px;
        line-height: 1.4;
      }

      .portal-factory-warning {
        padding-top: 8px;
        border-top: 1px solid rgba(15, 118, 110, .14);
        color: #52616d;
        font-size: 12px;
        font-weight: 800;
      }

      .portal-shell > .portal-factory-identity {
        margin-bottom: 16px;
      }

      @media (max-width: 640px) {
        .portal-factory-line {
          display: grid;
        }

        .portal-factory-code {
          justify-self: start;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function identityHtml(factory, type) {
    const portalLabel = type === "worker" ? "Worker Portal" : "Staff Portal";
    const meta = [factory.owner ? `Owner: ${factory.owner}` : "", factory.address].filter(Boolean).join(" / ");
    return `
      <div class="portal-factory-line">
        <div>
          <div class="portal-factory-kicker">${escapeHtml(portalLabel)} Company</div>
          <div class="portal-factory-name">${escapeHtml(factory.name)}</div>
        </div>
        <div class="portal-factory-code">${escapeHtml(factory.code || factory.id || "FACTORY")}</div>
      </div>
      ${meta ? `<div class="portal-factory-meta">${escapeHtml(meta)}</div>` : ""}
      <div class="portal-factory-warning">Aap login ke baad isi company/factory ka data dekh rahe ho. Galat company lage to logout karke sahi factory code se login karo.</div>
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function removeIfWrongPage() {
    if (portalType()) return;
    document.getElementById(LOGIN_BOX_ID)?.remove();
    document.getElementById(PORTAL_BOX_ID)?.remove();
  }

  function renderPortal(factory, type) {
    const shell = document.querySelector(".portal-shell");
    if (!shell) {
      document.getElementById(PORTAL_BOX_ID)?.remove();
      return;
    }
    let box = document.getElementById(PORTAL_BOX_ID);
    if (!box) {
      box = document.createElement("section");
      box.id = PORTAL_BOX_ID;
      box.className = "portal-factory-identity compact";
      const topbar = shell.querySelector(".portal-topbar");
      if (topbar) topbar.insertAdjacentElement("afterend", box);
      else shell.insertAdjacentElement("afterbegin", box);
    }
    const signature = JSON.stringify({ factory, type });
    if (box.dataset.signature === signature) return;
    box.dataset.signature = signature;
    box.innerHTML = identityHtml(factory, type);
  }

  function render() {
    const type = portalType();
    removeIfWrongPage();
    if (!type) return;
    document.getElementById(LOGIN_BOX_ID)?.remove();
    ensureStyle();
    const factory = activeFactory();
    if (factory && isPortalScreen()) renderPortal(factory, type);
    else document.getElementById(PORTAL_BOX_ID)?.remove();
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 100);
  }

  document.addEventListener("click", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(scheduleRender, 1600);
  scheduleRender();
})();

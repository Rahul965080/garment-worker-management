(function () {
  const STYLE_ID = "factory-name-edit-style";
  const BUTTON_ID = "factory-name-edit-button";
  const MODAL_ID = "factory-name-edit-modal";
  const FACTORIES_KEY = "garmentworks_factories";
  const ADMIN_SESSION_KEY = "garmentworks_admin_session";

  let renderTimer = 0;

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
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalize(value) {
    return String(value || "").trim();
  }

  function cleanCode(value) {
    return normalize(value).toLowerCase();
  }

  function isAdminPortal() {
    return window.location.pathname.toLowerCase().startsWith("/admin") && !!document.querySelector(".app-shell");
  }

  function adminSession() {
    const session = readJson(ADMIN_SESSION_KEY, null);
    return session && typeof session === "object" ? session : null;
  }

  function allFactories() {
    const rows = readJson(FACTORIES_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function sessionFactoryId() {
    const session = adminSession();
    return normalize(session?.factoryId || session?.factory || session?.factoryCode || "");
  }

  function findActiveFactory() {
    const id = sessionFactoryId();
    const factories = allFactories();
    if (!id) return { factory: null, factories, index: -1 };
    const needle = cleanCode(id);
    const index = factories.findIndex((factory) => {
      const factoryId = cleanCode(factory?.id || factory?.factoryId || "");
      const code = cleanCode(factory?.code || factory?.factoryCode || "");
      return factoryId === needle || code === needle;
    });
    return { factory: index >= 0 ? factories[index] : null, factories, index };
  }

  function currentFactoryName() {
    const { factory } = findActiveFactory();
    return normalize(factory?.name || factory?.factoryName || factory?.companyName || "");
  }

  function currentFactoryCode() {
    const { factory } = findActiveFactory();
    return normalize(factory?.code || factory?.factoryCode || factory?.id || sessionFactoryId() || "FACTORY");
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .factory-name-button {
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #fff;
        color: var(--ink, #17212b);
        min-height: 46px;
        padding: 0 18px;
        font-size: 14px;
        font-weight: 900;
        box-shadow: 0 10px 24px rgba(14, 27, 34, .06);
      }

      .factory-name-modal {
        width: min(520px, calc(100vw - 24px));
      }

      .factory-name-form {
        display: grid;
        gap: 14px;
      }

      .factory-name-note {
        padding: 12px 13px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: var(--primary-soft, #e4f7f5);
        color: var(--primary, #0f766e);
        font-size: 12px;
        font-weight: 850;
        line-height: 1.45;
      }

      .factory-name-actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        flex-wrap: wrap;
      }

      .factory-name-error {
        padding: 11px 12px;
        border-radius: 8px;
        background: var(--red-soft, #fee2e2);
        color: var(--red, #dc2626);
        font-size: 13px;
        font-weight: 900;
      }

      .factory-name-success {
        padding: 11px 12px;
        border-radius: 8px;
        background: var(--green-soft, #dcfce7);
        color: var(--green, #059669);
        font-size: 13px;
        font-weight: 900;
      }
    `;
    document.head.appendChild(style);
  }

  function findAnchorButton() {
    return Array.from(document.querySelectorAll("button")).find((button) => {
      return normalize(button.textContent).toLowerCase() === "edit profile";
    });
  }

  function addButton() {
    if (!isAdminPortal()) {
      document.getElementById(BUTTON_ID)?.remove();
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;
    const anchor = findAnchorButton();
    if (!anchor) return;
    ensureStyle();
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "factory-name-button";
    button.textContent = "Edit Factory Name";
    button.addEventListener("click", openModal);
    anchor.insertAdjacentElement("afterend", button);
  }

  function openModal() {
    closeModal();
    ensureStyle();
    const name = currentFactoryName();
    const code = currentFactoryCode();
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "modal-backdrop";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <section class="profile-modal factory-name-modal">
        <div class="panel-header">
          <div>
            <h2>Edit Factory Name</h2>
            <p>Factory code same rahega. Sirf display name update hoga.</p>
          </div>
          <button type="button" data-factory-name-close>Close</button>
        </div>
        <form class="factory-name-form">
          <label class="field">
            <span>Factory Code</span>
            <input type="text" value="${escapeHtml(code)}" readonly>
          </label>
          <label class="field">
            <span>Factory Name</span>
            <input type="text" name="factoryName" value="${escapeHtml(name)}" placeholder="Example: Malik Garments" required>
          </label>
          <div class="factory-name-note">Save ke baad dashboard reload hoga, taaki admin, staff aur worker portal me same updated factory name dikhe.</div>
          <div class="factory-name-message" aria-live="polite"></div>
          <div class="factory-name-actions">
            <button type="button" data-factory-name-close>Cancel</button>
            <button class="primary-button" type="submit">Save Factory Name</button>
          </div>
        </form>
      </section>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-factory-name-close]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    modal.querySelector("form").addEventListener("submit", saveFactoryName);
    modal.querySelector('[name="factoryName"]')?.focus();
  }

  function saveFactoryName(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector(".factory-name-message");
    const newName = normalize(new FormData(form).get("factoryName"));
    if (newName.length < 2) {
      message.innerHTML = `<div class="factory-name-error">Factory name kam se kam 2 character ka hona chahiye.</div>`;
      return;
    }

    const active = findActiveFactory();
    if (active.index < 0) {
      message.innerHTML = `<div class="factory-name-error">Active factory record nahi mila. Logout karke dobara login karo.</div>`;
      return;
    }

    const updatedFactories = active.factories.map((factory, index) => {
      if (index !== active.index) return factory;
      return {
        ...factory,
        name: newName,
        factoryName: newName,
        companyName: newName,
        updatedAt: new Date().toISOString(),
      };
    });
    const session = adminSession();
    if (!writeJson(FACTORIES_KEY, updatedFactories)) {
      message.innerHTML = `<div class="factory-name-error">Factory name save nahi ho paya. Browser storage check karo.</div>`;
      return;
    }
    if (session) {
      writeJson(ADMIN_SESSION_KEY, {
        ...session,
        factoryName: newName,
        companyName: newName,
      });
    }
    message.innerHTML = `<div class="factory-name-success">Factory name update ho gaya. Page refresh ho raha hai...</div>`;
    setTimeout(() => window.location.reload(), 700);
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

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(addButton, 100);
  }

  document.addEventListener("click", (event) => {
    if (event.target?.closest?.(`#${BUTTON_ID}`)) {
      event.preventDefault();
      openModal();
      return;
    }
    scheduleRender();
  }, true);
  window.addEventListener("storage", scheduleRender);
  new MutationObserver(scheduleRender).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scheduleRender, 1400);
  scheduleRender();
})();

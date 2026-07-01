(function () {
  const STYLE_ID = "login-security-guard-style";
  const FACTORIES_KEY = "garmentworks_factories";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const SESSION_KEYS = {
    admin: "garmentworks_admin_session",
    staff: "garmentworks_staff_session",
    worker: "garmentworks_worker_session",
  };
  const DB_KEYS = {
    staff: "garmentworks_db_staff",
    workers: "garmentworks_db_workers",
  };

  function routeType() {
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === "/admin") return "admin";
    if (path === "/staff") return "staff";
    if (path === "/worker") return "worker";
    return "";
  }

  function readJson(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function cleanCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
  }

  function lower(value) {
    return String(value || "").trim().toLowerCase();
  }

  function cleanMobile(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function scopedKey(baseKey, factoryId) {
    const id = String(factoryId || "").trim();
    return !id || id === "demo" ? baseKey : `${baseKey}_${id}`;
  }

  function factories() {
    const rows = readJson(FACTORIES_KEY, []);
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function normalizeFactory(row) {
    if (!row || typeof row !== "object") return null;
    const id = String(row.id || row.factoryId || row.code || row.factoryCode || "").trim();
    const code = String(row.code || row.factoryCode || row.id || "").trim();
    const name = String(row.name || row.factoryName || row.companyName || "").trim();
    if (!id && !code) return null;
    return { ...row, id: id || code, code: code || id, name };
  }

  function findFactory(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const code = cleanCode(raw);
    const text = lower(raw);
    return (
      factories()
        .map(normalizeFactory)
        .filter(Boolean)
        .find((factory) => {
          return (
            cleanCode(factory.code) === code ||
            cleanCode(factory.id) === code ||
            lower(factory.name) === text ||
            lower(factory.factoryName) === text ||
            lower(factory.companyName) === text
          );
        }) || null
    );
  }

  function staffRows(factoryId) {
    const rows = readJson(scopedKey(DB_KEYS.staff, factoryId), []);
    return Array.isArray(rows) ? rows : [];
  }

  function workerRows(factoryId) {
    const rows = readJson(scopedKey(DB_KEYS.workers, factoryId), []);
    return Array.isArray(rows) ? rows : [];
  }

  function isActive(row) {
    return String(row?.status || "Active").toLowerCase() === "active";
  }

  function field(form, name) {
    return String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
  }

  function setNativeInputValue(input, value) {
    if (!input) return;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .login-security-error {
        margin: 10px 0 0;
        padding: 11px 12px;
        border-radius: 8px;
        background: var(--red-soft, #fee2e2);
        color: var(--red, #dc2626);
        font-size: 13px;
        font-weight: 900;
        line-height: 1.35;
      }
    `;
    document.head.appendChild(style);
  }

  function showError(form, message) {
    ensureStyle();
    form.querySelectorAll(".login-security-error").forEach((node) => node.remove());
    const existing = form.querySelector(".login-error, .production-login-error");
    if (existing) {
      existing.textContent = message;
      return;
    }
    const box = document.createElement("div");
    box.className = "login-security-error";
    box.textContent = message;
    form.appendChild(box);
  }

  function clearError(form) {
    form.querySelectorAll(".login-security-error").forEach((node) => node.remove());
  }

  function formMode(form) {
    if (form.querySelector('[name="factoryName"]')) return "create";
    if (form.querySelector('[name="mobile"]')) return "forgot";
    return "login";
  }

  function hardenFactoryInput(form) {
    const input = form.querySelector('[name="factoryCode"]');
    const factory = findFactory(input?.value || "");
    if (factory?.code) setNativeInputValue(input, factory.code);
    return factory;
  }

  function validatePassword(password) {
    return String(password || "").trim().length >= 4;
  }

  function factoryDisplayCode(factory) {
    return String(factory?.code || factory?.factoryCode || factory?.id || factory?.factoryId || "").trim() || "UNKNOWN";
  }

  function ownerEmail(factory) {
    return lower(factory?.email || factory?.ownerEmail || factory?.adminEmail || "");
  }

  function ownerMobile(factory) {
    return cleanMobile(factory?.mobile || factory?.ownerMobile || factory?.adminMobile || "");
  }

  function adminMember(factory) {
    const factoryId = String(factory?.id || factory?.factoryId || factory?.code || factory?.factoryCode || "").trim();
    return (
      staffRows(factoryId).find((row) => {
        return String(row?.role || "").toLowerCase() === "admin";
      }) || null
    );
  }

  function formValues(form) {
    const data = new FormData(form);
    const values = {};
    data.forEach((value, key) => {
      values[key] = String(value || "").trim();
    });
    return values;
  }

  function createAccountIdentity(values) {
    const email = lower(values.email || values.adminEmail || values.ownerEmail || "");
    const mobile = cleanMobile(values.mobile || values.adminMobile || values.ownerMobile || "");
    return { email, mobile };
  }

  function duplicateFactoryByIdentity(identity) {
    if (!identity.email && !identity.mobile) return null;
    return factories()
      .map(normalizeFactory)
      .filter(Boolean)
      .find((factory) => {
        const admin = adminMember(factory);
        const emails = [ownerEmail(factory), lower(admin?.email || "")].filter(Boolean);
        const mobiles = [ownerMobile(factory), cleanMobile(admin?.mobile || "")].filter(Boolean);
        return (
          (!!identity.email && emails.includes(identity.email)) ||
          (!!identity.mobile && mobiles.includes(identity.mobile))
        );
      }) || null;
  }

  function validateCreateAccount(form) {
    const identity = createAccountIdentity(formValues(form));
    if (!identity.email && !identity.mobile) return "";
    const duplicate = duplicateFactoryByIdentity(identity);
    if (!duplicate) return "";
    const code = factoryDisplayCode(duplicate);
    return `Is email/mobile se account pehle se bana hua hai. Naya account create nahi hoga. Old Factory Code: ${code}`;
  }

  async function validateCreateAccountOnServer(form) {
    const values = formValues(form);
    const response = await fetch("/api/auth/check-create-account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(values),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "Duplicate account check failed" }));
    if (!response.ok || !result.ok) return result.error || "Is email/mobile se account pehle se bana hua hai.";
    return "";
  }

  function validateLogin(form, type, factory) {
    if (!factory) return "Factory code/name nahi mila. Sahi factory code ya exact factory name daalo.";
    const password = field(form, "password");
    if (!validatePassword(password)) return "Password kam se kam 4 character ka hona chahiye.";

    if (type === "admin") {
      const email = lower(field(form, "email"));
      const member = staffRows(factory.id).find((row) => lower(row.email) === email);
      if (!member || String(member.password || "") !== password) return "Factory, admin email ya password match nahi hua.";
      if (String(member.role || "").toLowerCase() !== "admin") return "Is account ko admin access allowed nahi hai.";
      if (!isActive(member)) return "Admin account suspended hai. Owner se contact karo.";
      return "";
    }

    if (type === "staff") {
      const email = lower(field(form, "email"));
      const member = staffRows(factory.id).find((row) => lower(row.email) === email);
      if (!member || String(member.password || "") !== password) return "Factory, staff email ya password match nahi hua.";
      if (String(member.role || "").toLowerCase() === "admin") return "Admin account staff portal par allowed nahi hai.";
      if (!isActive(member)) return "Staff account suspended hai.";
      return "";
    }

    if (type === "worker") {
      const workerId = lower(field(form, "workerId"));
      const worker = workerRows(factory.id).find((row) => lower(row.workerId) === workerId);
      if (!worker) return "Factory, worker ID ya password match nahi hua.";
      const savedPassword = String(worker.password || "").trim();
      if (!savedPassword) return "Worker password set nahi hai. Pehle Set / Forgot Password se password banao.";
      if (savedPassword !== password) return "Factory, worker ID ya password match nahi hua.";
      if (!isActive(worker)) return "Worker account inactive/suspended hai.";
      return "";
    }

    return "";
  }

  function validateForgot(form, type, factory) {
    if (!factory) return "Factory code/name nahi mila. Sahi factory code ya exact factory name daalo.";
    if (!validatePassword(field(form, "password"))) return "New password kam se kam 4 character ka hona chahiye.";

    if (type === "admin") {
      const email = lower(field(form, "email"));
      const mobile = field(form, "mobile").replace(/\D/g, "");
      const member = staffRows(factory.id).find((row) => {
        return lower(row.email) === email && String(row.mobile || "").replace(/\D/g, "") === mobile;
      });
      if (!member || String(member.role || "").toLowerCase() !== "admin") return "Admin email/mobile factory se match nahi hua.";
      if (!isActive(member)) return "Admin account suspended hai. Password reset allowed nahi hai.";
      return "";
    }

    if (type === "staff") {
      const email = lower(field(form, "email"));
      const mobile = field(form, "mobile").replace(/\D/g, "");
      const member = staffRows(factory.id).find((row) => {
        return lower(row.email) === email && String(row.mobile || "").replace(/\D/g, "") === mobile;
      });
      if (!member || String(member.role || "").toLowerCase() === "admin") return "Staff email/mobile factory se match nahi hua.";
      if (!isActive(member)) return "Suspended staff ka password reset allowed nahi hai.";
      return "";
    }

    if (type === "worker") {
      const workerId = lower(field(form, "workerId"));
      const mobile = field(form, "mobile").replace(/\D/g, "");
      const worker = workerRows(factory.id).find((row) => {
        return lower(row.workerId) === workerId && String(row.mobile || "").replace(/\D/g, "") === mobile;
      });
      if (!worker) return "Worker ID/mobile factory se match nahi hua.";
      if (!isActive(worker)) return "Inactive/suspended worker ka password reset allowed nahi hai.";
      return "";
    }

    return "";
  }

  function guardSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.closest(".login-card")) return;
    const type = routeType();
    if (!type) return;
    const mode = formMode(form);
    if (mode === "create") {
      const message = validateCreateAccount(form);
      if (message) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showError(form, message);
        return;
      }
      if (form.dataset.serverDuplicateChecked !== "true") {
        event.preventDefault();
        event.stopImmediatePropagation();
        validateCreateAccountOnServer(form)
          .then((serverMessage) => {
            if (serverMessage) {
              showError(form, serverMessage);
              return;
            }
            form.dataset.serverDuplicateChecked = "true";
            clearError(form);
            if (typeof form.requestSubmit === "function") form.requestSubmit();
            else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            window.setTimeout(() => {
              delete form.dataset.serverDuplicateChecked;
            }, 500);
          })
          .catch((error) => showError(form, error.message || "Duplicate account check failed. Dobara try karo."));
        return;
      }
      clearError(form);
      return;
    }

    const factory = hardenFactoryInput(form);
    const message = mode === "forgot" ? validateForgot(form, type, factory) : validateLogin(form, type, factory);
    if (message) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showError(form, message);
      return;
    }
    clearError(form);
  }

  function validateCurrentSession() {
    const type = routeType();
    if (!type) return;
    const sessionKey = SESSION_KEYS[type];
    const session = readJson(sessionKey, null);
    if (!session || typeof session !== "object") return;
    const factoryId = String(session.factoryId || session.factory || session.factoryCode || "").trim();
    if (!factoryId) {
      window.localStorage.removeItem(sessionKey);
      return;
    }
    const activeFactory = window.localStorage.getItem(ACTIVE_FACTORY_KEY);
    if (activeFactory && activeFactory !== factoryId) {
      window.localStorage.removeItem(sessionKey);
      return;
    }

    let valid = false;
    if (type === "admin") {
      valid = staffRows(factoryId).some((row) => {
        return row.id === session.id && lower(row.email) === lower(session.email) && String(row.role || "").toLowerCase() === "admin" && isActive(row);
      });
    } else if (type === "staff") {
      valid = staffRows(factoryId).some((row) => {
        return row.id === session.id && lower(row.email) === lower(session.email) && String(row.role || "").toLowerCase() !== "admin" && isActive(row);
      });
    } else if (type === "worker") {
      valid = workerRows(factoryId).some((row) => {
        return row.id === session.id && lower(row.workerId) === lower(session.workerId) && String(row.mobile || "") === String(session.mobile || "") && isActive(row);
      });
    }
    if (!valid) window.localStorage.removeItem(sessionKey);
  }

  document.addEventListener("submit", guardSubmit, true);
  window.addEventListener("storage", validateCurrentSession);
  setInterval(validateCurrentSession, 2500);
  validateCurrentSession();
})();

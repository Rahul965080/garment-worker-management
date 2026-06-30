(function () {
  const SESSION_KEYS = {
    admin: "garmentworks_admin_session",
    staff: "garmentworks_staff_session",
    worker: "garmentworks_worker_session",
  };
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const nativeSetItem = Storage.prototype.setItem;

  function routeRole() {
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === "/admin") return "admin";
    if (path === "/staff") return "staff";
    if (path === "/worker") return "worker";
    return "";
  }

  function formMode(form) {
    if (form.querySelector('[name="factoryName"]')) return "create";
    if (form.querySelector('[name="mobile"]') && form.querySelector('[name="password"]')) return "forgot";
    return "login";
  }

  function value(form, name) {
    return String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
  }

  function showError(form, message) {
    let box = form.querySelector(".server-auth-error, .login-error, .production-login-error");
    if (!box) {
      box = document.createElement("div");
      box.className = "server-auth-error login-security-error";
      form.appendChild(box);
    }
    box.textContent = message;
  }

  function writeSnapshot(data) {
    Object.entries(data || {}).forEach(([key, storedValue]) => {
      if (key.startsWith("garmentworks_")) nativeSetItem.call(window.localStorage, key, String(storedValue));
    });
  }

  function writeSession(role, session) {
    const sessionKey = SESSION_KEYS[role];
    if (!sessionKey) return;
    nativeSetItem.call(window.localStorage, sessionKey, JSON.stringify(session));
    nativeSetItem.call(window.localStorage, ACTIVE_FACTORY_KEY, session.factoryId || session.factoryCode || "");
  }

  async function serverLogin(form, role) {
    const payload = {
      role,
      factoryCode: value(form, "factoryCode"),
      email: value(form, "email"),
      workerId: value(form, "workerId"),
      mobile: value(form, "mobile"),
      password: value(form, "password"),
    };

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "Login failed" }));
    if (!response.ok || !result.ok) throw new Error(result.error || "Login failed");
    writeSnapshot(result.data);
    writeSession(role, result.session);
    if (window.__garmentworksDb?.flush) await window.__garmentworksDb.flush();
    window.location.reload();
  }

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.closest(".login-card")) return;
      const role = routeRole();
      if (!role || formMode(form) !== "login") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      serverLogin(form, role).catch((error) => showError(form, error.message || "Login failed"));
    },
    true,
  );
})();

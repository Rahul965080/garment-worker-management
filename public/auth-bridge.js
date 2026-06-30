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
    const text = String(form.textContent || "").toLowerCase();
    const hasPassword = !!form.querySelector('input[type="password"], [name="password"], [name="newPassword"], [name="confirmPassword"]');
    const hasMobile = !!form.querySelector('[name="mobile"], [name="phone"], [name="adminMobile"], [name="ownerMobile"]');
    const hasOtp = !!form.querySelector('[name="otp"]');
    if (hasOtp || (hasPassword && hasMobile)) return "forgot";
    if (!form.closest(".login-card") && hasPassword && /forgot|reset|new password|set password|password change/.test(text)) return "forgot";
    return "login";
  }

  function value(form, name) {
    return String(form.querySelector(`[name="${name}"]`)?.value || "").trim();
  }

  function passwordValue(form) {
    return String(
      form.querySelector('[name="password"]')?.value ||
        form.querySelector('[name="newPassword"]')?.value ||
        form.querySelector('[name="confirmPassword"]')?.value ||
        "",
    ).trim();
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

  function showSuccess(form, message) {
    let box = form.querySelector(".server-auth-success, .login-success");
    if (!box) {
      box = document.createElement("div");
      box.className = "server-auth-success login-success";
      form.appendChild(box);
    }
    box.textContent = message;
  }

  function passwordInputs(form) {
    return Array.from(form.querySelectorAll('input[type="password"], [name="password"], [name="newPassword"], [name="confirmPassword"]'));
  }

  function setPasswordInputsVisible(form, visible) {
    passwordInputs(form).forEach((input) => {
      const wrap = input.closest("label, .field, .form-field") || input;
      if (form.dataset.resetToken || visible) {
        input.disabled = false;
        input.required = true;
        wrap.style.display = "";
      } else {
        input.disabled = true;
        input.required = false;
        wrap.style.display = "none";
      }
    });
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

  function ensureOtpField(form) {
    let input = form.querySelector('[name="otp"]');
    if (input) return input;

    const wrap = document.createElement("label");
    wrap.className = "form-field otp-field";
    wrap.innerHTML = `<span>OTP Code</span><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6 digit OTP" required>`;
    const button = form.querySelector('button[type="submit"], button');
    form.insertBefore(wrap, button || null);
    return wrap.querySelector("input");
  }

  async function requestOtp(form, role) {
    setPasswordInputsVisible(form, false);
    const payload = {
      role,
      factoryCode: value(form, "factoryCode"),
      email: value(form, "email"),
      workerId: value(form, "workerId"),
      mobile: value(form, "mobile"),
    };
    const response = await fetch("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "OTP request failed" }));
    if (!response.ok || !result.ok) throw new Error(result.error || "OTP request failed");
    form.dataset.resetId = result.resetId;
    form.dataset.resetToken = "";
    ensureOtpField(form).focus();
    const button = form.querySelector('button[type="submit"], button');
    if (button) button.textContent = "Verify OTP";
    showSuccess(form, `${result.message || "OTP send ho gaya."} Contact: ${result.contact || "***"}`);
    if (result.debugOtp) showSuccess(form, `Testing OTP: ${result.debugOtp}`);
  }

  async function verifyOtpOnly(form) {
    const response = await fetch("/api/auth/password-reset/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        resetId: form.dataset.resetId,
        otp: value(form, "otp"),
      }),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "OTP verify failed" }));
    if (!response.ok || !result.ok) throw new Error(result.error || "OTP verify failed");
    form.dataset.resetToken = result.resetToken;
    setPasswordInputsVisible(form, true);
    const button = form.querySelector('button[type="submit"], button');
    if (button) button.textContent = "Change Password";
    showSuccess(form, result.message || "OTP verify ho gaya. Ab naya password set karo.");
  }

  async function changePasswordAfterOtp(form) {
    const response = await fetch("/api/auth/password-reset/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        resetToken: form.dataset.resetToken,
        password: passwordValue(form),
      }),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "Password change failed" }));
    if (!response.ok || !result.ok) throw new Error(result.error || "Password change failed");
    showSuccess(form, result.message || "Password change ho gaya. Ab login karo.");
    form.dataset.resetId = "";
    form.dataset.resetToken = "";
    if (window.__garmentworksDb?.flush) await window.__garmentworksDb.flush();
  }

  function handleForgotPassword(form, role) {
    if (form.dataset.resetToken) return changePasswordAfterOtp(form);
    if (form.dataset.resetId) return verifyOtpOnly(form);
    return requestOtp(form, role);
  }

  function prepareForgotForms() {
    document.querySelectorAll("form").forEach((form) => {
      if (!(form instanceof HTMLFormElement)) return;
      if (formMode(form) !== "forgot") return;
      if (!form.dataset.resetToken) setPasswordInputsVisible(form, false);
      const button = form.querySelector('button[type="submit"], button');
      if (button && !form.dataset.resetId && !form.dataset.resetToken) button.textContent = "Send OTP";
    });
  }

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.closest(".login-card")) return;
      const role = routeRole();
      if (!role) return;
      const mode = formMode(form);
      if (mode === "forgot") {
        if (!form.closest(".login-card")) {
          event.preventDefault();
          event.stopImmediatePropagation();
          showError(form, "Password reset ke liye login page ka Forgot Password OTP flow use karo.");
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        handleForgotPassword(form, role).catch((error) => showError(form, error.message || "OTP reset failed"));
        return;
      }
      if (mode !== "login") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      serverLogin(form, role).catch((error) => showError(form, error.message || "Login failed"));
    },
    true,
  );

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", prepareForgotForms);
  else prepareForgotForms();
  new MutationObserver(prepareForgotForms).observe(document.documentElement, { childList: true, subtree: true });
})();

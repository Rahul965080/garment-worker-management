(function () {
  const STYLE_ID = "login-portal-fix-style";
  const FACTORIES_KEY = "garmentworks_factories";
  const DEMO_CODE = "DEMO";

  function cleanToken(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function lower(value) {
    return String(value || "").trim().toLowerCase();
  }

  function readFactories() {
    try {
      const rows = JSON.parse(window.localStorage.getItem(FACTORIES_KEY) || "[]");
      return Array.isArray(rows) ? rows.filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function resolveFactory(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const rawLower = lower(raw);
    const rawCode = cleanToken(raw);
    return (
      readFactories().find((factory) => {
        const code = String(factory.code || factory.factoryCode || factory.id || "").trim();
        const name = String(factory.name || factory.factoryName || factory.companyName || "").trim();
        const id = String(factory.id || factory.factoryId || "").trim();
        return (
          lower(code) === rawLower ||
          lower(id) === rawLower ||
          lower(name) === rawLower ||
          cleanToken(code) === rawCode ||
          cleanToken(id) === rawCode ||
          cleanToken(name) === rawCode
        );
      }) || null
    );
  }

  function setNativeInputValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isCreateFactoryForm(form) {
    return !!form.querySelector('[name="factoryName"]');
  }

  function normalizeFactoryInput(form) {
    if (!form || isCreateFactoryForm(form)) return;
    const input = form.querySelector('[name="factoryCode"]');
    if (!input) return;
    const value = String(input.value || "").trim();
    const factory = resolveFactory(value);
    if (factory?.code && cleanToken(value) !== cleanToken(factory.code)) {
      setNativeInputValue(input, factory.code);
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .login-card .login-field-hint {
        display: block;
        margin-top: -8px;
        margin-bottom: 10px;
        color: #64748b;
        font-size: 12px;
        font-weight: 800;
        line-height: 1.35;
      }
    `;
    document.head.appendChild(style);
  }

  function improveFormText(form) {
    if (!form || isCreateFactoryForm(form)) return;
    const input = form.querySelector('[name="factoryCode"]');
    if (!input) return;
    input.placeholder = "Factory code or factory name";
    if (!form.querySelector(".login-field-hint")) {
      const hint = document.createElement("small");
      hint.className = "login-field-hint";
      hint.textContent = "Factory code best hai. Agar code bhool gaye ho to factory name bhi try kar sakte ho.";
      input.insertAdjacentElement("afterend", hint);
    }
  }

  function improveErrors() {
    document.querySelectorAll(".login-error, .production-login-error").forEach((error) => {
      const text = String(error.textContent || "").trim();
      if (text === "Factory code nahi mila.") {
        error.textContent = "Factory code/name nahi mila. Create Account se account banao ya Forgot Factory Code use karo.";
      }
      if (text === "Invalid factory code, email or password.") {
        error.textContent = "Factory, email ya password match nahi hua. Factory code/name aur password dobara check karo.";
      }
      if (text === "Invalid factory code, staff email or password.") {
        error.textContent = "Factory, staff email ya password match nahi hua. Admin se assigned staff credentials check karo.";
      }
      if (text === "Invalid factory code, worker ID or password.") {
        error.textContent = "Factory, worker ID ya password match nahi hua. Admin se assigned worker credentials check karo.";
      }
    });
  }

  function clearDemoDefaults(form) {
    if (!form || isCreateFactoryForm(form)) return;
    form.querySelectorAll("input").forEach((input) => {
      const value = String(input.value || "").trim().toUpperCase();
      if ([DEMO_CODE, "ADMIN@FACTORY.IN", "ADMIN123", "MANAGER@FACTORY.IN", "MANAGER123", "ENTRY@FACTORY.IN", "ENTRY123", "GW-1001", "9876543101"].includes(value)) {
        if (!input.dataset.loginFixTouched) {
          setNativeInputValue(input, "");
          input.defaultValue = "";
          input.removeAttribute("value");
        }
      }
    });
  }

  function render() {
    ensureStyle();
    document.querySelectorAll(".login-card form").forEach((form) => {
      improveFormText(form);
      clearDemoDefaults(form);
    });
    improveErrors();
  }

  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (!form.closest(".login-card")) return;
      normalizeFactoryInput(form);
    },
    true
  );

  document.addEventListener(
    "input",
    (event) => {
      if (event.target?.matches?.(".login-card input")) {
        event.target.dataset.loginFixTouched = "true";
      }
    },
    true
  );

  new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(render, 1000);
  render();
})();

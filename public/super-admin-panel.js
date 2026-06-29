(function () {
  const ROOT_ID = "root";
  const STYLE_ID = "super-admin-panel-style";
  const FACTORIES_KEY = "garmentworks_factories";
  const SUPER_CREDENTIALS_KEY = "garmentworks_super_admin_credentials";
  const SUPER_SESSION_KEY = "garmentworks_super_admin_session";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const SESSION_KEYS = [
    "garmentworks_admin_session",
    "garmentworks_staff_session",
    "garmentworks_worker_session",
  ];
  const DB_BASE_KEYS = [
    "garmentworks_db_staff",
    "garmentworks_db_workers",
    "garmentworks_db_products",
    "garmentworks_db_production_entries",
    "garmentworks_db_advances",
    "garmentworks_db_payments",
    "garmentworks_db_staff_payments",
    "garmentworks_db_expenses",
    "garmentworks_db_piece_allotments",
    "garmentworks_db_completed_piece_allotments",
    "garmentworks_db_piece_allotment_hidden_history_ids",
  ];

  let filters = { search: "", status: "all" };
  let deleteTarget = null;
  let notice = "";
  let filterTimer = 0;

  function isSuperRoute() {
    return window.location.pathname.toLowerCase().replace(/\/+$/, "") === "/super-admin";
  }

  function isHomeRoute() {
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, "");
    return path === "" || path === "/";
  }

  function readJson(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    window.localStorage.setItem(key, JSON.stringify(value));
  }

  function normalize(value) {
    return String(value || "").trim();
  }

  function lower(value) {
    return normalize(value).toLowerCase();
  }

  function cleanCode(value) {
    return normalize(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function todayIso() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function defaultExpiry() {
    const date = new Date();
    date.setMonth(date.getMonth() + 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function number(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function factories() {
    const rows = readJson(FACTORIES_KEY, []);
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function saveFactories(rows) {
    writeJson(FACTORIES_KEY, rows);
  }

  function factoryId(factory) {
    return normalize(factory?.id || factory?.factoryId || factory?.code || factory?.factoryCode);
  }

  function factoryCode(factory) {
    return normalize(factory?.code || factory?.factoryCode || factory?.id || factory?.factoryId);
  }

  function factoryName(factory) {
    return normalize(factory?.name || factory?.factoryName || factory?.companyName || "Unnamed Factory");
  }

  function scopedKey(baseKey, id) {
    const cleanId = normalize(id);
    return !cleanId || cleanId === "demo" ? baseKey : `${baseKey}_${cleanId}`;
  }

  function rowsFor(baseKey, id) {
    const rows = readJson(scopedKey(baseKey, id), []);
    return Array.isArray(rows) ? rows : [];
  }

  function firstAdmin(factory) {
    const staff = rowsFor("garmentworks_db_staff", factoryId(factory));
    return staff.find((member) => String(member?.role || "").toLowerCase() === "admin") || staff[0] || null;
  }

  function subscription(factory) {
    const plan = normalize(factory?.subscriptionPlan || factory?.plan || "Trial") || "Trial";
    const status = normalize(factory?.subscriptionStatus || factory?.statusSubscription || "Trial") || "Trial";
    const expiresAt = normalize(factory?.subscriptionExpiresAt || factory?.expiresAt || factory?.trialEndsAt || "");
    return { plan, status, expiresAt };
  }

  function effectiveStatus(factory) {
    const current = subscription(factory);
    if (String(current.status).toLowerCase() === "suspended") return "Suspended";
    if (current.expiresAt && current.expiresAt < todayIso()) return "Expired";
    return current.status || "Trial";
  }

  function factorySummary(factory) {
    const id = factoryId(factory);
    const staff = rowsFor("garmentworks_db_staff", id);
    const workers = rowsFor("garmentworks_db_workers", id);
    const products = rowsFor("garmentworks_db_products", id);
    const production = rowsFor("garmentworks_db_production_entries", id);
    const advances = rowsFor("garmentworks_db_advances", id);
    const payments = rowsFor("garmentworks_db_payments", id);
    const staffPayments = rowsFor("garmentworks_db_staff_payments", id);
    const expenses = rowsFor("garmentworks_db_expenses", id);
    const admin = firstAdmin(factory);
    const sub = subscription(factory);
    return {
      id,
      code: factoryCode(factory),
      name: factoryName(factory),
      owner: normalize(factory.owner || factory.ownerName || factory.adminName || admin?.name || ""),
      email: normalize(factory.email || factory.ownerEmail || factory.adminEmail || admin?.email || ""),
      mobile: normalize(factory.mobile || factory.ownerMobile || factory.adminMobile || admin?.mobile || ""),
      plan: sub.plan,
      status: effectiveStatus(factory),
      rawStatus: sub.status,
      expiresAt: sub.expiresAt,
      staffCount: staff.length,
      adminCount: staff.filter((member) => String(member?.role || "").toLowerCase() === "admin").length,
      workerCount: workers.length,
      productCount: products.length,
      entryCount: production.length,
      financeCount: advances.length + payments.length + staffPayments.length + expenses.length,
      createdAt: normalize(factory.createdAt || ""),
    };
  }

  function allSummaries() {
    return factories().map(factorySummary);
  }

  function totals(summaries) {
    return summaries.reduce(
      (total, item) => {
        total.factories += 1;
        total.staff += item.staffCount;
        total.admins += item.adminCount;
        total.workers += item.workerCount;
        total.products += item.productCount;
        total.entries += item.entryCount;
        if (item.status === "Active") total.active += 1;
        else if (item.status === "Expired") total.expired += 1;
        else if (item.status === "Suspended") total.suspended += 1;
        else total.trial += 1;
        return total;
      },
      { factories: 0, staff: 0, admins: 0, workers: 0, products: 0, entries: 0, active: 0, expired: 0, suspended: 0, trial: 0 }
    );
  }

  function credentials() {
    return readJson(SUPER_CREDENTIALS_KEY, null);
  }

  function sessionActive() {
    const session = readJson(SUPER_SESSION_KEY, null);
    if (!session?.email || !session?.loginAt) return false;
    const age = Date.now() - Number(session.loginAt || 0);
    return age < 12 * 60 * 60 * 1000;
  }

  function setNotice(message) {
    notice = message;
    render();
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.super-admin-body {
        margin: 0;
        min-width: 320px;
        background: #f6f8fb;
        color: #17212b;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .super-admin-shell {
        min-height: 100vh;
        padding: 22px;
        background:
          radial-gradient(circle at 12% 10%, rgba(20, 184, 166, .14), transparent 24rem),
          radial-gradient(circle at 90% 12%, rgba(15, 118, 110, .09), transparent 24rem),
          #f6f8fb;
      }
      .super-admin-login {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 22px;
      }
      .super-card {
        width: min(520px, 100%);
        display: grid;
        gap: 16px;
        padding: 24px;
        border: 1px solid #dce5ea;
        border-radius: 8px;
        background: rgba(255, 255, 255, .96);
        box-shadow: 0 26px 70px rgba(14, 27, 34, .16);
      }
      .super-logo-row,
      .super-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .super-mark {
        display: inline-grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 8px;
        background: linear-gradient(135deg, #14b8a6, #0f766e);
        color: #fff;
        font-weight: 950;
      }
      .super-card h1,
      .super-topbar h1 {
        margin: 0;
        font-size: clamp(30px, 4vw, 44px);
        line-height: 1.05;
      }
      .super-card p,
      .super-topbar p,
      .super-muted {
        margin: 6px 0 0;
        color: #687683;
        font-size: 14px;
        line-height: 1.45;
      }
      .super-form,
      .super-filter-row {
        display: grid;
        gap: 10px;
      }
      .super-field {
        display: grid;
        gap: 6px;
      }
      .super-field span {
        color: #687683;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .super-field input,
      .super-field select {
        width: 100%;
        min-height: 42px;
        border: 1px solid #dce5ea;
        border-radius: 8px;
        background: #fff;
        color: #17212b;
        padding: 10px 11px;
        outline: none;
      }
      .super-field input:focus,
      .super-field select:focus {
        border-color: #14b8a6;
        box-shadow: 0 0 0 3px rgba(20, 184, 166, .16);
      }
      .super-button,
      .super-ghost,
      .super-danger {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        border-radius: 8px;
        padding: 0 14px;
        font-weight: 900;
        font-size: 13px;
        cursor: pointer;
      }
      .super-button {
        border: 1px solid #0f766e;
        background: #0f766e;
        color: #fff;
      }
      .super-ghost {
        border: 1px solid #dce5ea;
        background: #fff;
        color: #34424d;
      }
      .super-danger {
        border: 1px solid #dc2626;
        background: #dc2626;
        color: #fff;
      }
      .super-note {
        padding: 11px 12px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: #e4f7f5;
        color: #0f766e;
        font-size: 13px;
        font-weight: 850;
      }
      .super-warning {
        padding: 11px 12px;
        border-radius: 8px;
        background: #fff6db;
        color: #8a5a00;
        font-size: 13px;
        font-weight: 850;
      }
      .super-dashboard {
        display: grid;
        gap: 16px;
      }
      .super-kpis {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
      }
      .super-kpi,
      .super-panel {
        border: 1px solid #dce5ea;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 16px 40px rgba(15, 35, 45, .08);
      }
      .super-kpi {
        min-height: 104px;
        display: grid;
        align-content: center;
        gap: 6px;
        padding: 14px;
        text-align: center;
      }
      .super-kpi span {
        color: #687683;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .super-kpi strong {
        font-size: 24px;
      }
      .super-panel {
        display: grid;
        gap: 14px;
        padding: 16px;
      }
      .super-filter-row {
        grid-template-columns: minmax(220px, 1fr) 190px auto;
        align-items: end;
      }
      .super-table-wrap {
        overflow: auto;
        border: 1px solid #dce5ea;
        border-radius: 8px;
      }
      .super-table {
        width: 100%;
        min-width: 1180px;
        border-collapse: collapse;
      }
      .super-table th,
      .super-table td {
        padding: 11px 10px;
        border-bottom: 1px solid #dce5ea;
        text-align: left;
        white-space: nowrap;
        font-size: 13px;
      }
      .super-table th {
        color: #52616d;
        background: #f8fbfc;
        font-size: 11px;
        font-weight: 950;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .super-company {
        display: grid;
        gap: 3px;
      }
      .super-company strong {
        color: #17212b;
      }
      .super-company span {
        color: #687683;
        font-size: 12px;
      }
      .super-status {
        display: inline-flex;
        justify-content: center;
        min-width: 78px;
        padding: 6px 9px;
        border-radius: 999px;
        font-size: 12px;
        font-weight: 950;
      }
      .super-status.active { background: #dcfce7; color: #047857; }
      .super-status.trial { background: #e4f7f5; color: #0f766e; }
      .super-status.expired { background: #fee2e2; color: #dc2626; }
      .super-status.suspended { background: #0e1b22; color: #fff; }
      .super-inline-controls {
        display: grid;
        grid-template-columns: 120px 120px 138px auto;
        gap: 7px;
        align-items: center;
      }
      .super-inline-controls input,
      .super-inline-controls select {
        min-height: 34px;
        border: 1px solid #dce5ea;
        border-radius: 8px;
        padding: 7px 8px;
      }
      .super-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .super-modal {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(14, 27, 34, .58);
        backdrop-filter: blur(6px);
      }
      .super-empty {
        padding: 18px;
        border: 1px dashed rgba(15, 118, 110, .24);
        border-radius: 8px;
        background: #f8fbfc;
        color: #687683;
        text-align: center;
        font-weight: 850;
      }
      .super-home-link {
        margin-left: 8px;
      }
      @media (max-width: 1120px) {
        .super-kpis {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
        .super-filter-row {
          grid-template-columns: 1fr;
        }
      }
      @media (max-width: 680px) {
        .super-admin-shell {
          padding: 14px;
        }
        .super-kpis {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .super-inline-controls {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function field(label, input) {
    return `<label class="super-field"><span>${escapeHtml(label)}</span>${input}</label>`;
  }

  function renderSetup() {
    const isReset = Boolean(window.__superAdminResetLogin);
    return `
      <main class="super-admin-login">
        <section class="super-card">
          <div class="super-logo-row">
            <div class="super-mark">SA</div>
            <a class="super-ghost" href="/">Home</a>
          </div>
          <div>
            <h1>${isReset ? "Reset Super Admin Login" : "Super Admin Setup"}</h1>
            <p>${isReset ? "Naya email/password set karo. Company data delete nahi hoga." : "Pehli baar ek master login banao. Iske baad isi se companies aur subscription manage honge."}</p>
          </div>
          ${notice ? `<div class="super-note">${escapeHtml(notice)}</div>` : ""}
          <form class="super-form" data-super-setup>
            ${field("Super Admin Email", `<input name="email" type="email" placeholder="owner@example.com" required>`)}
            ${field("Password", `<input name="password" type="password" minlength="6" placeholder="Minimum 6 characters" required>`)}
            ${field("Confirm Password", `<input name="confirm" type="password" minlength="6" required>`)}
            <div class="super-actions">
              ${isReset ? `<button class="super-ghost" type="button" data-cancel-reset-login>Cancel</button>` : ""}
              <button class="super-button" type="submit">${isReset ? "Save New Login" : "Create Super Admin"}</button>
            </div>
          </form>
          <div class="super-warning">Security note: current app browser storage par chal raha hai. Real public SaaS ke liye backend auth/database zaruri hoga.</div>
        </section>
      </main>
    `;
  }

  function renderLogin() {
    return `
      <main class="super-admin-login">
        <section class="super-card">
          <div class="super-logo-row">
            <div class="super-mark">SA</div>
            <a class="super-ghost" href="/">Home</a>
          </div>
          <div>
            <h1>Super Admin Login</h1>
            <p>All company accounts, subscription status aur permanent delete controls yahin rahenge.</p>
          </div>
          ${notice ? `<div class="super-note">${escapeHtml(notice)}</div>` : ""}
          <form class="super-form" data-super-login>
            ${field("Email", `<input name="email" type="email" autocomplete="username" required>`)}
            ${field("Password", `<input name="password" type="password" autocomplete="current-password" required>`)}
            <button class="super-button" type="submit">Login Super Admin</button>
          </form>
          <button class="super-ghost" type="button" data-super-reset-login>Forgot / Reset Super Admin Login</button>
        </section>
      </main>
    `;
  }

  function kpi(label, value) {
    return `<article class="super-kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
  }

  function statusClass(status) {
    return String(status || "Trial").toLowerCase();
  }

  function filteredSummaries() {
    const query = lower(filters.search);
    return allSummaries().filter((item) => {
      const statusOk = filters.status === "all" || statusClass(item.status) === filters.status;
      const text = lower([item.name, item.code, item.owner, item.email, item.mobile, item.plan, item.status].join(" "));
      return statusOk && (!query || text.includes(query));
    });
  }

  function renderDashboard() {
    const summaries = allSummaries();
    const shown = filteredSummaries();
    const total = totals(summaries);
    return `
      <main class="super-admin-shell">
        <section class="super-dashboard">
          <div class="super-topbar">
            <div>
              <h1>Super Admin Panel</h1>
              <p>Company subscription, account count aur permanent delete control.</p>
            </div>
            <div class="super-actions">
              <a class="super-ghost" href="/">Home</a>
              <button class="super-ghost" type="button" data-super-change-password>Change Login</button>
              <button class="super-danger" type="button" data-super-logout>Logout</button>
            </div>
          </div>
          ${notice ? `<div class="super-note">${escapeHtml(notice)}</div>` : ""}
          <div class="super-kpis">
            ${kpi("Companies", number(total.factories))}
            ${kpi("Active", number(total.active))}
            ${kpi("Trial", number(total.trial))}
            ${kpi("Expired", number(total.expired))}
            ${kpi("Suspended", number(total.suspended))}
            ${kpi("Total Users", number(total.staff + total.workers))}
          </div>
          <section class="super-panel">
            <div class="super-filter-row">
              ${field("Search Company", `<input data-super-filter="search" value="${escapeHtml(filters.search)}" placeholder="Factory name, code, owner, email...">`)}
              ${field(
                "Status",
                `<select data-super-filter="status">
                  <option value="all"${filters.status === "all" ? " selected" : ""}>All</option>
                  <option value="active"${filters.status === "active" ? " selected" : ""}>Active</option>
                  <option value="trial"${filters.status === "trial" ? " selected" : ""}>Trial</option>
                  <option value="expired"${filters.status === "expired" ? " selected" : ""}>Expired</option>
                  <option value="suspended"${filters.status === "suspended" ? " selected" : ""}>Suspended</option>
                </select>`
              )}
              <button class="super-ghost" type="button" data-super-refresh>Refresh</button>
            </div>
            ${
              shown.length
                ? `<div class="super-table-wrap">
                    <table class="super-table">
                      <thead>
                        <tr>
                          <th>Company</th>
                          <th>Owner</th>
                          <th>Subscription</th>
                          <th>Accounts</th>
                          <th>Data</th>
                          <th>Manage</th>
                          <th>Delete</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${shown.map(companyRow).join("")}
                      </tbody>
                    </table>
                  </div>`
                : `<div class="super-empty">Is filter me company account nahi mila.</div>`
            }
          </section>
        </section>
        ${deleteTarget ? renderDeleteModal(deleteTarget) : ""}
      </main>
    `;
  }

  function companyRow(item) {
    return `
      <tr>
        <td>
          <div class="super-company">
            <strong>${escapeHtml(item.name)}</strong>
            <span>Code: ${escapeHtml(item.code || item.id || "NO-CODE")}</span>
            <span>Created: ${escapeHtml(item.createdAt || "-")}</span>
          </div>
        </td>
        <td>
          <div class="super-company">
            <strong>${escapeHtml(item.owner || "-")}</strong>
            <span>${escapeHtml(item.email || "-")}</span>
            <span>${escapeHtml(item.mobile || "-")}</span>
          </div>
        </td>
        <td>
          <div class="super-company">
            <span class="super-status ${escapeHtml(statusClass(item.status))}">${escapeHtml(item.status)}</span>
            <span>Plan: ${escapeHtml(item.plan || "Trial")}</span>
            <span>Expiry: ${escapeHtml(item.expiresAt || "-")}</span>
          </div>
        </td>
        <td>Admins ${number(item.adminCount)} / Staff ${number(item.staffCount)} / Workers ${number(item.workerCount)}</td>
        <td>Products ${number(item.productCount)} / Entries ${number(item.entryCount)} / Finance ${number(item.financeCount)}</td>
        <td>
          <div class="super-inline-controls" data-sub-row="${escapeHtml(item.id)}">
            <select data-sub-field="plan">
              ${["Trial", "Basic", "Pro", "Enterprise"].map((plan) => `<option value="${plan}"${item.plan === plan ? " selected" : ""}>${plan}</option>`).join("")}
            </select>
            <select data-sub-field="status">
              ${["Trial", "Active", "Expired", "Suspended"].map((status) => `<option value="${status}"${item.rawStatus === status || item.status === status ? " selected" : ""}>${status}</option>`).join("")}
            </select>
            <input type="date" data-sub-field="expiresAt" value="${escapeHtml(item.expiresAt || defaultExpiry())}">
            <button class="super-button" type="button" data-save-subscription="${escapeHtml(item.id)}">Save</button>
          </div>
        </td>
        <td>
          <button class="super-danger" type="button" data-delete-factory="${escapeHtml(item.id)}">Permanent Delete</button>
        </td>
      </tr>
    `;
  }

  function renderDeleteModal(target) {
    return `
      <div class="super-modal" role="dialog" aria-modal="true">
        <section class="super-card">
          <div>
            <h1>Permanent Delete</h1>
            <p><strong>${escapeHtml(target.name)}</strong> ka factory account aur uska local data permanently delete hoga.</p>
          </div>
          <div class="super-warning">Delete ke baad factory, staff, workers, product, production, payment, advance, expenses aur allotment records remove ho jayenge.</div>
          <form class="super-form" data-confirm-delete="${escapeHtml(target.id)}">
            ${field("Confirm Factory Code", `<input name="code" placeholder="${escapeHtml(target.code)}" required>`)}
            <div class="super-actions">
              <button class="super-ghost" type="button" data-cancel-delete>Cancel</button>
              <button class="super-danger" type="submit">Delete Forever</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function renderChangeLogin() {
    const current = credentials();
    return `
      <main class="super-admin-login">
        <section class="super-card">
          <div>
            <h1>Change Super Admin Login</h1>
            <p>Naya email/password set karo.</p>
          </div>
          <form class="super-form" data-super-setup>
            ${field("Super Admin Email", `<input name="email" type="email" value="${escapeHtml(current?.email || "")}" required>`)}
            ${field("New Password", `<input name="password" type="password" minlength="6" required>`)}
            ${field("Confirm Password", `<input name="confirm" type="password" minlength="6" required>`)}
            <div class="super-actions">
              <button class="super-ghost" type="button" data-cancel-change-login>Cancel</button>
              <button class="super-button" type="submit">Save Login</button>
            </div>
          </form>
        </section>
      </main>
    `;
  }

  function render() {
    if (window.__superAdminAdvancedActive) return;
    if (!isSuperRoute()) {
      injectHomeLink();
      return;
    }
    ensureStyle();
    document.body.classList.add("super-admin-body");
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (window.__superAdminChangeLogin) {
      root.innerHTML = renderChangeLogin();
      return;
    }
    if (window.__superAdminResetLogin) root.innerHTML = renderSetup();
    else if (!credentials()) root.innerHTML = renderSetup();
    else if (!sessionActive()) root.innerHTML = renderLogin();
    else root.innerHTML = renderDashboard();
  }

  function injectHomeLink() {
    if (!isHomeRoute() || document.querySelector("[data-super-admin-home-link]")) return;
    const tryInject = () => {
      if (!isHomeRoute() || document.querySelector("[data-super-admin-home-link]")) return;
      const primaryArea = document.querySelector(".hero-actions, .home-actions, .portal-actions") || document.querySelector("main");
      if (!primaryArea) return;
      const link = document.createElement("a");
      link.href = "/super-admin";
      link.dataset.superAdminHomeLink = "true";
      link.className = "portal-link-button super-home-link";
      link.textContent = "Super Admin";
      primaryArea.appendChild(link);
    };
    setTimeout(tryInject, 500);
    setTimeout(tryInject, 1400);
  }

  function setupCredentials(form) {
    const data = new FormData(form);
    const email = lower(data.get("email"));
    const password = normalize(data.get("password"));
    const confirm = normalize(data.get("confirm"));
    if (!email || password.length < 6) {
      setNotice("Email aur minimum 6 character password required hai.");
      return;
    }
    if (password !== confirm) {
      setNotice("Password aur confirm password match nahi hai.");
      return;
    }
    writeJson(SUPER_CREDENTIALS_KEY, { email, password, updatedAt: new Date().toISOString() });
    writeJson(SUPER_SESSION_KEY, { email, loginAt: Date.now() });
    window.__superAdminChangeLogin = false;
    window.__superAdminResetLogin = false;
    setNotice("Super Admin login save ho gaya.");
  }

  function login(form) {
    const data = new FormData(form);
    const email = lower(data.get("email"));
    const password = normalize(data.get("password"));
    const saved = credentials();
    if (!saved || saved.email !== email || saved.password !== password) {
      setNotice("Super Admin email ya password match nahi hua.");
      return;
    }
    writeJson(SUPER_SESSION_KEY, { email, loginAt: Date.now() });
    notice = "";
    render();
  }

  function updateSubscription(id, row) {
    const plan = normalize(row.querySelector('[data-sub-field="plan"]')?.value || "Trial");
    const status = normalize(row.querySelector('[data-sub-field="status"]')?.value || "Trial");
    const expiresAt = normalize(row.querySelector('[data-sub-field="expiresAt"]')?.value || "");
    const needle = cleanCode(id);
    const updated = factories().map((factory) => {
      const same = cleanCode(factoryId(factory)) === needle || cleanCode(factoryCode(factory)) === needle;
      if (!same) return factory;
      return {
        ...factory,
        subscriptionPlan: plan,
        subscriptionStatus: status,
        subscriptionExpiresAt: expiresAt,
        subscriptionUpdatedAt: new Date().toISOString(),
      };
    });
    saveFactories(updated);
    setNotice("Subscription update ho gaya.");
  }

  function targetById(id) {
    const needle = cleanCode(id);
    return allSummaries().find((item) => cleanCode(item.id) === needle || cleanCode(item.code) === needle) || null;
  }

  function deleteFactory(id, codeValue) {
    const target = targetById(id);
    if (!target) {
      setNotice("Factory record nahi mila.");
      return;
    }
    if (cleanCode(codeValue) !== cleanCode(target.code)) {
      setNotice("Factory code match nahi hua. Delete cancel.");
      return;
    }
    const needle = cleanCode(target.id);
    const codeNeedle = cleanCode(target.code);
    saveFactories(
      factories().filter((factory) => {
        return cleanCode(factoryId(factory)) !== needle && cleanCode(factoryCode(factory)) !== codeNeedle;
      })
    );
    DB_BASE_KEYS.forEach((baseKey) => {
      window.localStorage.removeItem(scopedKey(baseKey, target.id));
      window.localStorage.removeItem(scopedKey(baseKey, target.code));
    });
    if (cleanCode(window.localStorage.getItem(ACTIVE_FACTORY_KEY)) === needle || cleanCode(window.localStorage.getItem(ACTIVE_FACTORY_KEY)) === codeNeedle) {
      window.localStorage.removeItem(ACTIVE_FACTORY_KEY);
    }
    SESSION_KEYS.forEach((key) => {
      const session = readJson(key, null);
      if (!session) return;
      const sessionFactory = cleanCode(session.factoryId || session.factory || session.factoryCode || "");
      if (sessionFactory === needle || sessionFactory === codeNeedle) window.localStorage.removeItem(key);
    });
    deleteTarget = null;
    setNotice(`${target.name} permanently delete ho gaya.`);
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (!isSuperRoute()) return;
      const setupForm = event.target.closest("[data-super-setup]");
      const loginForm = event.target.closest("[data-super-login]");
      const deleteForm = event.target.closest("[data-confirm-delete]");
      if (setupForm) {
        event.preventDefault();
        setupCredentials(setupForm);
      } else if (loginForm) {
        event.preventDefault();
        login(loginForm);
      } else if (deleteForm) {
        event.preventDefault();
        deleteFactory(deleteForm.dataset.confirmDelete, new FormData(deleteForm).get("code"));
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (!isSuperRoute()) return;
      const deleteButton = event.target.closest("[data-delete-factory]");
      const saveButton = event.target.closest("[data-save-subscription]");
      if (event.target.closest("[data-super-logout]")) {
        window.localStorage.removeItem(SUPER_SESSION_KEY);
        notice = "";
        render();
      } else if (event.target.closest("[data-super-refresh]")) {
        render();
      } else if (event.target.closest("[data-super-change-password]")) {
        window.__superAdminChangeLogin = true;
        render();
      } else if (event.target.closest("[data-super-reset-login]")) {
        window.__superAdminResetLogin = true;
        notice = "Naya Super Admin login set karo. Company data safe rahega.";
        render();
      } else if (event.target.closest("[data-cancel-change-login]")) {
        window.__superAdminChangeLogin = false;
        render();
      } else if (event.target.closest("[data-cancel-reset-login]")) {
        window.__superAdminResetLogin = false;
        notice = "";
        render();
      } else if (event.target.closest("[data-cancel-delete]")) {
        deleteTarget = null;
        render();
      } else if (saveButton) {
        const row = saveButton.closest("[data-sub-row]");
        updateSubscription(saveButton.dataset.saveSubscription, row);
      } else if (deleteButton) {
        deleteTarget = targetById(deleteButton.dataset.deleteFactory);
        render();
      }
    },
    true
  );

  document.addEventListener("input", (event) => {
    if (!isSuperRoute()) return;
    const filter = event.target?.dataset?.superFilter;
    if (!filter) return;
    filters[filter] = event.target.value;
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(render, 140);
  });

  document.addEventListener("change", (event) => {
    if (!isSuperRoute()) return;
    const filter = event.target?.dataset?.superFilter;
    if (!filter) return;
    filters[filter] = event.target.value;
    render();
  });

  function renderWhenIdle() {
    if (window.__superAdminAdvancedActive) return;
    if (!isSuperRoute()) {
      injectHomeLink();
      return;
    }
    if (document.activeElement?.closest?.(".super-admin-shell")) return;
    render();
  }

  window.addEventListener("storage", render);
  setTimeout(render, 120);
  setInterval(renderWhenIdle, 3000);
})();

(function () {
  const ROOT_ID = "root";
  const STYLE_ID = "super-admin-advanced-style";
  const FACTORIES_KEY = "garmentworks_factories";
  const SUPER_CREDENTIALS_KEY = "garmentworks_super_admin_credentials";
  const SUPER_SESSION_KEY = "garmentworks_super_admin_session";
  const LOGS_KEY = "garmentworks_super_admin_activity_logs";
  const DELETED_KEY = "garmentworks_super_admin_deleted_companies";
  const PLANS_KEY = "garmentworks_subscription_plans";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
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
  const SESSION_KEYS = ["garmentworks_admin_session", "garmentworks_staff_session", "garmentworks_worker_session"];
  const defaultPlans = [
    { id: "trial", name: "Trial", type: "Trial", durationDays: 7, price: 0, active: true },
    { id: "monthly", name: "Monthly", type: "Monthly", durationDays: 30, price: 999, active: true },
    { id: "quarterly", name: "Quarterly", type: "Quarterly", durationDays: 90, price: 2499, active: true },
    { id: "half-yearly", name: "Half-Yearly", type: "Half-Yearly", durationDays: 180, price: 4499, active: true },
    { id: "annual", name: "Annual", type: "Annual", durationDays: 365, price: 7999, active: true },
    { id: "lifetime", name: "Lifetime", type: "Lifetime", durationDays: 36500, price: 24999, active: true },
  ];

  let section = "dashboard";
  let filters = { search: "", status: "all" };
  let modal = null;
  let notice = "";
  let filterTimer = 0;

  function route() {
    return window.location.pathname.toLowerCase().replace(/\/+$/, "") === "/super-admin";
  }

  function readJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function esc(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function norm(value) {
    return String(value || "").trim();
  }

  function lower(value) {
    return norm(value).toLowerCase();
  }

  function clean(value) {
    return norm(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function money(value) {
    return "₹" + new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function num(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function monthKey(dateValue) {
    return norm(dateValue || todayIso()).slice(0, 7);
  }

  function daysFromNow(days) {
    const d = new Date();
    d.setDate(d.getDate() + Number(days || 0));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function scopedKey(baseKey, id) {
    const cleanId = norm(id);
    return !cleanId || cleanId === "demo" ? baseKey : `${baseKey}_${cleanId}`;
  }

  function rowsFor(baseKey, id) {
    const rows = readJson(scopedKey(baseKey, id), []);
    return Array.isArray(rows) ? rows : [];
  }

  function factories() {
    const rows = readJson(FACTORIES_KEY, []);
    return Array.isArray(rows) ? rows.filter(Boolean) : [];
  }

  function saveFactories(rows) {
    writeJson(FACTORIES_KEY, rows);
  }

  function plans() {
    const rows = readJson(PLANS_KEY, null);
    if (Array.isArray(rows) && rows.length) return rows;
    writeJson(PLANS_KEY, defaultPlans);
    return defaultPlans;
  }

  function logs() {
    const rows = readJson(LOGS_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function deletedRows() {
    const rows = readJson(DELETED_KEY, []);
    return Array.isArray(rows) ? rows : [];
  }

  function credentials() {
    return readJson(SUPER_CREDENTIALS_KEY, null);
  }

  function sessionActive() {
    const session = readJson(SUPER_SESSION_KEY, null);
    return Boolean(session?.email && Date.now() - Number(session.loginAt || 0) < 12 * 60 * 60 * 1000);
  }

  function factoryId(row) {
    return norm(row?.id || row?.factoryId || row?.code || row?.factoryCode);
  }

  function factoryCode(row) {
    return norm(row?.code || row?.factoryCode || row?.id || row?.factoryId);
  }

  function factoryName(row) {
    return norm(row?.name || row?.factoryName || row?.companyName || "Unnamed Company");
  }

  function statusOf(row) {
    const account = norm(row?.accountStatus || "");
    const sub = norm(row?.subscriptionStatus || row?.statusSubscription || "Trial");
    const expiry = norm(row?.subscriptionExpiresAt || row?.expiresAt || row?.trialEndsAt || "");
    if (lower(account) === "deleted") return "Deleted";
    if (lower(account) === "suspended" || lower(sub) === "suspended") return "Suspended";
    if (expiry && expiry < todayIso()) return "Expired";
    if (lower(sub) === "active") return "Active";
    return sub || "Trial";
  }

  function adminFor(row) {
    const staff = rowsFor("garmentworks_db_staff", factoryId(row));
    return staff.find((item) => lower(item?.role) === "admin") || staff[0] || null;
  }

  function storageUsed(row) {
    const id = factoryId(row);
    let bytes = JSON.stringify(row || {}).length;
    DB_BASE_KEYS.forEach((base) => {
      bytes += (localStorage.getItem(scopedKey(base, id)) || "").length;
      bytes += (localStorage.getItem(scopedKey(base, factoryCode(row))) || "").length;
    });
    return bytes;
  }

  function mb(bytes) {
    return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
  }

  function summary(row) {
    const id = factoryId(row);
    const admin = adminFor(row);
    const staff = rowsFor("garmentworks_db_staff", id);
    const workers = rowsFor("garmentworks_db_workers", id);
    const products = rowsFor("garmentworks_db_products", id);
    const production = rowsFor("garmentworks_db_production_entries", id);
    const expenses = rowsFor("garmentworks_db_expenses", id);
    const payments = rowsFor("garmentworks_db_payments", id);
    const amount = Number(row?.subscriptionAmount || row?.subscriptionPrice || row?.revenue || 0);
    return {
      raw: row,
      id,
      code: factoryCode(row),
      name: factoryName(row),
      logo: norm(row?.logo || row?.logoUrl || row?.image || ""),
      owner: norm(row?.owner || row?.ownerName || row?.adminName || admin?.name || "-"),
      email: norm(row?.email || row?.ownerEmail || row?.adminEmail || admin?.email || "-"),
      mobile: norm(row?.mobile || row?.ownerMobile || row?.adminMobile || admin?.mobile || "-"),
      gst: norm(row?.gst || row?.gstNumber || row?.gstNo || ""),
      pan: norm(row?.pan || row?.panNumber || ""),
      business: norm(row?.businessType || row?.type || "Garment Factory"),
      createdAt: norm(row?.createdAt || row?.registrationDate || ""),
      lastLogin: norm(row?.lastLogin || row?.lastLoginAt || "-"),
      plan: norm(row?.subscriptionPlan || row?.plan || "Trial"),
      status: statusOf(row),
      expiresAt: norm(row?.subscriptionExpiresAt || row?.expiresAt || row?.trialEndsAt || ""),
      amount,
      staffCount: staff.length,
      workerCount: workers.length,
      productCount: products.length,
      entryCount: production.length,
      expenseCount: expenses.length,
      paymentCount: payments.length,
      storage: storageUsed(row),
      activeDevices: Number(row?.activeDevices || row?.deviceCount || 1),
    };
  }

  function summaries() {
    return factories().map(summary);
  }

  function factoryCodeCount(rows = summaries()) {
    return new Set(rows.map((item) => clean(item.code || item.id)).filter(Boolean)).size;
  }

  function duplicateAlerts() {
    const fields = [
      ["Email", (x) => lower(x.email)],
      ["Mobile", (x) => clean(x.mobile)],
      ["GST", (x) => clean(x.gst)],
      ["PAN", (x) => clean(x.pan)],
      ["Business Name", (x) => lower(x.name)],
    ];
    const alerts = [];
    const rows = summaries();
    fields.forEach(([label, getter]) => {
      const map = new Map();
      rows.forEach((item) => {
        const key = getter(item);
        if (!key || key === "-") return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(item);
      });
      map.forEach((items, key) => {
        if (items.length > 1) alerts.push({ label, key, items });
      });
    });
    return alerts;
  }

  function totals() {
    const rows = summaries();
    const currentMonth = monthKey(todayIso());
    const today = todayIso();
    const dueSoon = rows.filter((x) => x.expiresAt && x.expiresAt >= today && x.expiresAt <= daysFromNow(7)).length;
    return {
      total: rows.length,
      factoryCodes: factoryCodeCount(rows),
      active: rows.filter((x) => x.status === "Active").length,
      trial: rows.filter((x) => x.status === "Trial").length,
      expired: rows.filter((x) => x.status === "Expired").length,
      suspended: rows.filter((x) => x.status === "Suspended").length,
      deleted: deletedRows().length,
      duplicates: duplicateAlerts().length,
      today: rows.filter((x) => norm(x.createdAt).slice(0, 10) === today).length,
      monthly: rows.filter((x) => monthKey(x.createdAt) === currentMonth).length,
      revenue: rows.reduce((sum, x) => sum + x.amount, 0),
      dueSoon,
      storage: rows.reduce((sum, x) => sum + x.storage, 0),
      users: rows.reduce((sum, x) => sum + x.staffCount + x.workerCount, 0),
      devices: rows.reduce((sum, x) => sum + x.activeDevices, 0),
      entries: rows.reduce((sum, x) => sum + x.entryCount, 0),
    };
  }

  function addLog(action, company, extra) {
    const rows = logs();
    rows.unshift({
      id: `log_${Date.now()}`,
      action,
      company: company?.name || company?.companyName || company?.factoryName || company?.code || "-",
      code: company ? factoryCode(company) : "-",
      date: new Date().toISOString(),
      superAdmin: credentials()?.email || "super-admin",
      device: navigator.platform || "Browser",
      browser: navigator.userAgent || "Browser",
      extra: extra || "",
    });
    writeJson(LOGS_KEY, rows.slice(0, 300));
  }

  function filteredCompanies() {
    const q = lower(filters.search);
    return summaries().filter((item) => {
      const statusOk = filters.status === "all" || lower(item.status) === filters.status;
      const text = lower([item.name, item.code, item.owner, item.email, item.mobile, item.gst, item.pan, item.plan, item.status].join(" "));
      return statusOk && (!q || text.includes(q));
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.super-admin-advanced-body{margin:0;background:#f5f7fb;color:#17212b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .sa-shell{min-height:100vh;display:grid;grid-template-columns:260px 1fr;background:#f5f7fb}
      .sa-side{position:sticky;top:0;height:100vh;padding:18px;border-right:1px solid #dbe5ea;background:#0e1b22;color:#fff;display:flex;flex-direction:column;gap:14px}
      .sa-brand{display:flex;align-items:center;gap:10px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.14)}
      .sa-mark{width:42px;height:42px;border-radius:8px;display:grid;place-items:center;background:#14b8a6;font-weight:950}
      .sa-brand strong{display:block;font-size:16px}.sa-brand span{color:#a9bac3;font-size:12px}
      .sa-nav{display:grid;gap:7px}.sa-nav button,.sa-side a{border:0;border-radius:8px;background:transparent;color:#d8e5eb;text-align:left;padding:11px 12px;font-weight:850;cursor:pointer;text-decoration:none}
      .sa-nav button.active,.sa-nav button:hover,.sa-side a:hover{background:#18313a;color:#fff}
      .sa-main{padding:22px;display:grid;gap:16px;align-content:start}
      .sa-top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
      .sa-top h1{margin:0;font-size:clamp(28px,4vw,44px);line-height:1}.sa-top p{margin:6px 0 0;color:#667783}
      .sa-actions{display:flex;gap:8px;flex-wrap:wrap}.sa-btn,.sa-ghost,.sa-danger{min-height:38px;border-radius:8px;padding:0 13px;font-weight:900;cursor:pointer}
      .sa-btn{background:#0f766e;color:#fff;border:1px solid #0f766e}.sa-ghost{background:#fff;color:#273742;border:1px solid #dbe5ea}.sa-danger{background:#dc2626;color:#fff;border:1px solid #dc2626}
      .sa-note{padding:11px 12px;border-radius:8px;background:#e4f7f5;color:#0f766e;border:1px solid rgba(15,118,110,.18);font-weight:850}
      .sa-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.sa-card{border:1px solid #dbe5ea;border-radius:8px;background:#fff;box-shadow:0 14px 34px rgba(15,35,45,.07)}
      .sa-kpi{padding:14px;display:grid;gap:6px;text-align:center;align-content:center;min-height:96px}.sa-kpi span{color:#657783;font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.06em}.sa-kpi strong{font-size:23px}
      .sa-panel{padding:16px;display:grid;gap:14px}.sa-panel h2{margin:0;font-size:20px}.sa-sub{color:#657783;font-size:13px;margin:0}
      .sa-two{display:grid;grid-template-columns:1.15fr .85fr;gap:14px}.sa-bars{display:grid;gap:10px}.sa-bar{display:grid;grid-template-columns:130px 1fr 70px;align-items:center;gap:10px;font-size:13px}.sa-bar-track{height:12px;border-radius:999px;background:#edf3f5;overflow:hidden}.sa-bar-fill{height:100%;border-radius:999px;background:#14b8a6}
      .sa-table-wrap{overflow:auto;border:1px solid #dbe5ea;border-radius:8px}.sa-table{width:100%;min-width:1180px;border-collapse:collapse}.sa-table th,.sa-table td{padding:10px;border-bottom:1px solid #dbe5ea;text-align:left;font-size:13px;white-space:nowrap}.sa-table th{background:#f8fbfc;color:#52616d;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
      .sa-company{display:grid;gap:3px}.sa-company strong{color:#17212b}.sa-company span{color:#657783;font-size:12px}.sa-logo{width:38px;height:38px;border-radius:8px;object-fit:cover;background:#e4f7f5;display:inline-grid;place-items:center;color:#0f766e;font-weight:950}
      .sa-status{display:inline-flex;justify-content:center;min-width:82px;padding:6px 9px;border-radius:999px;font-size:12px;font-weight:950}.sa-status.active{background:#dcfce7;color:#047857}.sa-status.trial{background:#e4f7f5;color:#0f766e}.sa-status.expired{background:#fee2e2;color:#dc2626}.sa-status.suspended{background:#0e1b22;color:#fff}.sa-status.deleted{background:#f3f4f6;color:#4b5563}
      .sa-filter{display:grid;grid-template-columns:1fr 180px auto;gap:10px;align-items:end}.sa-field{display:grid;gap:6px}.sa-field span{font-size:11px;color:#657783;font-weight:950;text-transform:uppercase;letter-spacing:.06em}.sa-field input,.sa-field select{min-height:40px;border:1px solid #dbe5ea;border-radius:8px;padding:9px;background:#fff}
      .sa-inline{display:flex;gap:7px;flex-wrap:wrap}.sa-mini{font-size:12px;min-height:32px;padding:0 9px;border-radius:8px;border:1px solid #dbe5ea;background:#fff;font-weight:850;cursor:pointer}.sa-mini.danger{border-color:#dc2626;color:#dc2626}
      .sa-alert{padding:12px;border-radius:8px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;display:grid;gap:6px}.sa-log{display:grid;gap:8px}.sa-log-item{padding:10px;border:1px solid #dbe5ea;border-radius:8px;background:#fff;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}
      .sa-modal{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:18px;background:rgba(14,27,34,.58);backdrop-filter:blur(6px)}.sa-modal-card{width:min(680px,100%);max-height:90vh;overflow:auto;border-radius:8px;background:#fff;border:1px solid #dbe5ea;padding:18px;display:grid;gap:12px}
      .sa-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.sa-full{grid-column:1/-1}.sa-warning{padding:11px;border-radius:8px;background:#fee2e2;color:#b91c1c;font-weight:900}
      @media(max-width:1050px){.sa-shell{grid-template-columns:1fr}.sa-side{position:relative;height:auto}.sa-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.sa-two{grid-template-columns:1fr}.sa-filter{grid-template-columns:1fr}}
      @media(max-width:640px){.sa-main{padding:14px}.sa-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sa-form-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function field(label, input, extraClass) {
    return `<label class="sa-field ${extraClass || ""}"><span>${esc(label)}</span>${input}</label>`;
  }

  function setupLogin(isReset) {
    return `
      <main class="sa-shell" style="grid-template-columns:1fr">
        <section style="min-height:100vh;display:grid;place-items:center;padding:18px">
          <div class="sa-modal-card">
            <div class="sa-brand" style="background:#0e1b22;border-radius:8px;padding:12px"><div class="sa-mark">SA</div><div><strong>${isReset ? "Reset Super Admin" : "Super Admin Setup"}</strong><span>Website owner panel</span></div></div>
            <p class="sa-sub">${isReset ? "Naya email/password set karo. Company data safe rahega." : "Pehli baar master owner login banao."}</p>
            ${notice ? `<div class="sa-note">${esc(notice)}</div>` : ""}
            <form class="sa-form-grid" data-sa-setup>
              ${field("Email", `<input name="email" type="email" required>`, "sa-full")}
              ${field("Password", `<input name="password" type="password" minlength="6" required>`)}
              ${field("Confirm Password", `<input name="confirm" type="password" minlength="6" required>`)}
              <div class="sa-actions sa-full">
                ${isReset ? `<button class="sa-ghost" type="button" data-sa-cancel-reset>Cancel</button>` : ""}
                <button class="sa-btn" type="submit">${isReset ? "Save New Login" : "Create Super Admin"}</button>
              </div>
            </form>
          </div>
        </section>
      </main>
    `;
  }

  function loginScreen() {
    return `
      <main class="sa-shell" style="grid-template-columns:1fr">
        <section style="min-height:100vh;display:grid;place-items:center;padding:18px">
          <div class="sa-modal-card">
            <div class="sa-brand" style="background:#0e1b22;border-radius:8px;padding:12px"><div class="sa-mark">SA</div><div><strong>Super Admin Login</strong><span>Master control center</span></div></div>
            ${notice ? `<div class="sa-note">${esc(notice)}</div>` : ""}
            <form class="sa-form-grid" data-sa-login>
              ${field("Email", `<input name="email" type="email" required>`, "sa-full")}
              ${field("Password", `<input name="password" type="password" required>`, "sa-full")}
              <button class="sa-btn sa-full" type="submit">Login Super Admin</button>
            </form>
            <button class="sa-ghost" type="button" data-sa-reset-login>Forgot / Reset Super Admin Login</button>
          </div>
        </section>
      </main>
    `;
  }

  function nav() {
    const items = [
      ["dashboard", "Dashboard"],
      ["companies", "Companies"],
      ["subscriptions", "Subscriptions"],
      ["alerts", "Duplicate Alerts"],
      ["logs", "Activity Logs"],
      ["backup", "Backup & Security"],
    ];
    return `<aside class="sa-side"><div class="sa-brand"><div class="sa-mark">GW</div><div><strong>Super Admin</strong><span>Website Owner Panel</span></div></div><nav class="sa-nav">${items
      .map(([id, label]) => `<button class="${section === id ? "active" : ""}" type="button" data-sa-section="${id}">${label}</button>`)
      .join("")}</nav><a href="/">Home Page</a><button class="sa-danger" type="button" data-sa-logout>Logout</button></aside>`;
  }

  function kpi(label, value) {
    return `<article class="sa-card sa-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
  }

  function dashboard() {
    const t = totals();
    const rows = summaries();
    const statusBars = ["Active", "Trial", "Expired", "Suspended"].map((name) => {
      const value = rows.filter((x) => x.status === name).length;
      const pct = t.total ? Math.round((value / t.total) * 100) : 0;
      return `<div class="sa-bar"><span>${name}</span><div class="sa-bar-track"><div class="sa-bar-fill" style="width:${pct}%"></div></div><strong>${value}</strong></div>`;
    });
    const recent = logs().slice(0, 6).map((log) => `<div class="sa-log-item"><strong>${esc(log.action)}</strong><span>${esc(log.company)} · ${esc(new Date(log.date).toLocaleString())}</span></div>`).join("") || `<p class="sa-sub">Abhi activity log empty hai.</p>`;
    return `
      <div class="sa-grid">
        ${kpi("Factory Codes", num(t.factoryCodes))}${kpi("Companies", num(t.total))}${kpi("Active", num(t.active))}${kpi("Trial", num(t.trial))}${kpi("Expired", num(t.expired))}${kpi("Suspended", num(t.suspended))}
        ${kpi("Deleted", num(t.deleted))}
        ${kpi("Duplicate Alerts", num(t.duplicates))}${kpi("Today's New", num(t.today))}${kpi("Monthly New", num(t.monthly))}${kpi("Total Revenue", money(t.revenue))}${kpi("Renewal Due", num(t.dueSoon))}${kpi("Storage", mb(t.storage))}
      </div>
      <div class="sa-two">
        <section class="sa-card sa-panel"><h2>Company Health</h2><div class="sa-bars">${statusBars.join("")}</div></section>
        <section class="sa-card sa-panel"><h2>System Health</h2><div class="sa-grid" style="grid-template-columns:repeat(2,1fr)">${kpi("Active Users", num(t.users))}${kpi("Online Users", num(t.devices))}${kpi("Production Entries", num(t.entries))}${kpi("Storage Used", mb(t.storage))}</div></section>
      </div>
      <section class="sa-card sa-panel"><h2>Recent Activities</h2><div class="sa-log">${recent}</div></section>
    `;
  }

  function companyTable() {
    const rows = filteredCompanies();
    const codeCount = factoryCodeCount(rows);
    return `
      <section class="sa-card sa-panel">
        <div class="sa-note">Total Factory Codes: ${num(codeCount)} · Showing Companies: ${num(rows.length)}</div>
        <div class="sa-filter">
          ${field("Search", `<input data-sa-filter="search" value="${esc(filters.search)}" placeholder="Name, owner, email, mobile, GST, PAN, plan...">`)}
          ${field("Status", `<select data-sa-filter="status"><option value="all">All</option>${["active", "trial", "expired", "suspended", "deleted"].map((s) => `<option value="${s}"${filters.status === s ? " selected" : ""}>${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select>`)}
          <button class="sa-ghost" type="button" data-sa-refresh>Refresh</button>
        </div>
        <div class="sa-table-wrap"><table class="sa-table"><thead><tr><th>Company</th><th>Owner</th><th>Business</th><th>Subscription</th><th>Usage</th><th>Actions</th></tr></thead><tbody>
          ${rows.map(companyRow).join("") || `<tr><td colspan="6">Company record nahi mila.</td></tr>`}
        </tbody></table></div>
      </section>
    `;
  }

  function companyRow(item) {
    const logo = item.logo ? `<img class="sa-logo" src="${esc(item.logo)}" alt="">` : `<span class="sa-logo">${esc(item.name.slice(0, 2).toUpperCase())}</span>`;
    return `<tr>
      <td><div class="sa-inline">${logo}<div class="sa-company"><strong>${esc(item.name)}</strong><span>Code: ${esc(item.code || item.id)}</span><span>Registered: ${esc(item.createdAt || "-")}</span></div></div></td>
      <td><div class="sa-company"><strong>${esc(item.owner)}</strong><span>${esc(item.email)}</span><span>${esc(item.mobile)}</span></div></td>
      <td><div class="sa-company"><strong>${esc(item.business)}</strong><span>GST: ${esc(item.gst || "-")}</span><span>PAN: ${esc(item.pan || "-")}</span></div></td>
      <td><div class="sa-company"><span class="sa-status ${lower(item.status)}">${esc(item.status)}</span><span>${esc(item.plan)} · ${money(item.amount)}</span><span>Expiry: ${esc(item.expiresAt || "-")}</span></div></td>
      <td><div class="sa-company"><strong>${num(item.staffCount + item.workerCount)} users</strong><span>${num(item.productCount)} products / ${num(item.entryCount)} entries</span><span>${mb(item.storage)} / ${num(item.activeDevices)} devices</span></div></td>
      <td><div class="sa-inline">
        <button class="sa-mini" data-sa-view="${esc(item.id)}">View</button>
        <button class="sa-mini" data-sa-edit="${esc(item.id)}">Edit</button>
        <button class="sa-mini" data-sa-reset-password="${esc(item.id)}">Reset Password</button>
        <button class="sa-mini" data-sa-impersonate="${esc(item.id)}">Login As</button>
        ${item.status === "Suspended" ? `<button class="sa-mini" data-sa-activate="${esc(item.id)}">Unsuspend</button>` : `<button class="sa-mini" data-sa-suspend="${esc(item.id)}">Suspend</button>`}
        <button class="sa-mini danger" data-sa-delete="${esc(item.id)}">Permanent Delete</button>
      </div></td>
    </tr>`;
  }

  function subscriptionManager() {
    const planRows = plans().map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.type)}</td><td>${num(p.durationDays)} days</td><td>${money(p.price)}</td><td>${p.active ? "Active" : "Inactive"}</td><td><button class="sa-mini" data-sa-plan-toggle="${esc(p.id)}">${p.active ? "Disable" : "Enable"}</button><button class="sa-mini danger" data-sa-plan-delete="${esc(p.id)}">Delete</button></td></tr>`).join("");
    return `<section class="sa-card sa-panel"><h2>Subscription Plans</h2><form class="sa-form-grid" data-sa-plan-form>${field("Plan Name", `<input name="name" required>`)}${field("Type", `<select name="type"><option>Trial</option><option>Monthly</option><option>Quarterly</option><option>Half-Yearly</option><option>Annual</option><option>Lifetime</option></select>`)}${field("Duration Days", `<input name="durationDays" type="number" min="1" value="30" required>`)}${field("Price", `<input name="price" type="number" min="0" value="0" required>`)}<button class="sa-btn sa-full" type="submit">Create Subscription Plan</button></form><div class="sa-table-wrap"><table class="sa-table" style="min-width:720px"><thead><tr><th>Plan</th><th>Type</th><th>Validity</th><th>Price</th><th>Status</th><th>Actions</th></tr></thead><tbody>${planRows}</tbody></table></div></section>${companyTable()}`;
  }

  function alertsView() {
    const alerts = duplicateAlerts();
    return `<section class="sa-card sa-panel"><h2>Duplicate Account Alerts</h2>${alerts.length ? alerts.map((a) => `<div class="sa-alert"><strong>${esc(a.label)} duplicate: ${esc(a.key)}</strong><span>${a.items.map((x) => `${x.name} (${x.code})`).join(" | ")}</span><div class="sa-inline">${a.items.map((x) => `<button class="sa-mini" data-sa-suspend="${esc(x.id)}">Suspend ${esc(x.code)}</button><button class="sa-mini danger" data-sa-delete="${esc(x.id)}">Delete ${esc(x.code)}</button>`).join("")}</div></div>`).join("") : `<p class="sa-sub">No duplicate account alert found.</p>`}</section>`;
  }

  function logsView() {
    const rows = logs();
    return `<section class="sa-card sa-panel"><h2>Activity Logs</h2><div class="sa-log">${rows.map((log) => `<div class="sa-log-item"><div><strong>${esc(log.action)}</strong><div class="sa-sub">${esc(log.company)} · Code ${esc(log.code)} · ${esc(log.superAdmin)}</div></div><span>${esc(new Date(log.date).toLocaleString())}</span></div>`).join("") || `<p class="sa-sub">Log empty hai.</p>`}</div></section>`;
  }

  function backupView() {
    return `<section class="sa-card sa-panel"><h2>Backup & Security</h2><p class="sa-sub">Backup local browser database ka JSON export deta hai. Production SaaS ke liye server database backup zaruri hoga.</p><div class="sa-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">${kpi("Session", "12 hours")}${kpi("Password Policy", "6+ chars")}${kpi("2FA", "Backend needed")}</div><div class="sa-actions"><button class="sa-btn" type="button" data-sa-backup>Download Full Backup</button><button class="sa-ghost" type="button" data-sa-clear-logs>Clear Logs</button></div></section>`;
  }

  function modalHtml() {
    if (!modal) return "";
    const item = modal.id ? summaries().find((x) => clean(x.id) === clean(modal.id) || clean(x.code) === clean(modal.id)) : null;
    if (modal.type === "view" && item) {
      return `<div class="sa-modal"><div class="sa-modal-card"><h2>${esc(item.name)}</h2><p class="sa-sub">Company detail, users, storage aur subscription summary.</p><div class="sa-grid" style="grid-template-columns:repeat(3,1fr)">${kpi("Users", num(item.staffCount + item.workerCount))}${kpi("Products", num(item.productCount))}${kpi("Storage", mb(item.storage))}</div><p><strong>Owner:</strong> ${esc(item.owner)} · ${esc(item.email)} · ${esc(item.mobile)}</p><p><strong>Business:</strong> ${esc(item.business)} · GST ${esc(item.gst || "-")} · PAN ${esc(item.pan || "-")}</p><p><strong>Subscription:</strong> ${esc(item.plan)} / ${esc(item.status)} / ${esc(item.expiresAt || "-")}</p><button class="sa-ghost" data-sa-close-modal>Close</button></div></div>`;
    }
    if (modal.type === "edit" && item) {
      return `<div class="sa-modal"><form class="sa-modal-card" data-sa-edit-form="${esc(item.id)}"><h2>Edit Company</h2><div class="sa-form-grid">${field("Company Name", `<input name="name" value="${esc(item.name)}" required>`)}${field("Owner Name", `<input name="owner" value="${esc(item.owner)}">`)}${field("Email", `<input name="email" value="${esc(item.email)}">`)}${field("Mobile", `<input name="mobile" value="${esc(item.mobile)}">`)}${field("GST Number", `<input name="gst" value="${esc(item.gst)}">`)}${field("PAN Number", `<input name="pan" value="${esc(item.pan)}">`)}${field("Business Type", `<input name="businessType" value="${esc(item.business)}">`)}${field("Active Devices", `<input name="activeDevices" type="number" min="0" value="${esc(item.activeDevices)}">`)}</div><div class="sa-actions"><button class="sa-ghost" type="button" data-sa-close-modal>Cancel</button><button class="sa-btn" type="submit">Save Company</button></div></form></div>`;
    }
    if (modal.type === "password" && item) {
      return `<div class="sa-modal"><form class="sa-modal-card" data-sa-password-form="${esc(item.id)}"><h2>Reset Admin Password</h2><p class="sa-sub">${esc(item.name)} ke admin password ko reset karo.</p>${field("New Password", `<input name="password" type="password" minlength="4" required>`)}<div class="sa-actions"><button class="sa-ghost" type="button" data-sa-close-modal>Cancel</button><button class="sa-btn" type="submit">Reset Password</button></div></form></div>`;
    }
    if (modal.type === "delete" && item) {
      return `<div class="sa-modal"><form class="sa-modal-card" data-sa-delete-form="${esc(item.id)}"><h2>Permanent Delete</h2><div class="sa-warning">This action cannot be undone. Company profile, employees, products, reports, sessions aur related local database records remove honge.</div><p>Confirm karne ke liye factory code type karo: <strong>${esc(item.code)}</strong></p>${field("Factory Code", `<input name="code" required>`)}<div class="sa-actions"><button class="sa-ghost" type="button" data-sa-close-modal>Cancel</button><button class="sa-danger" type="submit">Delete Forever</button></div></form></div>`;
    }
    return "";
  }

  function currentSection() {
    if (section === "companies") return companyTable();
    if (section === "subscriptions") return subscriptionManager();
    if (section === "alerts") return alertsView();
    if (section === "logs") return logsView();
    if (section === "backup") return backupView();
    return dashboard();
  }

  function renderApp() {
    if (!route()) return;
    window.__superAdminAdvancedActive = true;
    ensureStyle();
    document.body.classList.add("super-admin-advanced-body");
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (window.__saResetLogin) {
      root.innerHTML = setupLogin(true);
      return;
    }
    if (!credentials()) {
      root.innerHTML = setupLogin(false);
      return;
    }
    if (!sessionActive()) {
      root.innerHTML = loginScreen();
      return;
    }
    const t = totals();
    root.innerHTML = `<main class="sa-shell">${nav()}<section class="sa-main"><div class="sa-top"><div><h1>${section === "dashboard" ? "Super Admin Dashboard" : section[0].toUpperCase() + section.slice(1)}</h1><p>Companies, subscription, security aur platform control center.</p></div><div class="sa-actions"><span class="sa-note">System Health: OK · ${num(t.users)} users</span></div></div>${notice ? `<div class="sa-note">${esc(notice)}</div>` : ""}${currentSection()}</section>${modalHtml()}</main>`;
  }

  function userIsTyping() {
    const active = document.activeElement;
    if (!active) return false;
    const tag = String(active.tagName || "").toLowerCase();
    return tag === "input" || tag === "select" || tag === "textarea" || Boolean(active.closest?.("form"));
  }

  function renderWhenIdle() {
    if (!route()) return;
    if (userIsTyping()) return;
    renderApp();
  }

  function updateFactory(id, patch, action) {
    let changed = null;
    const rows = factories().map((row) => {
      if (clean(factoryId(row)) !== clean(id) && clean(factoryCode(row)) !== clean(id)) return row;
      changed = { ...row, ...patch, updatedAt: new Date().toISOString() };
      return changed;
    });
    saveFactories(rows);
    if (changed && action) addLog(action, changed);
  }

  function removeFactory(id, codeInput) {
    const item = summaries().find((x) => clean(x.id) === clean(id) || clean(x.code) === clean(id));
    if (!item) return "Company record nahi mila.";
    if (clean(codeInput) !== clean(item.code)) return "Factory code match nahi hua.";
    saveFactories(factories().filter((row) => clean(factoryId(row)) !== clean(item.id) && clean(factoryCode(row)) !== clean(item.code)));
    DB_BASE_KEYS.forEach((base) => {
      localStorage.removeItem(scopedKey(base, item.id));
      localStorage.removeItem(scopedKey(base, item.code));
    });
    SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
    if (clean(localStorage.getItem(ACTIVE_FACTORY_KEY)) === clean(item.id) || clean(localStorage.getItem(ACTIVE_FACTORY_KEY)) === clean(item.code)) localStorage.removeItem(ACTIVE_FACTORY_KEY);
    const deleted = deletedRows();
    deleted.unshift({ id: item.id, code: item.code, name: item.name, deletedAt: new Date().toISOString(), deletedBy: credentials()?.email || "super-admin" });
    writeJson(DELETED_KEY, deleted.slice(0, 500));
    addLog("Permanent Delete", item.raw, "All related local records removed");
    return "";
  }

  function downloadBackup() {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("garmentworks_")) data[key] = readJson(key, localStorage.getItem(key));
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `garmentworks-super-admin-backup-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog("Backup Downloaded", null);
  }

  document.addEventListener("submit", (event) => {
    if (!route()) return;
    const setup = event.target.closest("[data-sa-setup]");
    const login = event.target.closest("[data-sa-login]");
    const planForm = event.target.closest("[data-sa-plan-form]");
    const editForm = event.target.closest("[data-sa-edit-form]");
    const passwordForm = event.target.closest("[data-sa-password-form]");
    const deleteForm = event.target.closest("[data-sa-delete-form]");
    if (setup) {
      event.preventDefault();
      const data = new FormData(setup);
      const email = lower(data.get("email"));
      const password = norm(data.get("password"));
      if (!email || password.length < 6 || password !== norm(data.get("confirm"))) {
        notice = "Email aur matching 6+ character password required hai.";
        renderApp();
        return;
      }
      writeJson(SUPER_CREDENTIALS_KEY, { email, password, updatedAt: new Date().toISOString() });
      writeJson(SUPER_SESSION_KEY, { email, loginAt: Date.now() });
      window.__saResetLogin = false;
      addLog("Super Admin Login Updated", null);
      notice = "Super Admin login save ho gaya.";
      renderApp();
    } else if (login) {
      event.preventDefault();
      const data = new FormData(login);
      const saved = credentials();
      if (!saved || lower(data.get("email")) !== saved.email || norm(data.get("password")) !== saved.password) {
        notice = "Super Admin email ya password match nahi hua.";
        renderApp();
        return;
      }
      writeJson(SUPER_SESSION_KEY, { email: saved.email, loginAt: Date.now() });
      addLog("Super Admin Login", null);
      notice = "";
      renderApp();
    } else if (planForm) {
      event.preventDefault();
      const data = new FormData(planForm);
      const rows = plans();
      const row = { id: `plan_${Date.now()}`, name: norm(data.get("name")), type: norm(data.get("type")), durationDays: Number(data.get("durationDays")), price: Number(data.get("price")), active: true };
      writeJson(PLANS_KEY, [row, ...rows]);
      addLog("Subscription Plan Created", null, row.name);
      notice = "Subscription plan create ho gaya.";
      renderApp();
    } else if (editForm) {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(editForm).entries());
      updateFactory(editForm.dataset.saEditForm, data, "Company Updated");
      modal = null;
      notice = "Company update ho gayi.";
      renderApp();
    } else if (passwordForm) {
      event.preventDefault();
      const password = norm(new FormData(passwordForm).get("password"));
      const target = summaries().find((x) => clean(x.id) === clean(passwordForm.dataset.saPasswordForm));
      const staffKey = scopedKey("garmentworks_db_staff", target?.id);
      const staff = rowsFor("garmentworks_db_staff", target?.id).map((row) => lower(row.role) === "admin" ? { ...row, password } : row);
      writeJson(staffKey, staff);
      addLog("Password Reset", target?.raw);
      modal = null;
      notice = "Admin password reset ho gaya.";
      renderApp();
    } else if (deleteForm) {
      event.preventDefault();
      const err = removeFactory(deleteForm.dataset.saDeleteForm, new FormData(deleteForm).get("code"));
      modal = null;
      notice = err || "Company permanently delete ho gayi.";
      renderApp();
    }
  }, true);

  document.addEventListener("click", (event) => {
    if (!route()) return;
    const el = event.target.closest("button,a");
    if (!el) return;
    if (el.dataset.saSection) section = el.dataset.saSection;
    else if (el.dataset.saLogout !== undefined) localStorage.removeItem(SUPER_SESSION_KEY);
    else if (el.dataset.saResetLogin !== undefined) window.__saResetLogin = true;
    else if (el.dataset.saCancelReset !== undefined) window.__saResetLogin = false;
    else if (el.dataset.saRefresh !== undefined) notice = "Data refresh ho gaya.";
    else if (el.dataset.saView) modal = { type: "view", id: el.dataset.saView };
    else if (el.dataset.saEdit) modal = { type: "edit", id: el.dataset.saEdit };
    else if (el.dataset.saResetPassword) modal = { type: "password", id: el.dataset.saResetPassword };
    else if (el.dataset.saDelete) modal = { type: "delete", id: el.dataset.saDelete };
    else if (el.dataset.saCloseModal !== undefined) modal = null;
    else if (el.dataset.saSuspend) {
      updateFactory(el.dataset.saSuspend, { accountStatus: "Suspended", subscriptionStatus: "Suspended" }, "Company Suspended");
      notice = "Company suspend ho gayi.";
    } else if (el.dataset.saActivate) {
      updateFactory(el.dataset.saActivate, { accountStatus: "Active", subscriptionStatus: "Active" }, "Company Activated");
      notice = "Company active ho gayi.";
    } else if (el.dataset.saImpersonate) {
      const item = summaries().find((x) => clean(x.id) === clean(el.dataset.saImpersonate));
      if (item) {
        localStorage.setItem(ACTIVE_FACTORY_KEY, item.id);
        addLog("Login As Company", item.raw);
        notice = `Active factory ${item.code} set ho gaya. Admin portal open karo.`;
      }
    } else if (el.dataset.saPlanToggle) {
      writeJson(PLANS_KEY, plans().map((p) => p.id === el.dataset.saPlanToggle ? { ...p, active: !p.active } : p));
      addLog("Subscription Plan Status Changed", null);
    } else if (el.dataset.saPlanDelete) {
      writeJson(PLANS_KEY, plans().filter((p) => p.id !== el.dataset.saPlanDelete));
      addLog("Subscription Plan Deleted", null);
    } else if (el.dataset.saBackup !== undefined) {
      downloadBackup();
    } else if (el.dataset.saClearLogs !== undefined) {
      writeJson(LOGS_KEY, []);
      notice = "Activity logs clear ho gaye.";
    } else return;
    event.preventDefault();
    event.stopImmediatePropagation();
    renderApp();
  }, true);

  document.addEventListener("input", (event) => {
    if (!route()) return;
    const filter = event.target?.dataset?.saFilter;
    if (!filter) return;
    filters[filter] = event.target.value;
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(renderApp, 180);
  });

  document.addEventListener("change", (event) => {
    if (!route()) return;
    const filter = event.target?.dataset?.saFilter;
    if (!filter) return;
    filters[filter] = event.target.value;
    renderApp();
  });

  setTimeout(renderApp, 160);
  setInterval(renderWhenIdle, 2500);
})();

(function () {
  const STYLE_ID = "staff-privacy-fix-style";
  const SUMMARY_ID = "staff-privacy-summary";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const ADMIN_SESSION_KEY = "garmentworks_admin_session";
  const STAFF_KEY = "garmentworks_db_staff";
  const DEFAULT_FACTORY = "demo";
  const GRAPH_TITLES = ["Staff Status Graph", "Staff Role Graph", "Role Wise Salary Graph"];

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function activeFactoryId() {
    const session = readJson(ADMIN_SESSION_KEY, null);
    return String(session?.factoryId || window.localStorage.getItem(ACTIVE_FACTORY_KEY) || DEFAULT_FACTORY).trim() || DEFAULT_FACTORY;
  }

  function scopedKey(baseKey) {
    const factoryId = activeFactoryId();
    return factoryId === DEFAULT_FACTORY ? baseKey : `${baseKey}_${factoryId}`;
  }

  function isAdminStaff(row) {
    const role = String(row?.role || "").trim().toLowerCase();
    const portal = String(row?.portal || "").trim().toLowerCase();
    return role === "admin" || portal === "admin";
  }

  function readStaffRows() {
    const rows = readJson(scopedKey(STAFF_KEY), []);
    return Array.isArray(rows) ? rows : [];
  }

  function panelByHeading(title) {
    const wanted = title.toLowerCase();
    const heading = Array.from(document.querySelectorAll("h2")).find(
      (node) => node.textContent.trim().toLowerCase() === wanted
    );
    return heading?.closest("section, article, .panel") || heading?.parentElement || null;
  }

  function isStaffScreen() {
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return false;
    const heading = document.querySelector("main h1");
    return heading?.textContent.trim().toLowerCase() === "staff";
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .staff-privacy-original-hidden {
        display: none !important;
      }

      .staff-privacy-summary {
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid rgba(15, 118, 110, .18);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .11), rgba(255, 255, 255, .96)), #fff;
        box-shadow: 0 16px 36px rgba(14, 27, 34, .08);
      }

      .staff-privacy-summary-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 14px;
        flex-wrap: wrap;
      }

      .staff-privacy-summary h2 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 22px;
        line-height: 1.15;
      }

      .staff-privacy-summary p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
        line-height: 1.45;
      }

      .staff-privacy-lock {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 11px;
        border-radius: 8px;
        background: #0e1b22;
        color: #fff;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .04em;
        text-transform: uppercase;
      }

      .staff-privacy-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .staff-privacy-card {
        display: grid;
        gap: 6px;
        min-height: 86px;
        align-content: center;
        padding: 12px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: rgba(255, 255, 255, .86);
      }

      .staff-privacy-card span {
        color: var(--muted, #687683);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      .staff-privacy-card strong {
        color: var(--ink, #17212b);
        font-size: 22px;
        line-height: 1.1;
      }

      .staff-privacy-roles {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .staff-privacy-role {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-height: 34px;
        padding: 0 11px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: #fff;
        color: var(--ink, #17212b);
        font-size: 12px;
        font-weight: 900;
      }

      .staff-privacy-role b {
        color: var(--primary, #0f766e);
      }

      @media (max-width: 780px) {
        .staff-privacy-cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `;
    document.head.appendChild(style);
  }

  function formatMoney(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }

  function setNumericStrong(card, value) {
    const strong = Array.from(card.querySelectorAll("strong")).find((node) =>
      /^\s*[\d,]+\s*$/.test(node.textContent || "")
    );
    if (strong && strong.textContent.trim() !== String(value)) {
      strong.textContent = String(value);
      strong.dataset.staffPrivacyCorrected = "true";
    }
  }

  function correctGlobalStaffCounts() {
    const data = summaryData();
    document.querySelectorAll("article, .metric-card, .stat-card, .home-stat, .staff-privacy-card").forEach((card) => {
      const text = String(card.textContent || "").toLowerCase().replace(/\s+/g, " ").trim();
      if (!text || text.includes("admin hidden")) return;
      if (text.includes("active staff")) {
        setNumericStrong(card, data.active);
      } else if (text.includes("suspended staff") || text.includes("suspend staff")) {
        setNumericStrong(card, data.suspended);
      } else if (
        text.includes("staff users") ||
        text.includes("total staff") ||
        text.includes("staff count") ||
        text === "staff"
      ) {
        setNumericStrong(card, data.staffRows.length);
      }
    });
  }

  function hideAdminRows() {
    const listPanel = panelByHeading("Staff List");
    if (!listPanel) return;
    listPanel.querySelectorAll("tbody tr").forEach((row) => {
      const cells = Array.from(row.cells || []);
      const email = String(cells[2]?.textContent || "").trim().toLowerCase();
      const role = String(cells[3]?.textContent || "").trim().toLowerCase();
      const rowText = String(row.textContent || "").toLowerCase();
      const shouldHide = role === "admin" || rowText.includes("admin@") || email.includes("admin@");
      row.classList.toggle("staff-privacy-original-hidden", shouldHide);
      if (shouldHide) row.setAttribute("aria-hidden", "true");
    });
  }

  function hideOriginalGraphs() {
    GRAPH_TITLES.forEach((title) => {
      const panel = panelByHeading(title);
      if (panel) panel.classList.add("staff-privacy-original-hidden");
    });
  }

  function hideAdminRoleOptions() {
    document.querySelectorAll("select option").forEach((option) => {
      const text = String(option.textContent || option.value || "").trim().toLowerCase();
      if (text === "admin") {
        option.disabled = true;
        option.hidden = true;
      }
    });
  }

  function summaryData() {
    const staffRows = readStaffRows().filter((row) => !isAdminStaff(row));
    const active = staffRows.filter((row) => String(row.status || "Active").toLowerCase() !== "suspended").length;
    const suspended = staffRows.length - active;
    const salary = staffRows.reduce((total, row) => total + Number(row.monthlySalary || 0), 0);
    const roles = new Map();
    staffRows.forEach((row) => {
      const role = String(row.role || "Staff").trim() || "Staff";
      roles.set(role, (roles.get(role) || 0) + 1);
    });
    return { staffRows, active, suspended, salary, roles };
  }

  function renderSummary() {
    const listPanel = panelByHeading("Staff List");
    if (!listPanel) return;
    const data = summaryData();
    let summary = document.getElementById(SUMMARY_ID);
    if (!summary) {
      summary = document.createElement("section");
      summary.id = SUMMARY_ID;
      summary.className = "staff-privacy-summary";
      listPanel.insertAdjacentElement("beforebegin", summary);
    }
    const rolesHtml = Array.from(data.roles.entries())
      .map(([role, count]) => `<span class="staff-privacy-role">${escapeHtml(role)} <b>${count}</b></span>`)
      .join("");

    const nextHtml = `
      <div class="staff-privacy-summary-head">
        <div>
          <h2>Staff Privacy Summary</h2>
          <p>Admin profile staff list me show nahi hoga. Staff module me sirf staff/manager/data-entry users ka data dikhega.</p>
        </div>
        <span class="staff-privacy-lock">Admin hidden</span>
      </div>
      <div class="staff-privacy-cards">
        <div class="staff-privacy-card"><span>Total Staff</span><strong>${data.staffRows.length}</strong></div>
        <div class="staff-privacy-card"><span>Active Staff</span><strong>${data.active}</strong></div>
        <div class="staff-privacy-card"><span>Suspended</span><strong>${data.suspended}</strong></div>
        <div class="staff-privacy-card"><span>Salary Load</span><strong>${formatMoney(data.salary)}</strong></div>
      </div>
      <div class="staff-privacy-roles">${rolesHtml || '<span class="staff-privacy-role">No staff users <b>0</b></span>'}</div>
    `;
    if (summary.innerHTML !== nextHtml) summary.innerHTML = nextHtml;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function applyPrivacyFix() {
    ensureStyle();
    hideAdminRoleOptions();
    correctGlobalStaffCounts();

    if (!isStaffScreen()) {
      document.getElementById(SUMMARY_ID)?.remove();
      return;
    }
    hideOriginalGraphs();
    hideAdminRows();
    renderSummary();
    correctGlobalStaffCounts();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(applyPrivacyFix, 80);
  }

  document.addEventListener("click", schedule, true);
  window.addEventListener("storage", schedule);
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(schedule, 1200);
  schedule();
})();

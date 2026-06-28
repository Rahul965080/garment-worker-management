(function () {
  const DEFAULT_FACTORY = "demo";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const PANEL_ID = "history-module-fix-panel";
  const STYLE_ID = "history-module-fix-style";
  const DB_KEYS = {
    advances: "garmentworks_db_advances",
    completedPieceAllotments: "garmentworks_db_completed_piece_allotments",
    expenses: "garmentworks_db_expenses",
    payments: "garmentworks_db_payments",
    pieceAllotments: "garmentworks_db_piece_allotments",
    production: "garmentworks_db_production_entries",
    staff: "garmentworks_db_staff",
    staffPayments: "garmentworks_db_staff_payments",
    workers: "garmentworks_db_workers",
  };

  const filters = {
    from: "",
    to: "",
    type: "all",
    search: "",
  };
  let defaultsReady = false;
  let renderTimer = 0;

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function activeFactoryId() {
    return window.localStorage.getItem(ACTIVE_FACTORY_KEY) || DEFAULT_FACTORY;
  }

  function scopedKey(baseKey, factoryId = activeFactoryId()) {
    return factoryId === DEFAULT_FACTORY ? baseKey : `${baseKey}_${factoryId}`;
  }

  function readDb(name) {
    const rows = readJson(scopedKey(DB_KEYS[name]), []);
    return Array.isArray(rows) ? rows : [];
  }

  function money(value) {
    return `₹${new Intl.NumberFormat("en-IN").format(Math.round(Number(value) || 0))}`;
  }

  function number(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function todayIso() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function oneYearStartIso() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function historyPageOpen() {
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return false;
    const title = document.querySelector(".topbar h1")?.textContent?.trim() || "";
    return title === "History";
  }

  function readAllData() {
    return {
      advances: readDb("advances"),
      completedPieceAllotments: readDb("completedPieceAllotments"),
      expenses: readDb("expenses"),
      payments: readDb("payments"),
      pieceAllotments: readDb("pieceAllotments"),
      production: readDb("production"),
      staff: readDb("staff"),
      staffPayments: readDb("staffPayments"),
      workers: readDb("workers"),
    };
  }

  function makeMaps(data) {
    return {
      staff: new Map(data.staff.map((row) => [String(row.id), row])),
      workers: new Map(data.workers.map((row) => [String(row.id), row])),
    };
  }

  function ensureDefaults(data) {
    if (defaultsReady) return;
    const dates = allRows(data, makeMaps(data)).map((row) => row.date).filter(Boolean).sort();
    filters.from = dates[0] || oneYearStartIso();
    filters.to = dates.at(-1) || todayIso();
    defaultsReady = true;
  }

  function productionAmount(row) {
    return Number(row.rate || 0) * Number(row.pieces || 0);
  }

  function allRows(data, maps) {
    const rows = [];

    data.production.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Production Entry",
        person: maps.workers.get(String(row.workerId))?.name || "Unknown Worker",
        product: row.productCode || row.styleId || "No Product",
        work: row.productWork || "General",
        pieces: Number(row.pieces || 0),
        amount: productionAmount(row),
        enteredBy: row.enteredByStaffName || "Admin",
        details: row.status || "",
      });
    });

    data.pieceAllotments.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Pieces Allotment",
        person: maps.workers.get(String(row.workerId))?.name || "Unknown Worker",
        product: row.productCode || "No Product",
        work: row.productWork || "General",
        pieces: Number(row.pieces || 0),
        amount: 0,
        enteredBy: row.enteredByStaffName || "Admin",
        details: "Allotted",
      });
    });

    data.completedPieceAllotments.forEach((row) => {
      rows.push({
        date: String(row.completedAt || row.date || "").slice(0, 10),
        type: "Completed Allotment",
        person: maps.workers.get(String(row.workerId))?.name || "Unknown Worker",
        product: row.productCode || "No Product",
        work: row.productWork || "General",
        pieces: Number(row.completedEnteredPieces || row.completedAllottedPieces || 0),
        amount: 0,
        enteredBy: "System",
        details: `Completed cycles ${number(row.completedCycles || 1)}`,
      });
    });

    data.advances.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Advance",
        person: maps.workers.get(String(row.workerId))?.name || "Unknown Worker",
        product: "-",
        work: "-",
        pieces: 0,
        amount: -Math.abs(Number(row.amount || 0)),
        enteredBy: "Admin",
        details: row.remarks || "",
      });
    });

    data.payments.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Payment",
        person: maps.workers.get(String(row.workerId))?.name || "Unknown Worker",
        product: "-",
        work: "-",
        pieces: 0,
        amount: Number(row.amount || 0),
        enteredBy: "Admin",
        details: row.remarks || "",
      });
    });

    data.staffPayments.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Staff Payment",
        person: maps.staff.get(String(row.staffId))?.name || "Unknown Staff",
        product: "-",
        work: "-",
        pieces: 0,
        amount: Number(row.amount || 0),
        enteredBy: "Admin",
        details: row.remarks || "",
      });
    });

    data.expenses.forEach((row) => {
      rows.push({
        date: String(row.date || "").slice(0, 10),
        type: "Expense",
        person: row.expenseType || "Expense",
        product: "-",
        work: "-",
        pieces: 0,
        amount: -Math.abs(Number(row.amount || 0)),
        enteredBy: "Admin",
        details: row.remarks || "",
      });
    });

    return rows.filter((row) => row.date).sort((a, b) => b.date.localeCompare(a.date));
  }

  function filteredRows(rows) {
    const search = filters.search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filters.from && row.date < filters.from) return false;
      if (filters.to && row.date > filters.to) return false;
      if (filters.type !== "all" && row.type !== filters.type) return false;
      if (search) {
        const haystack = [row.date, row.type, row.person, row.product, row.work, row.enteredBy, row.details].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }

  function totals(rows) {
    return rows.reduce(
      (acc, row) => {
        acc.rows += 1;
        acc.pieces += Number(row.pieces || 0);
        acc.amount += Number(row.amount || 0);
        if (row.amount > 0) acc.income += Number(row.amount || 0);
        if (row.amount < 0) acc.outgoing += Math.abs(Number(row.amount || 0));
        acc.types.add(row.type);
        return acc;
      },
      { rows: 0, pieces: 0, amount: 0, income: 0, outgoing: 0, types: new Set() }
    );
  }

  function typeOptions(rows) {
    return ["all", ...Array.from(new Set(rows.map((row) => row.type))).sort()];
  }

  function typeClass(type) {
    const name = String(type || "").toLowerCase();
    if (name.includes("advance") || name.includes("expense")) return "negative";
    if (name.includes("payment") || name.includes("production")) return "positive";
    return "neutral";
  }

  function buildCsv(rows) {
    const columns = ["date", "type", "person", "product", "work", "pieces", "amount", "enteredBy", "details"];
    return [
      columns.map(csvEscape).join(","),
      ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
    ].join("\n");
  }

  function downloadCsv(rows) {
    const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `garmentworks-history-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .history-fix-panel {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: #fff;
        box-shadow: var(--shadow, 0 16px 40px rgba(15, 35, 45, .08));
      }
      .history-fix-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
      }
      .history-fix-head h2 {
        margin: 0;
        font-size: 18px;
      }
      .history-fix-head p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
      }
      .history-fix-filters {
        display: grid;
        grid-template-columns: repeat(4, minmax(140px, 1fr)) auto;
        gap: 10px;
        align-items: end;
      }
      .history-fix-field {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .history-fix-field span,
      .history-fix-kpis span {
        color: var(--muted, #687683);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .history-fix-download {
        min-height: 40px;
        border: 1px solid var(--primary, #0f766e);
        border-radius: 8px;
        background: var(--primary, #0f766e);
        color: #fff;
        font-size: 13px;
        font-weight: 900;
      }
      .history-fix-kpis {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 10px;
      }
      .history-fix-kpis article {
        display: grid;
        gap: 5px;
        min-height: 78px;
        align-content: center;
        padding: 12px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #f8fbfc;
        text-align: center;
      }
      .history-fix-kpis strong {
        color: var(--ink, #17212b);
        font-size: 18px;
      }
      .history-fix-kpis .positive strong { color: #059669; }
      .history-fix-kpis .negative strong { color: #dc2626; }
      .history-fix-table-wrap {
        width: 100%;
        overflow: auto;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
      }
      .history-fix-table {
        width: 100%;
        min-width: 980px;
        border-collapse: collapse;
      }
      .history-fix-table th,
      .history-fix-table td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--line, #dce5ea);
        text-align: left;
        white-space: nowrap;
        font-size: 13px;
      }
      .history-fix-table th {
        color: #52616d;
        background: #f8fbfc;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .history-fix-pill {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 26px;
        padding: 4px 8px;
        border-radius: 999px;
        background: #eef4f6;
        color: #334155;
        font-size: 12px;
        font-weight: 900;
      }
      .history-fix-pill.positive { background: #dcfce7; color: #059669; }
      .history-fix-pill.negative { background: #fee2e2; color: #dc2626; }
      .history-fix-money.positive { color: #059669; font-weight: 900; }
      .history-fix-money.negative { color: #dc2626; font-weight: 900; }
      .history-fix-empty {
        padding: 16px;
        border: 1px dashed rgba(15, 118, 110, .24);
        border-radius: 8px;
        background: #f8fbfc;
        color: var(--muted, #687683);
        text-align: center;
        font-size: 13px;
        font-weight: 800;
      }
      .history-fix-hidden-original {
        display: none !important;
      }
      @media (max-width: 980px) {
        .history-fix-filters,
        .history-fix-kpis {
          grid-template-columns: 1fr;
        }
        .history-fix-download {
          width: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function fieldHtml(label, inner) {
    return `<label class="history-fix-field"><span>${escapeHtml(label)}</span>${inner}</label>`;
  }

  function renderPanel() {
    if (!historyPageOpen()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    const data = readAllData();
    const maps = makeMaps(data);
    ensureDefaults(data);
    const rows = allRows(data, maps);
    const filtered = filteredRows(rows);
    const stats = totals(filtered);
    const limited = filtered.slice(0, 300);
    const options = typeOptions(rows);
    const signature = JSON.stringify({ filters, totalRows: rows.length, filteredRows: filtered.length, stats, limited });

    ensureStyle();
    let panel = document.getElementById(PANEL_ID);
    if (panel?.dataset.signature === signature) return;
    if (!panel) panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "history-fix-panel";
    panel.dataset.signature = signature;
    panel.innerHTML = `
      <div class="history-fix-head">
        <div>
          <h2>Working History Data</h2>
          <p>Production, allotment, finance, staff payment aur expenses ka proper fetched data.</p>
        </div>
      </div>
      <div class="history-fix-filters">
        ${fieldHtml("From Date", `<input type="date" data-history-filter="from" value="${escapeHtml(filters.from)}">`)}
        ${fieldHtml("To Date", `<input type="date" data-history-filter="to" value="${escapeHtml(filters.to)}">`)}
        ${fieldHtml(
          "Type",
          `<select data-history-filter="type">
            ${options.map((option) => `<option value="${escapeHtml(option)}"${filters.type === option ? " selected" : ""}>${escapeHtml(option === "all" ? "All Work" : option)}</option>`).join("")}
          </select>`
        )}
        ${fieldHtml("Search", `<input type="search" data-history-filter="search" value="${escapeHtml(filters.search)}" placeholder="Worker, staff, product, note...">`)}
        <button class="history-fix-download" type="button" data-history-download>Download CSV</button>
      </div>
      <div class="history-fix-kpis">
        <article><span>Total Rows</span><strong>${number(stats.rows)}</strong></article>
        <article><span>Total Pieces</span><strong>${number(stats.pieces)}</strong></article>
        <article class="positive"><span>Income</span><strong>${money(stats.income)}</strong></article>
        <article class="negative"><span>Outgoing</span><strong>-${money(stats.outgoing)}</strong></article>
        <article class="${stats.amount < 0 ? "negative" : "positive"}"><span>Net</span><strong>${stats.amount < 0 ? "-" : ""}${money(Math.abs(stats.amount))}</strong></article>
      </div>
      ${
        filtered.length
          ? `<div class="history-fix-table-wrap">
              <table class="history-fix-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Person</th>
                    <th>Product ID</th>
                    <th>Work</th>
                    <th>Pieces</th>
                    <th>Amount</th>
                    <th>Entered By</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${limited
                    .map(
                      (row) => `<tr>
                        <td>${escapeHtml(row.date)}</td>
                        <td><span class="history-fix-pill ${typeClass(row.type)}">${escapeHtml(row.type)}</span></td>
                        <td>${escapeHtml(row.person)}</td>
                        <td>${escapeHtml(row.product)}</td>
                        <td>${escapeHtml(row.work)}</td>
                        <td>${row.pieces ? number(row.pieces) : "-"}</td>
                        <td class="history-fix-money ${row.amount < 0 ? "negative" : row.amount > 0 ? "positive" : ""}">${row.amount ? `${row.amount < 0 ? "-" : ""}${money(Math.abs(row.amount))}` : "-"}</td>
                        <td>${escapeHtml(row.enteredBy)}</td>
                        <td>${escapeHtml(row.details)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
            ${filtered.length > limited.length ? `<div class="history-fix-empty">Screen par ${number(limited.length)} rows dikh rahe hain. CSV me full ${number(filtered.length)} rows milenge.</div>` : ""}`
          : `<div class="history-fix-empty">Is filter me history data nahi mila.</div>`
      }
    `;

    const layout = document.querySelector(".module-layout") || document.querySelector(".screen-grid") || document.querySelector(".workspace");
    const firstPanel = layout?.querySelector(":scope > .panel, :scope > .kpi-grid, :scope > .filter-bar");
    if (!panel.parentElement) {
      if (firstPanel) firstPanel.insertAdjacentElement("beforebegin", panel);
      else layout?.appendChild(panel);
    }
    hideOriginalHistory();
  }

  function hideOriginalHistory() {
    if (!historyPageOpen()) return;
    document.querySelectorAll(".module-layout > .panel, .module-layout > .kpi-grid, .module-layout > .filter-bar").forEach((element) => {
      if (element.id === PANEL_ID || element.classList.contains("history-fix-panel")) return;
      element.classList.add("history-fix-hidden-original");
    });
  }

  function setFilter(name, value) {
    filters[name] = value;
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.dataset.signature = "";
    scheduleRender();
  }

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const name = event.target?.dataset?.historyFilter;
      if (!name) return;
      setFilter(name, event.target.value);
    });
    document.addEventListener("change", (event) => {
      const name = event.target?.dataset?.historyFilter;
      if (!name) return;
      setFilter(name, event.target.value);
    });
    document.addEventListener("click", (event) => {
      if (!event.target?.closest?.("[data-history-download]")) return;
      const data = readAllData();
      const rows = filteredRows(allRows(data, makeMaps(data)));
      downloadCsv(rows);
    });
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, 100);
  }

  bindEvents();
  document.addEventListener("click", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(scheduleRender, 1800);
  scheduleRender();
})();

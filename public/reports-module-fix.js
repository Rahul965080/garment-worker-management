(function () {
  const DEFAULT_FACTORY = "demo";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const PANEL_ID = "reports-module-fix-panel";
  const STYLE_ID = "reports-module-fix-style";
  const CSV_BUTTON_TEXT = new Set(["export monthly", "daily report", "monthly report", "quarterly report", "yearly report"]);

  const DB_KEYS = {
    advances: "garmentworks_db_advances",
    expenses: "garmentworks_db_expenses",
    payments: "garmentworks_db_payments",
    products: "garmentworks_db_products",
    production: "garmentworks_db_production_entries",
    staff: "garmentworks_db_staff",
    staffPayments: "garmentworks_db_staff_payments",
    workers: "garmentworks_db_workers",
  };

  const filters = {
    from: "",
    to: "",
    type: "production",
    workerId: "all",
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

  function monthStartIso(dateText = todayIso()) {
    return `${String(dateText).slice(0, 7)}-01`;
  }

  function reportPageOpen() {
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return false;
    const title = document.querySelector(".topbar h1")?.textContent?.trim() || "";
    return title === "Reports";
  }

  function ensureDefaults() {
    if (defaultsReady) return;
    const production = readDb("production");
    const dates = production.map((entry) => String(entry.date || "").slice(0, 10)).filter(Boolean).sort();
    filters.from = dates[0] ? `${dates[0].slice(0, 7)}-01` : monthStartIso();
    filters.to = dates.at(-1) || todayIso();
    defaultsReady = true;
  }

  function makeMaps(data) {
    return {
      workers: new Map(data.workers.map((worker) => [String(worker.id), worker])),
      staff: new Map(data.staff.map((member) => [String(member.id), member])),
      products: new Map(data.products.map((product) => [String(product.productCode || product.styleId || product.id), product])),
    };
  }

  function inDateRange(dateValue) {
    const date = String(dateValue || "").slice(0, 10);
    if (!date) return false;
    if (filters.from && date < filters.from) return false;
    if (filters.to && date > filters.to) return false;
    return true;
  }

  function matchesSearch(row) {
    const query = filters.search.trim().toLowerCase();
    if (!query) return true;
    return Object.values(row).some((value) => String(value ?? "").toLowerCase().includes(query));
  }

  function productCode(entry) {
    return entry.productCode || entry.styleName || entry.styleId || "No Product";
  }

  function productionAmount(entry) {
    return Number(entry.rate || 0) * Number(entry.pieces || 0);
  }

  function readAllData() {
    return {
      advances: readDb("advances"),
      expenses: readDb("expenses"),
      payments: readDb("payments"),
      products: readDb("products"),
      production: readDb("production"),
      staff: readDb("staff"),
      staffPayments: readDb("staffPayments"),
      workers: readDb("workers"),
    };
  }

  function productionRows(data, maps) {
    return data.production.map((entry) => {
      const worker = maps.workers.get(String(entry.workerId));
      const product = maps.products.get(String(productCode(entry)));
      return {
        date: String(entry.date || "").slice(0, 10),
        staff: entry.enteredByStaffName || "Admin",
        workerId: String(entry.workerId || ""),
        worker: worker?.name || "Unknown",
        product: productCode(entry),
        color: product?.color || "",
        size: product?.size || "",
        work: entry.productWork || entry.work || "General",
        style_id: entry.styleId || productCode(entry),
        rate: Number(entry.rate || 0),
        pieces: Number(entry.pieces || 0),
        amount: productionAmount(entry),
        status: entry.status || "Pending",
      };
    });
  }

  function advanceRows(data, maps) {
    return data.advances.map((entry) => ({
      date: String(entry.date || "").slice(0, 10),
      workerId: String(entry.workerId || ""),
      worker: maps.workers.get(String(entry.workerId))?.name || "Unknown",
      amount: Number(entry.amount || 0),
      remarks: entry.remarks || "",
    }));
  }

  function paymentRows(data, maps) {
    return data.payments.map((entry) => ({
      date: String(entry.date || "").slice(0, 10),
      workerId: String(entry.workerId || ""),
      worker: maps.workers.get(String(entry.workerId))?.name || "Unknown",
      amount: Number(entry.amount || 0),
      remarks: entry.remarks || "",
    }));
  }

  function staffPaymentRows(data, maps) {
    return data.staffPayments.map((entry) => ({
      date: String(entry.date || "").slice(0, 10),
      staff: maps.staff.get(String(entry.staffId))?.name || "Unknown",
      amount: Number(entry.amount || 0),
      remarks: entry.remarks || "",
    }));
  }

  function expenseRows(data) {
    return data.expenses.map((entry) => ({
      date: String(entry.date || "").slice(0, 10),
      type: entry.expenseType || "Expense",
      amount: Number(entry.amount || 0),
      remarks: entry.remarks || "",
    }));
  }

  function filteredBaseRows(rows) {
    return rows
      .filter((row) => inDateRange(row.date))
      .filter((row) => filters.workerId === "all" || String(row.workerId || "") === String(filters.workerId))
      .filter(matchesSearch);
  }

  function groupedRows(type, data, maps) {
    const production = filteredBaseRows(productionRows(data, maps));
    if (type === "production") return production;

    if (type === "advances") return filteredBaseRows(advanceRows(data, maps));
    if (type === "payments") return filteredBaseRows(paymentRows(data, maps));
    if (type === "staffPayments") return filteredBaseRows(staffPaymentRows(data, maps));
    if (type === "expenses") return filteredBaseRows(expenseRows(data));

    if (type === "workerSummary") {
      const advances = filteredBaseRows(advanceRows(data, maps));
      const payments = filteredBaseRows(paymentRows(data, maps));
      const groups = new Map();
      data.workers.forEach((worker) => {
        if (filters.workerId !== "all" && String(worker.id) !== String(filters.workerId)) return;
        groups.set(String(worker.id), {
          workerId: String(worker.id),
          worker: worker.name,
          work_type: worker.type || worker.workType || "",
          entries: 0,
          pieces: 0,
          production_amount: 0,
          advance: 0,
          payment: 0,
          final_amount: 0,
        });
      });
      production.forEach((row) => {
        const item = groups.get(String(row.workerId));
        if (!item) return;
        item.entries += 1;
        item.pieces += Number(row.pieces || 0);
        item.production_amount += Number(row.amount || 0);
      });
      advances.forEach((row) => {
        const item = groups.get(String(row.workerId));
        if (item) item.advance += Number(row.amount || 0);
      });
      payments.forEach((row) => {
        const item = groups.get(String(row.workerId));
        if (item) item.payment += Number(row.amount || 0);
      });
      groups.forEach((item) => {
        item.final_amount = item.production_amount - item.advance - item.payment;
      });
      return Array.from(groups.values()).filter((row) => matchesSearch(row));
    }

    if (type === "productSummary") {
      const groups = new Map();
      production.forEach((row) => {
        const key = row.product || row.style_id || "No Product";
        const item = groups.get(key) || {
          product: key,
          styles: new Set(),
          works: new Set(),
          entries: 0,
          pieces: 0,
          amount: 0,
        };
        item.styles.add(row.style_id || key);
        item.works.add(row.work || "General");
        item.entries += 1;
        item.pieces += Number(row.pieces || 0);
        item.amount += Number(row.amount || 0);
        groups.set(key, item);
      });
      return Array.from(groups.values())
        .map((item) => ({
          product: item.product,
          styles: item.styles.size,
          works: Array.from(item.works).join(", "),
          entries: item.entries,
          pieces: item.pieces,
          amount: item.amount,
        }))
        .filter(matchesSearch);
    }

    return production;
  }

  function currentRows(data, maps) {
    return groupedRows(filters.type, data, maps);
  }

  function groupTop(rows, keyFn, valueFn, limit = 8) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = keyFn(row) || "Unknown";
      groups.set(key, (groups.get(key) || 0) + Number(valueFn(row) || 0));
    });
    return Array.from(groups, ([label, value]) => ({ label, value }))
      .filter((item) => item.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, limit);
  }

  function chartForRows(rows, type) {
    if (type === "production") {
      return {
        title: "Production Pieces Graph",
        description: "Selected date/worker ke hisab se worker wise pieces.",
        unit: "pcs",
        bars: groupTop(rows, (row) => row.worker, (row) => row.pieces),
      };
    }
    if (type === "workerSummary") {
      return {
        title: "Worker Balance Graph",
        description: "Worker wise final amount. Red ka matlab recovery/advance side.",
        unit: "amount",
        bars: groupTop(rows, (row) => row.worker, (row) => row.final_amount),
      };
    }
    if (type === "productSummary") {
      return {
        title: "Product Pieces Graph",
        description: "Product/style wise total pieces.",
        unit: "pcs",
        bars: groupTop(rows, (row) => row.product, (row) => row.pieces),
      };
    }
    if (type === "advances") {
      return {
        title: "Advance Graph",
        description: "Selected filter ke hisab se worker advance.",
        unit: "amount",
        bars: groupTop(rows, (row) => row.worker, (row) => row.amount),
      };
    }
    if (type === "payments") {
      return {
        title: "Payment Graph",
        description: "Selected filter ke hisab se worker payment.",
        unit: "amount",
        bars: groupTop(rows, (row) => row.worker, (row) => row.amount),
      };
    }
    if (type === "staffPayments") {
      return {
        title: "Staff Payment Graph",
        description: "Staff wise payment amount.",
        unit: "amount",
        bars: groupTop(rows, (row) => row.staff, (row) => row.amount),
      };
    }
    if (type === "expenses") {
      return {
        title: "Expense Graph",
        description: "Expense type wise amount.",
        unit: "amount",
        bars: groupTop(rows, (row) => row.type, (row) => row.amount),
      };
    }
    return {
      title: "Report Graph",
      description: "Selected report ka graph.",
      unit: "amount",
      bars: groupTop(rows, (row) => row.date, (row) => row.amount || row.pieces),
    };
  }

  function graphValue(value, unit) {
    return unit === "amount" ? money(value) : number(value);
  }

  function graphHtml(chart) {
    const max = Math.max(...chart.bars.map((bar) => Math.abs(Number(bar.value || 0))), 1);
    return `
      <section class="reports-fix-graph">
        <div class="reports-fix-graph-head">
          <div>
            <h3>${escapeHtml(chart.title)}</h3>
            <p>${escapeHtml(chart.description)}</p>
          </div>
          <strong>${escapeHtml(number(chart.bars.length))} groups</strong>
        </div>
        ${
          chart.bars.length
            ? `<div class="reports-fix-bars">
                ${chart.bars
                  .map((bar) => {
                    const value = Number(bar.value || 0);
                    const width = Math.max(Math.abs(value) / max * 100, 6);
                    return `<div class="reports-fix-bar-row">
                      <span title="${escapeHtml(bar.label)}">${escapeHtml(bar.label)}</span>
                      <div class="reports-fix-bar-track">
                        <b class="${value < 0 ? "negative" : "positive"}" style="width:${width}%"></b>
                      </div>
                      <strong class="${value < 0 ? "negative" : "positive"}">${value < 0 ? "-" : ""}${escapeHtml(graphValue(Math.abs(value), chart.unit))}</strong>
                    </div>`;
                  })
                  .join("")}
              </div>`
            : `<div class="reports-fix-empty">Is select/filter ke hisab se graph data nahi mila.</div>`
        }
      </section>
    `;
  }

  function summary(data, maps) {
    const production = filteredBaseRows(productionRows(data, maps));
    const advances = filteredBaseRows(advanceRows(data, maps));
    const payments = filteredBaseRows(paymentRows(data, maps));
    const staffPayments = filteredBaseRows(staffPaymentRows(data, maps));
    const expenses = filteredBaseRows(expenseRows(data));
    const productionAmountTotal = production.reduce((total, row) => total + Number(row.amount || 0), 0);
    const advanceTotal = advances.reduce((total, row) => total + Number(row.amount || 0), 0);
    const paymentTotal = payments.reduce((total, row) => total + Number(row.amount || 0), 0);
    const staffPaymentTotal = staffPayments.reduce((total, row) => total + Number(row.amount || 0), 0);
    const expenseTotal = expenses.reduce((total, row) => total + Number(row.amount || 0), 0);
    return {
      pieces: production.reduce((total, row) => total + Number(row.pieces || 0), 0),
      styles: new Set(production.map((row) => row.product)).size,
      productionAmount: productionAmountTotal,
      advance: advanceTotal,
      payment: paymentTotal + staffPaymentTotal,
      expense: expenseTotal,
      net: productionAmountTotal - advanceTotal - paymentTotal - staffPaymentTotal - expenseTotal,
    };
  }

  function columnsForType(type) {
    const columns = {
      production: ["date", "staff", "worker", "product", "work", "style_id", "rate", "pieces", "amount", "status"],
      advances: ["date", "worker", "amount", "remarks"],
      payments: ["date", "worker", "amount", "remarks"],
      staffPayments: ["date", "staff", "amount", "remarks"],
      expenses: ["date", "type", "amount", "remarks"],
      workerSummary: ["worker", "work_type", "entries", "pieces", "production_amount", "advance", "payment", "final_amount"],
      productSummary: ["product", "styles", "works", "entries", "pieces", "amount"],
    };
    return columns[type] || columns.production;
  }

  function labelForColumn(column) {
    return column.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatCell(column, value) {
    if (["amount", "production_amount", "advance", "payment", "final_amount", "rate"].includes(column)) return money(value);
    if (["pieces", "entries", "styles"].includes(column)) return number(value);
    return value ?? "";
  }

  function amountClass(column, value) {
    if (!["amount", "production_amount", "advance", "payment", "final_amount", "rate"].includes(column)) return "";
    if (column === "advance" || Number(value) < 0) return " negative";
    if (column === "payment" || Number(value) > 0) return " positive";
    return "";
  }

  function buildCsv(rows, columns) {
    return [
      columns.map(labelForColumn).map(csvEscape).join(","),
      ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
    ].join("\n");
  }

  function downloadCurrentCsv() {
    if (!reportPageOpen()) return;
    const data = readAllData();
    const maps = makeMaps(data);
    const rows = currentRows(data, maps);
    const columns = columnsForType(filters.type);
    const csv = buildCsv(rows, columns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = URL.createObjectURL(blob);
    link.download = `garmentworks-${filters.type}-report-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    showToast(`CSV report download ho gaya (${number(rows.length)} rows)`);
  }

  function showToast(message) {
    const old = document.querySelector(".reports-fix-toast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.className = "reports-fix-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2400);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .reports-fix-panel {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: #fff;
        box-shadow: var(--shadow, 0 16px 40px rgba(15, 35, 45, .08));
      }
      .reports-fix-head {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 12px;
        flex-wrap: wrap;
      }
      .reports-fix-head h2 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 18px;
      }
      .reports-fix-head p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
      }
      .reports-fix-filters {
        display: grid;
        grid-template-columns: repeat(5, minmax(140px, 1fr)) auto;
        gap: 10px;
        align-items: end;
      }
      .reports-fix-field {
        display: grid;
        gap: 6px;
        min-width: 0;
      }
      .reports-fix-field span {
        color: var(--muted, #687683);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .reports-fix-download {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid var(--primary, #0f766e);
        border-radius: 8px;
        background: var(--primary, #0f766e);
        color: #fff;
        font-size: 13px;
        font-weight: 900;
        white-space: nowrap;
      }
      .reports-fix-cards {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
      }
      .reports-fix-cards article {
        display: grid;
        gap: 5px;
        min-height: 82px;
        align-content: center;
        padding: 12px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #f8fbfc;
        text-align: center;
      }
      .reports-fix-cards span {
        color: var(--muted, #687683);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .reports-fix-cards strong {
        color: var(--ink, #17212b);
        font-size: 18px;
        line-height: 1.15;
      }
      .reports-fix-cards .positive strong { color: #059669; }
      .reports-fix-cards .negative strong { color: #dc2626; }
      .reports-fix-graph {
        display: grid;
        gap: 12px;
        padding: 14px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .07), #fff 55%);
      }
      .reports-fix-graph-head {
        display: flex;
        align-items: start;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }
      .reports-fix-graph-head h3 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 16px;
      }
      .reports-fix-graph-head p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
      }
      .reports-fix-graph-head strong {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 0 10px;
        border-radius: 8px;
        background: var(--primary-soft, #e4f7f5);
        color: var(--primary, #0f766e);
        font-size: 12px;
      }
      .reports-fix-bars {
        display: grid;
        gap: 10px;
      }
      .reports-fix-bar-row {
        display: grid;
        grid-template-columns: minmax(120px, 180px) minmax(140px, 1fr) minmax(90px, auto);
        gap: 10px;
        align-items: center;
      }
      .reports-fix-bar-row span {
        min-width: 0;
        overflow: hidden;
        color: #34424d;
        font-size: 12px;
        font-weight: 900;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .reports-fix-bar-track {
        height: 14px;
        overflow: hidden;
        border-radius: 999px;
        background: #e8eef2;
      }
      .reports-fix-bar-track b {
        display: block;
        height: 100%;
        border-radius: inherit;
        transition: width .18s ease;
      }
      .reports-fix-bar-track b.positive {
        background: linear-gradient(90deg, #14b8a6, #0f766e);
      }
      .reports-fix-bar-track b.negative {
        background: linear-gradient(90deg, #fb7185, #dc2626);
      }
      .reports-fix-bar-row strong {
        display: inline-flex;
        justify-content: center;
        min-width: 86px;
        padding: 5px 8px;
        border-radius: 8px;
        background: #fff;
        font-size: 12px;
      }
      .reports-fix-bar-row strong.positive {
        color: #059669;
      }
      .reports-fix-bar-row strong.negative {
        color: #dc2626;
      }
      .reports-fix-table-wrap {
        width: 100%;
        overflow: auto;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
      }
      .reports-fix-table {
        width: 100%;
        min-width: 920px;
        border-collapse: collapse;
      }
      .reports-fix-table th,
      .reports-fix-table td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--line, #dce5ea);
        text-align: left;
        white-space: nowrap;
        font-size: 13px;
      }
      .reports-fix-table th {
        color: #52616d;
        background: #f8fbfc;
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .reports-fix-table tr:last-child td {
        border-bottom: 0;
      }
      .reports-fix-table .positive {
        color: #059669;
        font-weight: 900;
      }
      .reports-fix-table .negative {
        color: #dc2626;
        font-weight: 900;
      }
      .reports-fix-empty {
        padding: 18px;
        border: 1px dashed rgba(15, 118, 110, .24);
        border-radius: 8px;
        background: #f8fbfc;
        color: var(--muted, #687683);
        text-align: center;
        font-size: 13px;
        font-weight: 800;
      }
      .reports-fix-toast {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 9999;
        max-width: min(360px, calc(100vw - 36px));
        padding: 12px 14px;
        border-radius: 8px;
        background: #0e1b22;
        color: #fff;
        box-shadow: 0 18px 40px rgba(14, 27, 34, .24);
        font-size: 13px;
        font-weight: 900;
      }
      .reports-fix-hidden-original {
        display: none !important;
      }
      @media (max-width: 1100px) {
        .reports-fix-filters,
        .reports-fix-cards {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .reports-fix-download {
          grid-column: 1 / -1;
        }
      }
      @media (max-width: 720px) {
        .reports-fix-filters,
        .reports-fix-cards {
          grid-template-columns: 1fr;
        }
        .reports-fix-bar-row {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function fieldHtml(label, inner) {
    return `<label class="reports-fix-field"><span>${escapeHtml(label)}</span>${inner}</label>`;
  }

  function renderPanel() {
    if (!reportPageOpen()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    ensureDefaults();
    ensureStyle();

    const data = readAllData();
    const maps = makeMaps(data);
    const rows = currentRows(data, maps);
    const totals = summary(data, maps);
    const columns = columnsForType(filters.type);
    const limitedRows = rows.slice(0, 200);
    const chart = chartForRows(rows, filters.type);
    const signature = JSON.stringify({ filters, rows: rows.length, totals, chart, limitedRows });
    let panel = document.getElementById(PANEL_ID);
    if (panel?.dataset.signature === signature) return;

    if (!panel) panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "reports-fix-panel";
    panel.dataset.signature = signature;

    panel.innerHTML = `
      <div class="reports-fix-head">
        <div>
          <h2>Working Reports</h2>
          <p>Factory data ko filter karo, table me verify karo aur CSV download karo.</p>
        </div>
      </div>
      <div class="reports-fix-filters">
        ${fieldHtml("From Date", `<input type="date" data-report-filter="from" value="${escapeHtml(filters.from)}">`)}
        ${fieldHtml("To Date", `<input type="date" data-report-filter="to" value="${escapeHtml(filters.to)}">`)}
        ${fieldHtml(
          "Report Type",
          `<select data-report-filter="type">
            <option value="production"${filters.type === "production" ? " selected" : ""}>Production</option>
            <option value="workerSummary"${filters.type === "workerSummary" ? " selected" : ""}>Worker Summary</option>
            <option value="productSummary"${filters.type === "productSummary" ? " selected" : ""}>Product Summary</option>
            <option value="advances"${filters.type === "advances" ? " selected" : ""}>Advances</option>
            <option value="payments"${filters.type === "payments" ? " selected" : ""}>Payments</option>
            <option value="staffPayments"${filters.type === "staffPayments" ? " selected" : ""}>Staff Payments</option>
            <option value="expenses"${filters.type === "expenses" ? " selected" : ""}>Expenses</option>
          </select>`
        )}
        ${fieldHtml(
          "Worker",
          `<select data-report-filter="workerId">
            <option value="all">All workers</option>
            ${data.workers
              .map((worker) => `<option value="${escapeHtml(worker.id)}"${String(filters.workerId) === String(worker.id) ? " selected" : ""}>${escapeHtml(worker.name)}</option>`)
              .join("")}
          </select>`
        )}
        ${fieldHtml("Search", `<input type="search" data-report-filter="search" value="${escapeHtml(filters.search)}" placeholder="Product, worker, staff...">`)}
        <button class="reports-fix-download" type="button" data-report-download>Download CSV</button>
      </div>
      <div class="reports-fix-cards">
        <article><span>Total Pieces</span><strong>${number(totals.pieces)}</strong></article>
        <article><span>Total Styles</span><strong>${number(totals.styles)}</strong></article>
        <article class="positive"><span>Production</span><strong>${money(totals.productionAmount)}</strong></article>
        <article class="negative"><span>Advance</span><strong>-${money(totals.advance)}</strong></article>
        <article class="positive"><span>Payments</span><strong>${money(totals.payment)}</strong></article>
        <article class="${totals.net < 0 ? "negative" : "positive"}"><span>Net Balance</span><strong>${totals.net < 0 ? "-" : ""}${money(Math.abs(totals.net))}</strong></article>
      </div>
      ${graphHtml(chart)}
      ${
        rows.length
          ? `<div class="reports-fix-table-wrap">
              <table class="reports-fix-table">
                <thead>
                  <tr>${columns.map((column) => `<th>${escapeHtml(labelForColumn(column))}</th>`).join("")}</tr>
                </thead>
                <tbody>
                  ${limitedRows
                    .map(
                      (row) => `<tr>${columns
                        .map((column) => `<td class="${amountClass(column, row[column])}">${escapeHtml(formatCell(column, row[column]))}</td>`)
                        .join("")}</tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
            ${rows.length > limitedRows.length ? `<div class="reports-fix-empty">Screen par pehle ${number(limitedRows.length)} rows dikh rahe hain. CSV me full ${number(rows.length)} rows milenge.</div>` : ""}`
          : `<div class="reports-fix-empty">Is filter me abhi report data nahi mila.</div>`
      }
    `;

    const layout = document.querySelector(".module-layout") || document.querySelector(".screen-grid") || document.querySelector(".workspace");
    const firstPanel = layout?.querySelector(":scope > .panel");
    if (!panel.parentElement) {
      if (firstPanel) firstPanel.insertAdjacentElement("beforebegin", panel);
      else layout?.appendChild(panel);
    }
    hideOriginalStaticReports();
  }

  function hideOriginalStaticReports() {
    if (!reportPageOpen()) return;
    document.querySelectorAll(".module-layout > .panel, .screen-grid > .panel").forEach((panel) => {
      if (panel.id === PANEL_ID || panel.classList.contains("reports-fix-panel")) return;
      const text = panel.innerText || "";
      if (/Reports Module|Worker Wise Production|Style Wise Production|Total Pieces|Total Amount/i.test(text)) {
        panel.classList.add("reports-fix-hidden-original");
      }
    });
  }

  function setFilter(name, value) {
    filters[name] = value;
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.dataset.signature = "";
    scheduleRender();
  }

  function isReportExportControl(element) {
    const button = element?.closest?.("button");
    if (!button || document.getElementById(PANEL_ID)?.contains(button)) return false;
    const text = (button.innerText || button.textContent || "").trim().toLowerCase();
    return reportPageOpen() && CSV_BUTTON_TEXT.has(text);
  }

  function bindEvents() {
    document.addEventListener("input", (event) => {
      const name = event.target?.dataset?.reportFilter;
      if (!name) return;
      setFilter(name, event.target.value);
    });
    document.addEventListener("change", (event) => {
      const name = event.target?.dataset?.reportFilter;
      if (!name) return;
      setFilter(name, event.target.value);
    });
    document.addEventListener(
      "click",
      (event) => {
        if (event.target?.closest?.("[data-report-download]")) {
          event.preventDefault();
          downloadCurrentCsv();
          return;
        }
        if (isReportExportControl(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          downloadCurrentCsv();
        }
      },
      true
    );
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, 80);
  }

  bindEvents();
  document.addEventListener("click", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(scheduleRender, 1800);
  scheduleRender();
})();

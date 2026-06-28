(function () {
  const DEFAULT_FACTORY = "demo";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const DB_KEYS = {
    production: "garmentworks_db_production_entries",
    workers: "garmentworks_db_workers",
  };
  const BOX_ID = "worker-ledger-style-summary";
  const STYLE_ID = "worker-ledger-style-summary-style";

  let chosenDate = "";
  let lastWorkerKey = "";

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

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function todayIso() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function getLedgerRoot() {
    const pageTitle = document.querySelector(".topbar h1")?.textContent || "";
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return null;
    if (!pageTitle.includes("Worker Ledger") && !document.body.innerText.includes("Worker Ledger")) return null;
    return document.querySelector(".ledger-screen");
  }

  function selectedWorker() {
    const ledger = getLedgerRoot();
    if (!ledger) return null;
    const select = ledger.querySelector("select");
    const workers = readDb("workers");
    if (!select) return workers[0] || null;
    const value = String(select.value || "").trim();
    const label = select.selectedOptions?.[0]?.textContent?.trim().toLowerCase() || "";
    return (
      workers.find((worker) => String(worker.id) === value) ||
      workers.find((worker) => String(worker.workerId || "").toLowerCase() === value.toLowerCase()) ||
      workers.find((worker) => String(worker.name || "").trim().toLowerCase() === label) ||
      null
    );
  }

  function matchesWorker(entry, worker) {
    if (!entry || !worker) return false;
    const entryWorkerId = String(entry.workerId ?? "").trim();
    return (
      entryWorkerId === String(worker.id ?? "").trim() ||
      entryWorkerId.toLowerCase() === String(worker.workerId ?? "").trim().toLowerCase() ||
      entryWorkerId === String(worker.mobile ?? "").trim()
    );
  }

  function availableDates(entries, worker) {
    return Array.from(
      new Set(
        entries
          .filter((entry) => matchesWorker(entry, worker))
          .map((entry) => String(entry.date || "").slice(0, 10))
          .filter(Boolean)
      )
    ).sort();
  }

  function groupSummary(entries, worker, date) {
    const groups = new Map();
    entries
      .filter((entry) => matchesWorker(entry, worker))
      .filter((entry) => String(entry.date || "").slice(0, 10) === date)
      .forEach((entry) => {
        const productCode = entry.productCode || entry.styleName || entry.styleId || "No Product";
        const styleId = entry.styleId || productCode;
        const work = entry.productWork || entry.work || "General";
        const key = [productCode, styleId, work].join("||");
        const current = groups.get(key) || {
          productCode,
          styleId,
          work,
          pieces: 0,
          entries: 0,
        };
        current.pieces += Number(entry.pieces || 0);
        current.entries += 1;
        groups.set(key, current);
      });

    return Array.from(groups.values()).sort((a, b) => {
      const productCompare = String(a.productCode).localeCompare(String(b.productCode));
      if (productCompare) return productCompare;
      return String(a.work).localeCompare(String(b.work));
    });
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .ledger-style-summary-panel {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #fff;
        box-shadow: var(--shadow, 0 16px 40px rgba(15, 35, 45, .08));
      }

      .ledger-style-summary-head {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
      }

      .ledger-style-summary-head h2 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 16px;
      }

      .ledger-style-summary-head p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
      }

      .ledger-style-date-field {
        display: grid;
        gap: 6px;
        min-width: 190px;
      }

      .ledger-style-date-field span {
        color: var(--muted, #687683);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      .ledger-style-total-row {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
      }

      .ledger-style-total-row article {
        display: grid;
        gap: 5px;
        min-height: 76px;
        align-content: center;
        padding: 12px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .11), rgba(255, 255, 255, .96)), #fff;
        text-align: center;
      }

      .ledger-style-total-row span {
        color: var(--muted, #687683);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      .ledger-style-total-row strong {
        color: var(--primary, #0f766e);
        font-size: 22px;
      }

      .ledger-style-summary-table {
        width: 100%;
        overflow: auto;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
      }

      .ledger-style-summary-table table {
        width: 100%;
        min-width: 640px;
        border-collapse: collapse;
      }

      .ledger-style-summary-table th,
      .ledger-style-summary-table td {
        padding: 11px 10px;
        border-bottom: 1px solid var(--line, #dce5ea);
        text-align: left;
        white-space: nowrap;
        font-size: 13px;
      }

      .ledger-style-summary-table th {
        color: #52616d;
        background: #f8fbfc;
        font-size: 11px;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      .ledger-style-summary-table tr:last-child td {
        border-bottom: 0;
      }

      .ledger-style-empty {
        padding: 14px;
        border: 1px dashed rgba(15, 118, 110, .24);
        border-radius: 8px;
        background: #f8fbfc;
        color: var(--muted, #687683);
        text-align: center;
        font-size: 13px;
        font-weight: 800;
      }

      @media (max-width: 760px) {
        .ledger-style-summary-head {
          display: grid;
        }

        .ledger-style-total-row {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    const existing = document.getElementById(BOX_ID);
    if (existing) existing.remove();
  }

  function renderPanel() {
    const ledger = getLedgerRoot();
    const worker = selectedWorker();
    if (!ledger || !worker) {
      removePanel();
      return;
    }

    const workerKey = `${worker.id}-${worker.workerId}-${worker.mobile}`;
    const entries = readDb("production");
    const dates = availableDates(entries, worker);
    if (workerKey !== lastWorkerKey) {
      chosenDate = dates.at(-1) || todayIso();
      lastWorkerKey = workerKey;
    }
    if (!chosenDate) chosenDate = dates.at(-1) || todayIso();

    const rows = groupSummary(entries, worker, chosenDate);
    const totalPieces = rows.reduce((total, row) => total + Number(row.pieces || 0), 0);
    const totalStyles = new Set(rows.map((row) => `${row.productCode}||${row.styleId}`)).size;
    const totalEntries = rows.reduce((total, row) => total + Number(row.entries || 0), 0);
    const signature = JSON.stringify({
      workerKey,
      chosenDate,
      totalPieces,
      totalStyles,
      totalEntries,
      rows,
    });

    ensureStyle();
    const panel = document.getElementById(BOX_ID) || document.createElement("section");
    if (panel.dataset.summarySignature === signature) return;
    panel.id = BOX_ID;
    panel.className = "ledger-style-summary-panel";
    panel.dataset.summarySignature = signature;
    panel.innerHTML = `
      <div class="ledger-style-summary-head">
        <div>
          <h2>Date Wise Product Style PCS Summary</h2>
          <p>${escapeHtml(worker.name)} ke selected date par product/style wise total pieces.</p>
        </div>
        <label class="ledger-style-date-field">
          <span>Select Date</span>
          <input type="date" value="${escapeHtml(chosenDate)}" data-ledger-style-date>
        </label>
      </div>
      <div class="ledger-style-total-row">
        <article>
          <span>Total PCS</span>
          <strong>${formatNumber(totalPieces)}</strong>
        </article>
        <article>
          <span>Total Style</span>
          <strong>${formatNumber(totalStyles)}</strong>
        </article>
        <article>
          <span>Total Entry</span>
          <strong>${formatNumber(totalEntries)}</strong>
        </article>
      </div>
      ${
        rows.length
          ? `<div class="ledger-style-summary-table">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Product ID</th>
                    <th>Style ID</th>
                    <th>Work</th>
                    <th>Total PCS</th>
                    <th>Entries</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows
                    .map(
                      (row) => `<tr>
                        <td>${escapeHtml(chosenDate)}</td>
                        <td>${escapeHtml(row.productCode)}</td>
                        <td>${escapeHtml(row.styleId)}</td>
                        <td>${escapeHtml(row.work)}</td>
                        <td><strong>${formatNumber(row.pieces)}</strong></td>
                        <td>${formatNumber(row.entries)}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="ledger-style-empty">${escapeHtml(chosenDate)} date par ${escapeHtml(worker.name)} ka product/style PCS data nahi mila.</div>`
      }
    `;

    const firstPanel = ledger.querySelector(":scope > .panel");
    if (!panel.parentElement) {
      (firstPanel || ledger).insertAdjacentElement(firstPanel ? "afterend" : "afterbegin", panel);
    }

    const input = panel.querySelector("[data-ledger-style-date]");
    input.addEventListener("change", (event) => {
      chosenDate = event.target.value || todayIso();
      panel.dataset.summarySignature = "";
      renderPanel();
    });
  }

  let rafId = 0;
  function scheduleRender() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(renderPanel);
  }

  document.addEventListener("change", (event) => {
    if (event.target?.matches?.(".ledger-screen select")) {
      lastWorkerKey = "";
      scheduleRender();
    }
  });

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("storage", scheduleRender);
  setInterval(scheduleRender, 1800);
  scheduleRender();
})();

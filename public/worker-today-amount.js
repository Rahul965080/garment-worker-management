(function () {
  const SESSION_KEY = "garmentworks_worker_session";
  const PRODUCTION_KEY = "garmentworks_db_production_entries";
  const DEFAULT_FACTORY = "demo";
  const BOX_ID = "worker-today-amount-box";

  function todayIso() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
  }

  function readJson(key, fallback) {
    try {
      const text = window.localStorage.getItem(key);
      return text ? JSON.parse(text) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function scopedKey(baseKey, factoryId) {
    const id = factoryId || DEFAULT_FACTORY;
    return id === DEFAULT_FACTORY ? baseKey : `${baseKey}_${id}`;
  }

  function readWorkerSession() {
    return readJson(SESSION_KEY, null);
  }

  function readProductionEntries(worker) {
    const factoryId = String(worker?.factoryId || "").trim();
    if (!factoryId) return [];
    const entries = readJson(scopedKey(PRODUCTION_KEY, factoryId), []);
    return Array.isArray(entries) ? entries : [];
  }

  function entryAmount(entry) {
    if (Number.isFinite(Number(entry.amount))) return Number(entry.amount);
    return Number(entry.rate || 0) * Number(entry.pieces || 0);
  }

  function entryMatchesWorker(entry, worker) {
    if (!entry || !worker) return false;
    const entryWorkerId = String(entry.workerId ?? "").trim();
    return (
      entryWorkerId === String(worker.id ?? "").trim() ||
      entryWorkerId.toLowerCase() === String(worker.workerId ?? "").trim().toLowerCase() ||
      entryWorkerId === String(worker.mobile ?? "").trim()
    );
  }

  function calculateToday(worker) {
    const today = todayIso();
    const todayEntries = readProductionEntries(worker).filter(
      (entry) => String(entry.date || "").slice(0, 10) === today && entryMatchesWorker(entry, worker)
    );
    return {
      amount: todayEntries.reduce((total, entry) => total + entryAmount(entry), 0),
      pieces: todayEntries.reduce((total, entry) => total + Number(entry.pieces || 0), 0),
      entries: todayEntries.length,
      date: today,
    };
  }

  function ensureStyle() {
    if (document.getElementById("worker-today-amount-style")) return;
    const style = document.createElement("style");
    style.id = "worker-today-amount-style";
    style.textContent = `
      .worker-today-amount-card {
        display: grid;
        grid-template-columns: minmax(170px, 1fr) repeat(3, minmax(90px, .42fr));
        gap: 10px;
        margin-top: 12px;
        padding: 12px;
        border: 1px solid rgba(15, 118, 110, .18);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .12), rgba(255, 255, 255, .94)), #fff;
        box-shadow: 0 12px 28px rgba(14, 27, 34, .08);
      }

      .worker-today-amount-card > div {
        display: grid;
        align-content: center;
        gap: 5px;
        min-height: 70px;
        padding: 10px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: rgba(255, 255, 255, .82);
        text-align: center;
      }

      .worker-today-amount-card .today-main {
        justify-items: start;
        text-align: left;
        background: #0e1b22;
        color: #fff;
        border-color: #0e1b22;
      }

      .worker-today-amount-card span {
        color: var(--muted, #687683);
        font-size: 11px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }

      .worker-today-amount-card .today-main span {
        color: #9fe9df;
      }

      .worker-today-amount-card strong {
        color: var(--ink, #17212b);
        font-size: 20px;
        line-height: 1.1;
      }

      .worker-today-amount-card .today-main strong {
        color: #fff;
        font-size: 24px;
      }

      .worker-today-amount-card small {
        color: var(--muted, #687683);
        font-size: 12px;
        line-height: 1.35;
      }

      .worker-today-amount-card .today-main small {
        color: #c6f7ef;
      }

      @media (max-width: 760px) {
        .worker-today-amount-card {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .worker-today-amount-card .today-main {
          grid-column: 1 / -1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function removeBox() {
    const existing = document.getElementById(BOX_ID);
    if (existing) existing.remove();
  }

  function renderBox() {
    const isWorkerRoute = window.location.pathname.toLowerCase().startsWith("/worker");
    const isWorkView = document.body.innerText.includes("Worker Work View");
    const worker = readWorkerSession();

    if (!isWorkerRoute || !isWorkView || !worker?.id || !worker?.factoryId) {
      removeBox();
      return;
    }

    const overview = document.querySelector(".worker-overview");
    if (!overview) return;

    ensureStyle();
    const today = calculateToday(worker);
    const existing = document.getElementById(BOX_ID) || document.createElement("section");
    existing.id = BOX_ID;
    existing.className = "worker-today-amount-card";
    existing.setAttribute("aria-label", "Today work amount summary");
    existing.innerHTML = `
      <div class="today-main">
        <span>Today Amount</span>
        <strong>${formatCurrency(today.amount)}</strong>
        <small>Aaj ke complete production ka total amount</small>
      </div>
      <div>
        <span>Today Pieces</span>
        <strong>${formatNumber(today.pieces)}</strong>
        <small>Aaj enter hue total pieces</small>
      </div>
      <div>
        <span>Entries</span>
        <strong>${formatNumber(today.entries)}</strong>
        <small>Aaj ke work records</small>
      </div>
      <div>
        <span>Date</span>
        <strong>${today.date}</strong>
        <small>Auto today filter</small>
      </div>
    `;

    if (!existing.parentElement) overview.insertAdjacentElement("afterend", existing);
  }

  let rafId = 0;
  function scheduleRender() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(renderBox);
  }

  const observer = new MutationObserver(scheduleRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("storage", scheduleRender);
  window.addEventListener("popstate", scheduleRender);
  setInterval(scheduleRender, 1500);
  scheduleRender();
})();

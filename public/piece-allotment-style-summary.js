(function () {
  const DEFAULT_FACTORY = "demo";
  const ACTIVE_FACTORY_KEY = "garmentworks_active_factory";
  const PANEL_ID = "piece-allotment-style-summary";
  const STYLE_ID = "piece-allotment-style-summary-style";
  const DB_KEYS = {
    completed: "garmentworks_db_completed_piece_allotments",
    pieceAllotments: "garmentworks_db_piece_allotments",
    production: "garmentworks_db_production_entries",
    workers: "garmentworks_db_workers",
  };

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

  function bucketKey(workerId, productCode, productWork) {
    return [Number(workerId) || "", productCode || "", productWork || ""].join("||");
  }

  function reportPageOpen() {
    if (!window.location.pathname.toLowerCase().startsWith("/admin")) return false;
    const title = document.querySelector(".topbar h1")?.textContent?.trim() || "";
    return title === "Pieces Allotment";
  }

  function buildBuckets(pieceAllotments, production, completed) {
    const buckets = new Map();
    const completedEntered = new Map();

    function ensure(workerId, productCode, productWork) {
      const key = bucketKey(workerId, productCode, productWork);
      if (!buckets.has(key)) {
        buckets.set(key, {
          workerId: Number(workerId) || "",
          productCode: productCode || "No Product",
          productWork: productWork || "General",
          allotted: 0,
          entered: 0,
          remaining: 0,
          lastDate: "",
        });
      }
      return buckets.get(key);
    }

    completed.forEach((row) => {
      const key = bucketKey(row.workerId, row.productCode, row.productWork);
      completedEntered.set(key, (completedEntered.get(key) || 0) + Number(row.completedEnteredPieces || 0));
    });

    pieceAllotments.forEach((row) => {
      const bucket = ensure(row.workerId, row.productCode, row.productWork);
      bucket.allotted += Number(row.pieces || 0);
      bucket.entered += Number(row.archivedEnteredPieces || 0);
      const date = String(row.date || "").slice(0, 10);
      if (date && date > bucket.lastDate) bucket.lastDate = date;
    });

    production.forEach((row) => {
      const productCode = row.productCode || row.styleId || "No Product";
      const productWork = row.productWork || "General";
      const bucket = ensure(row.workerId, productCode, productWork);
      bucket.entered += Number(row.pieces || 0);
    });

    buckets.forEach((bucket) => {
      const key = bucketKey(bucket.workerId, bucket.productCode, bucket.productWork);
      bucket.entered = Math.max(bucket.entered - Number(completedEntered.get(key) || 0), 0);
      bucket.remaining = bucket.allotted - bucket.entered;
    });

    return Array.from(buckets.values()).filter((bucket) => Number(bucket.allotted || 0) > 0 && Number(bucket.remaining || 0) > 0);
  }

  function workerSummaries(workers, buckets, completed) {
    const workerMap = new Map(workers.map((worker) => [String(worker.id), worker]));
    const completedByWorker = new Map();
    completed.forEach((row) => {
      const key = String(row.workerId || "");
      const item = completedByWorker.get(key) || { styles: new Set(), pieces: 0 };
      item.styles.add(row.productCode || "No Product");
      item.pieces += Number(row.completedAllottedPieces || 0);
      completedByWorker.set(key, item);
    });

    const groups = new Map();
    buckets.forEach((bucket) => {
      const key = String(bucket.workerId || "");
      const worker = workerMap.get(key);
      const item = groups.get(key) || {
        workerId: bucket.workerId,
        workerName: worker?.name || `Worker #${bucket.workerId || "-"}`,
        mobile: worker?.mobile || "",
        styles: new Set(),
        workLines: 0,
        allotted: 0,
        entered: 0,
        remaining: 0,
        detail: [],
      };
      item.styles.add(bucket.productCode);
      item.workLines += 1;
      item.allotted += Number(bucket.allotted || 0);
      item.entered += Number(bucket.entered || 0);
      item.remaining += Number(bucket.remaining || 0);
      item.detail.push(bucket);
      groups.set(key, item);
    });

    workers.forEach((worker) => {
      const key = String(worker.id);
      if (!groups.has(key) && completedByWorker.has(key)) {
        const completedItem = completedByWorker.get(key);
        groups.set(key, {
          workerId: worker.id,
          workerName: worker.name,
          mobile: worker.mobile || "",
          styles: new Set(),
          workLines: 0,
          allotted: 0,
          entered: 0,
          remaining: 0,
          detail: [],
          completedStyles: completedItem.styles.size,
          completedPieces: completedItem.pieces,
        });
      }
    });

    return Array.from(groups.values())
      .map((item) => {
        const completedItem = completedByWorker.get(String(item.workerId)) || { styles: new Set(), pieces: 0 };
        return {
          ...item,
          styleCount: item.styles.size,
          completedStyles: item.completedStyles ?? completedItem.styles.size,
          completedPieces: item.completedPieces ?? completedItem.pieces,
          detail: item.detail.sort((a, b) => String(a.productCode).localeCompare(String(b.productCode)) || String(a.productWork).localeCompare(String(b.productWork))),
        };
      })
      .filter((item) => item.styleCount > 0 || item.completedStyles > 0)
      .sort((a, b) => b.remaining - a.remaining || a.workerName.localeCompare(b.workerName));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .piece-style-summary-panel {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
        padding: 16px;
        border: 1px solid rgba(15, 118, 110, .16);
        border-radius: 8px;
        background: #fff;
        box-shadow: var(--shadow, 0 16px 40px rgba(15, 35, 45, .08));
      }
      .piece-style-summary-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
        flex-wrap: wrap;
      }
      .piece-style-summary-head h2 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 18px;
      }
      .piece-style-summary-head p {
        margin: 5px 0 0;
        color: var(--muted, #687683);
        font-size: 13px;
      }
      .piece-style-summary-head strong {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 11px;
        border-radius: 8px;
        background: var(--primary-soft, #e4f7f5);
        color: var(--primary, #0f766e);
        font-size: 13px;
      }
      .piece-style-cards {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .piece-style-cards article {
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
      .piece-style-cards span,
      .piece-style-worker-card span {
        color: var(--muted, #687683);
        font-size: 10px;
        font-weight: 900;
        letter-spacing: .06em;
        text-transform: uppercase;
      }
      .piece-style-cards strong {
        color: var(--ink, #17212b);
        font-size: 20px;
      }
      .piece-style-workers {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 12px;
      }
      .piece-style-worker-card {
        display: grid;
        gap: 12px;
        padding: 14px;
        border: 1px solid rgba(15, 118, 110, .14);
        border-radius: 8px;
        background: linear-gradient(135deg, rgba(20, 184, 166, .07), #fff 58%);
      }
      .piece-style-worker-title {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: start;
      }
      .piece-style-worker-title h3 {
        margin: 0;
        color: var(--ink, #17212b);
        font-size: 16px;
      }
      .piece-style-worker-title p {
        margin: 4px 0 0;
        color: var(--muted, #687683);
        font-size: 12px;
      }
      .piece-style-count-badge {
        display: grid;
        place-items: center;
        min-width: 58px;
        min-height: 48px;
        padding: 6px 9px;
        border-radius: 8px;
        background: var(--primary, #0f766e);
        color: #fff;
        font-weight: 900;
        text-align: center;
      }
      .piece-style-mini-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .piece-style-mini-grid div {
        display: grid;
        gap: 4px;
        padding: 9px;
        border: 1px solid var(--line, #dce5ea);
        border-radius: 8px;
        background: #fff;
        text-align: center;
      }
      .piece-style-mini-grid strong {
        color: var(--primary, #0f766e);
        font-size: 18px;
      }
      .piece-style-detail {
        display: grid;
        gap: 6px;
      }
      .piece-style-detail-row {
        display: grid;
        grid-template-columns: minmax(92px, 1fr) minmax(82px, .8fr) repeat(3, minmax(50px, .55fr));
        gap: 7px;
        align-items: center;
        padding: 8px;
        border-radius: 8px;
        background: #f8fbfc;
        font-size: 12px;
      }
      .piece-style-detail-row strong {
        color: var(--ink, #17212b);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .piece-style-detail-row b {
        color: var(--primary, #0f766e);
        text-align: right;
      }
      .piece-style-empty {
        padding: 16px;
        border: 1px dashed rgba(15, 118, 110, .24);
        border-radius: 8px;
        background: #f8fbfc;
        color: var(--muted, #687683);
        text-align: center;
        font-size: 13px;
        font-weight: 800;
      }
      @media (max-width: 760px) {
        .piece-style-cards,
        .piece-style-mini-grid {
          grid-template-columns: 1fr;
        }
        .piece-style-detail-row {
          grid-template-columns: 1fr;
        }
        .piece-style-detail-row b {
          text-align: left;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderPanel() {
    if (!reportPageOpen()) {
      document.getElementById(PANEL_ID)?.remove();
      return;
    }

    const workers = readDb("workers");
    const allotments = readDb("pieceAllotments");
    const production = readDb("production");
    const completed = readDb("completed");
    const buckets = buildBuckets(allotments, production, completed);
    const summaries = workerSummaries(workers, buckets, completed);
    const totals = summaries.reduce(
      (acc, row) => {
        acc.styles += row.styleCount;
        acc.workLines += row.workLines;
        acc.allotted += row.allotted;
        acc.remaining += row.remaining;
        return acc;
      },
      { styles: 0, workLines: 0, allotted: 0, remaining: 0 }
    );

    const signature = JSON.stringify({
      summaries: summaries.map((row) => [row.workerId, row.styleCount, row.workLines, row.allotted, row.entered, row.remaining, row.completedStyles, row.completedPieces]),
      totals,
    });
    ensureStyle();

    let panel = document.getElementById(PANEL_ID);
    if (panel?.dataset.signature === signature) return;
    if (!panel) panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "piece-style-summary-panel";
    panel.dataset.signature = signature;
    panel.innerHTML = `
      <div class="piece-style-summary-head">
        <div>
          <h2>Worker Style Allotment Summary</h2>
          <p>Yahan se pata chalega kis worker ko kitne product/style aur kitne pieces allot hue hain.</p>
        </div>
        <strong>${escapeHtml(number(summaries.length))} workers</strong>
      </div>
      <div class="piece-style-cards">
        <article><span>Total Active Style</span><strong>${number(totals.styles)}</strong></article>
        <article><span>Work Lines</span><strong>${number(totals.workLines)}</strong></article>
        <article><span>Allotted Pieces</span><strong>${number(totals.allotted)}</strong></article>
        <article><span>Remaining Pieces</span><strong>${number(totals.remaining)}</strong></article>
      </div>
      ${
        summaries.length
          ? `<div class="piece-style-workers">
              ${summaries
                .map(
                  (worker) => `<article class="piece-style-worker-card">
                    <div class="piece-style-worker-title">
                      <div>
                        <h3>${escapeHtml(worker.workerName)}</h3>
                        <p>${escapeHtml(worker.mobile || "No mobile")} ${worker.completedStyles ? ` / completed styles ${number(worker.completedStyles)}` : ""}</p>
                      </div>
                      <div class="piece-style-count-badge">${number(worker.styleCount)}<br><small>styles</small></div>
                    </div>
                    <div class="piece-style-mini-grid">
                      <div><span>Allotted</span><strong>${number(worker.allotted)}</strong></div>
                      <div><span>Entered</span><strong>${number(worker.entered)}</strong></div>
                      <div><span>Remaining</span><strong>${number(worker.remaining)}</strong></div>
                    </div>
                    ${
                      worker.detail.length
                        ? `<div class="piece-style-detail">
                            ${worker.detail
                              .map(
                                (detail) => `<div class="piece-style-detail-row">
                                  <strong title="${escapeHtml(detail.productCode)}">${escapeHtml(detail.productCode)}</strong>
                                  <span>${escapeHtml(detail.productWork)}</span>
                                  <b>${number(detail.allotted)}</b>
                                  <b>${number(detail.entered)}</b>
                                  <b>${number(detail.remaining)}</b>
                                </div>`
                              )
                              .join("")}
                          </div>`
                        : `<div class="piece-style-empty">Active allotment complete ho chuka hai. Completed styles: ${number(worker.completedStyles)} / Pieces: ${number(worker.completedPieces)}</div>`
                    }
                  </article>`
                )
                .join("")}
            </div>`
          : `<div class="piece-style-empty">Abhi kisi worker ko active style/pieces allot nahi hai.</div>`
      }
    `;

    const layout = document.querySelector(".module-layout") || document.querySelector(".screen-grid") || document.querySelector(".workspace");
    const firstPanel = layout?.querySelector(":scope > .panel");
    if (!panel.parentElement) {
      if (firstPanel) firstPanel.insertAdjacentElement("beforebegin", panel);
      else layout?.appendChild(panel);
    }
  }

  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(renderPanel, 100);
  }

  document.addEventListener("click", scheduleRender, true);
  document.addEventListener("change", scheduleRender, true);
  window.addEventListener("storage", scheduleRender);
  setInterval(scheduleRender, 1800);
  scheduleRender();
})();

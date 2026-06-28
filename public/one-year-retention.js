(function () {
  const RETENTION_MONTHS = 12;
  const RETENTION_DAYS = 366;
  const BASE_KEYS = [
    "garmentworks_db_advances",
    "garmentworks_db_completed_piece_allotments",
    "garmentworks_db_expenses",
    "garmentworks_db_payments",
    "garmentworks_db_piece_allotments",
    "garmentworks_db_production_entries",
    "garmentworks_db_staff_payments",
  ];

  function readJson(key, fallback) {
    try {
      const value = window.localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Storage full hone par app ko crash nahi karna chahiye.
    }
  }

  function scopedKeys() {
    const keys = new Set(BASE_KEYS);
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (BASE_KEYS.some((baseKey) => key === baseKey || key.startsWith(`${baseKey}_`))) {
        keys.add(key);
      }
    }
    return Array.from(keys);
  }

  function parseDate(value) {
    const dateText = String(value || "").slice(0, 10);
    const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  function rowDate(row) {
    return parseDate(row?.date || row?.completedAt || row?.createdAt || row?.updatedAt);
  }

  function cutoffDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETENTION_DAYS);
  }

  function keepRow(row, cutoff) {
    const date = rowDate(row);
    return !date || date >= cutoff;
  }

  function applyRetention() {
    const cutoff = cutoffDate();
    scopedKeys().forEach((key) => {
      const rows = readJson(key, null);
      if (!Array.isArray(rows)) return;
      const kept = rows.filter((row) => keepRow(row, cutoff));
      if (kept.length !== rows.length) writeJson(key, kept);
    });
    window.GarmentWorksRetention = {
      months: RETENTION_MONTHS,
      days: RETENTION_DAYS,
      appliedAt: new Date().toISOString(),
    };
  }

  applyRetention();
  window.addEventListener("storage", applyRetention);
})();

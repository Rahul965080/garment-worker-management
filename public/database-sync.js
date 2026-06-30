(function () {
  const KEY_PREFIX = "garmentworks_";
  const API_BASE = "/api/db";
  const FLUSH_DELAY_MS = 350;
  const nativeStorage = {
    getItem: Storage.prototype.getItem,
    setItem: Storage.prototype.setItem,
    removeItem: Storage.prototype.removeItem,
    clear: Storage.prototype.clear,
    key: Storage.prototype.key,
  };

  let pendingData = {};
  let pendingRemoved = new Set();
  let flushTimer = 0;
  let flushing = false;

  function isAppKey(key) {
    return typeof key === "string" && key.startsWith(KEY_PREFIX);
  }

  function getLocalSnapshot() {
    const data = {};
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = nativeStorage.key.call(window.localStorage, index);
        if (isAppKey(key)) data[key] = nativeStorage.getItem.call(window.localStorage, key) || "";
      }
    } catch (error) {
      console.warn("Database snapshot failed:", error);
    }
    return data;
  }

  function queueSet(key, value) {
    if (!isAppKey(key)) return;
    pendingData[key] = String(value);
    pendingRemoved.delete(key);
    scheduleFlush();
  }

  function queueRemove(key) {
    if (!isAppKey(key)) return;
    delete pendingData[key];
    pendingRemoved.add(key);
    scheduleFlush();
  }

  function scheduleFlush() {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flushDatabase, FLUSH_DELAY_MS);
  }

  function mergePendingBack(data, removed) {
    pendingData = { ...data, ...pendingData };
    removed.forEach((key) => pendingRemoved.add(key));
  }

  async function flushDatabase() {
    if (flushing) {
      scheduleFlush();
      return;
    }

    const data = pendingData;
    const removed = Array.from(pendingRemoved);
    pendingData = {};
    pendingRemoved = new Set();

    if (!Object.keys(data).length && !removed.length) return;

    flushing = true;
    try {
      const response = await fetch(`${API_BASE}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, removed }),
        keepalive: true,
      });
      if (!response.ok) throw new Error("Database sync failed");
      window.__garmentworksDbStatus = { ok: true, lastSync: new Date().toISOString() };
    } catch (error) {
      mergePendingBack(data, removed);
      window.__garmentworksDbStatus = { ok: false, error: error.message || "Database offline" };
      window.setTimeout(scheduleFlush, 2000);
    } finally {
      flushing = false;
    }
  }

  function sendPendingWithBeacon() {
    const data = { ...pendingData };
    const removed = Array.from(pendingRemoved);
    if (!Object.keys(data).length && !removed.length) return;

    try {
      const body = JSON.stringify({ data, removed });
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon(`${API_BASE}/sync`, blob);
      pendingData = {};
      pendingRemoved = new Set();
    } catch {
      flushDatabase();
    }
  }

  async function hydrateFromDatabase() {
    try {
      const response = await fetch(`${API_BASE}/snapshot`, { cache: "no-store" });
      if (!response.ok) throw new Error("Database snapshot failed");

      const payload = await response.json();
      const remoteData = payload && payload.data && typeof payload.data === "object" ? payload.data : {};

      Object.entries(remoteData).forEach(([key, value]) => {
        if (isAppKey(key)) nativeStorage.setItem.call(window.localStorage, key, String(value));
      });

      pendingData = { ...getLocalSnapshot(), ...pendingData };
      scheduleFlush();
      window.__garmentworksDbStatus = { ok: true, lastHydrate: new Date().toISOString() };
      window.dispatchEvent(new CustomEvent("garmentworks-db-ready", { detail: payload }));
    } catch (error) {
      pendingData = { ...getLocalSnapshot(), ...pendingData };
      scheduleFlush();
      window.__garmentworksDbStatus = { ok: false, error: error.message || "Database offline; using local cache" };
      window.dispatchEvent(new CustomEvent("garmentworks-db-ready", { detail: { ok: false } }));
    }
  }

  Storage.prototype.setItem = function (key, value) {
    const result = nativeStorage.setItem.call(this, key, value);
    if (this === window.localStorage) queueSet(key, value);
    return result;
  };

  Storage.prototype.removeItem = function (key) {
    const result = nativeStorage.removeItem.call(this, key);
    if (this === window.localStorage) queueRemove(key);
    return result;
  };

  Storage.prototype.clear = function () {
    if (this === window.localStorage) {
      const removed = Object.keys(getLocalSnapshot());
      const result = nativeStorage.clear.call(this);
      removed.forEach(queueRemove);
      return result;
    }
    return nativeStorage.clear.call(this);
  };

  window.__garmentworksDb = {
    flush: flushDatabase,
    snapshot: getLocalSnapshot,
    status: () => window.__garmentworksDbStatus || { ok: false, error: "Database not hydrated yet" },
  };

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sendPendingWithBeacon();
  });
  window.addEventListener("beforeunload", sendPendingWithBeacon);

  window.__garmentworksDbReady = hydrateFromDatabase();
})();

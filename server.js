import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 8080);
const dataRoot = resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(root, ".data"));
const databaseFile = join(dataRoot, "garmentworks-db.json");
const databaseKeyPrefix = "garmentworks_";
const maxJsonBodyBytes = 25 * 1024 * 1024;
const postgresConnectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
let postgresPoolPromise = null;
let postgresUnavailableReason = "";
const rateLimitWindowMs = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const apiRateLimitMax = Number(process.env.API_RATE_LIMIT_MAX || 180);
const syncRateLimitMax = Number(process.env.SYNC_RATE_LIMIT_MAX || 60);
const rateLimitBuckets = new Map();
const sessionCookieName = "gw_session";
const sessionMaxAgeSeconds = Number(process.env.SESSION_MAX_AGE_SECONDS || 12 * 60 * 60);
const sessionSecret = process.env.APP_SESSION_SECRET || process.env.SESSION_SECRET || postgresConnectionString || "garmentworks-local-session-secret";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function ensureDataRoot() {
  mkdirSync(dataRoot, { recursive: true });
}

function securityHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": contentType.startsWith("text/html") ? "no-store" : "public, max-age=3600",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, nofollow",
  };
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload) {
  return createHmac("sha256", sessionSecret).update(payload).digest("base64url");
}

function createSessionToken(session) {
  const payload = base64UrlEncode(JSON.stringify({
    ...session,
    nonce: randomBytes(10).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds,
  }));
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    if (!session.exp || Number(session.exp) < Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch {
    return null;
  }
}

function parseCookies(request) {
  const header = request.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) return [part, ""];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

function sessionFromRequest(request) {
  return verifySessionToken(parseCookies(request)[sessionCookieName]);
}

function setSessionCookie(response, token) {
  response.setHeader(
    "Set-Cookie",
    `${sessionCookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionMaxAgeSeconds}; Secure`,
  );
}

function clearSessionCookie(response) {
  response.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure`);
}

function getClientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
}

function getRequestHost(request) {
  const proto = request.headers["x-forwarded-proto"] || "http";
  const host = request.headers["x-forwarded-host"] || request.headers.host || "localhost";
  return `${proto}://${host}`;
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;

  try {
    const requestOrigin = new URL(getRequestHost(request)).origin;
    return new URL(origin).origin === requestOrigin;
  } catch {
    return false;
  }
}

function applyRateLimit(request, maxRequests) {
  const ip = getClientIp(request);
  const parsed = new URL(request.url || "/", "http://localhost");
  const bucketKey = `${ip}:${parsed.pathname}`;
  const now = Date.now();
  const current = rateLimitBuckets.get(bucketKey);

  if (!current || now > current.resetAt) {
    rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + rateLimitWindowMs });
    return { allowed: true, remaining: Math.max(0, maxRequests - 1), resetAt: now + rateLimitWindowMs };
  }

  current.count += 1;
  if (current.count > maxRequests) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  return { allowed: true, remaining: Math.max(0, maxRequests - current.count), resetAt: current.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (now > bucket.resetAt) rateLimitBuckets.delete(key);
  }
}, rateLimitWindowMs).unref();

function attachRequestLogger(request, response) {
  const start = Date.now();
  response.on("finish", () => {
    const parsed = new URL(request.url || "/", "http://localhost");
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      method: request.method,
      path: parsed.pathname,
      status: response.statusCode,
      durationMs: Date.now() - start,
      ip: getClientIp(request),
      userAgent: request.headers["user-agent"] || "",
    }));
  });
}

function readJsonDatabase() {
  ensureDataRoot();
  if (!existsSync(databaseFile)) {
    return { updatedAt: null, data: {} };
  }

  try {
    const parsed = JSON.parse(readFileSync(databaseFile, "utf8"));
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
      data: parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {},
    };
  } catch (error) {
    console.error("Database read failed:", error);
    return { updatedAt: null, data: {} };
  }
}

function writeJsonDatabase(data) {
  ensureDataRoot();
  const payload = { updatedAt: new Date().toISOString(), data };
  const tempFile = `${databaseFile}.tmp`;
  writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tempFile, databaseFile);
  return payload;
}

function hasPostgresConfig() {
  return Boolean(postgresConnectionString || (process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER));
}

async function getPostgresPool() {
  if (!hasPostgresConfig()) return null;
  if (!postgresPoolPromise) {
    postgresPoolPromise = (async () => {
      try {
        const { Pool } = await import("pg");
        const pool = postgresConnectionString
          ? new Pool({
              connectionString: postgresConnectionString,
              ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
            })
          : new Pool({
              host: process.env.PGHOST,
              port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
              database: process.env.PGDATABASE,
              user: process.env.PGUSER,
              password: process.env.PGPASSWORD,
              ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
            });

        await pool.query(`
          CREATE TABLE IF NOT EXISTS garmentworks_kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query("CREATE INDEX IF NOT EXISTS garmentworks_kv_updated_at_idx ON garmentworks_kv (updated_at DESC)");
        await migrateJsonDatabaseToPostgres(pool);
        postgresUnavailableReason = "";
        return pool;
      } catch (error) {
        postgresUnavailableReason = error.message || "Postgres unavailable";
        console.error("Postgres unavailable, using JSON fallback:", error);
        return null;
      }
    })();
  }
  return postgresPoolPromise;
}

async function migrateJsonDatabaseToPostgres(pool) {
  if (!existsSync(databaseFile)) return;

  const countResult = await pool.query("SELECT COUNT(*)::int AS count FROM garmentworks_kv");
  if (Number(countResult.rows[0]?.count || 0) > 0) return;

  const snapshot = readJsonDatabase();
  const entries = Object.entries(snapshot.data).filter(([key]) => isDatabaseKey(key));
  if (!entries.length) return;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO garmentworks_kv (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)],
      );
    }
    await client.query("COMMIT");
    console.log(`Migrated ${entries.length} GarmentWorks keys from JSON file to Postgres`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readPostgresDatabase(pool) {
  const result = await pool.query(
    "SELECT key, value, updated_at FROM garmentworks_kv WHERE key LIKE $1 ORDER BY key ASC",
    [`${databaseKeyPrefix}%`],
  );
  const data = {};
  let updatedAt = null;
  for (const row of result.rows) {
    data[row.key] = row.value;
    const rowUpdatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || "");
    if (!updatedAt || rowUpdatedAt > updatedAt) updatedAt = rowUpdatedAt;
  }
  return { updatedAt, data };
}

async function syncPostgresDatabase(pool, incomingData, removedKeys) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of Object.entries(incomingData)) {
      if (!isDatabaseKey(key)) continue;
      await client.query(
        `INSERT INTO garmentworks_kv (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, String(value)],
      );
    }
    for (const key of removedKeys) {
      if (isDatabaseKey(key)) await client.query("DELETE FROM garmentworks_kv WHERE key = $1", [key]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return readPostgresDatabase(pool);
}

async function readDatabase() {
  const pool = await getPostgresPool();
  if (pool) {
    return { storage: "postgres", ...(await readPostgresDatabase(pool)) };
  }

  const snapshot = readJsonDatabase();
  return {
    storage: process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR ? "persistent-json-file" : "local-json-file",
    warning: hasPostgresConfig() ? postgresUnavailableReason : "DATABASE_URL not configured",
    ...snapshot,
  };
}

function parseJsonValue(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function cleanCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32);
}

function lower(value) {
  return String(value || "").trim().toLowerCase();
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function scopedKey(baseKey, factoryId) {
  const id = String(factoryId || "").trim();
  return !id || id === "demo" ? baseKey : `${baseKey}_${id}`;
}

function factoriesFromData(data) {
  const rows = parseJsonValue(data.garmentworks_factories, []);
  return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

function normalizeFactory(row) {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || row.factoryId || row.code || row.factoryCode || "").trim();
  const code = String(row.code || row.factoryCode || row.id || "").trim();
  const name = String(row.name || row.factoryName || row.companyName || "").trim();
  if (!id && !code) return null;
  return { ...row, id: id || code, code: code || id, name };
}

function findFactoryForLogin(data, value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const code = cleanCode(raw);
  const text = lower(raw);
  return (
    factoriesFromData(data)
      .map(normalizeFactory)
      .filter(Boolean)
      .find((factory) => (
        cleanCode(factory.code) === code ||
        cleanCode(factory.id) === code ||
        lower(factory.name) === text ||
        lower(factory.factoryName) === text ||
        lower(factory.companyName) === text
      )) || null
  );
}

function rowsForFactory(data, baseKey, factory) {
  const ids = [factory?.id, factory?.code, factory?.factoryId, factory?.factoryCode].filter(Boolean);
  for (const id of ids) {
    const rows = parseJsonValue(data[scopedKey(baseKey, id)], null);
    if (Array.isArray(rows)) return rows;
  }
  const fallback = parseJsonValue(data[baseKey], []);
  return Array.isArray(fallback) ? fallback : [];
}

function isActive(row) {
  return String(row?.status || "Active").toLowerCase() === "active";
}

function tenantSnapshot(data, factory) {
  const allowed = {};
  if (data.garmentworks_factories) allowed.garmentworks_factories = data.garmentworks_factories;
  const ids = [...new Set([factory?.id, factory?.code, factory?.factoryId, factory?.factoryCode].filter(Boolean).map(String))];
  const always = [
    "garmentworks_active_factory",
    "garmentworks_admin_session",
    "garmentworks_staff_session",
    "garmentworks_worker_session",
  ];
  for (const key of always) {
    if (data[key] !== undefined) allowed[key] = data[key];
  }

  for (const [key, value] of Object.entries(data)) {
    if (!isDatabaseKey(key)) continue;
    if (ids.some((id) => key.endsWith(`_${id}`))) allowed[key] = value;
  }
  return allowed;
}

async function authenticateLogin(body) {
  const role = lower(body.role || body.portal || "");
  if (!["admin", "staff", "worker"].includes(role)) return { ok: false, error: "Invalid login portal" };

  const snapshot = await readDatabase();
  const data = snapshot.data || {};
  const factory = findFactoryForLogin(data, body.factoryCode || body.factory || body.factoryName);
  if (!factory) return { ok: false, error: "Factory code/name match nahi hua" };

  const password = String(body.password || "").trim();
  if (password.length < 4) return { ok: false, error: "Password kam se kam 4 character ka hona chahiye" };

  let user = null;
  if (role === "admin" || role === "staff") {
    const email = lower(body.email);
    const staff = rowsForFactory(data, "garmentworks_db_staff", factory);
    user = staff.find((row) => lower(row.email) === email);
    if (!user || String(user.password || "") !== password) return { ok: false, error: "Factory, email ya password match nahi hua" };
    const isAdmin = lower(user.role) === "admin";
    if (role === "admin" && !isAdmin) return { ok: false, error: "Is account ko admin access allowed nahi hai" };
    if (role === "staff" && isAdmin) return { ok: false, error: "Admin account staff portal par allowed nahi hai" };
  } else {
    const workerId = lower(body.workerId);
    const mobile = digits(body.mobile);
    const workers = rowsForFactory(data, "garmentworks_db_workers", factory);
    user = workers.find((row) => lower(row.workerId) === workerId || (!!mobile && digits(row.mobile) === mobile));
    if (!user || String(user.password || "").trim() !== password) return { ok: false, error: "Factory, worker ID/mobile ya password match nahi hua" };
  }

  if (!isActive(user)) return { ok: false, error: "Account suspended/inactive hai" };

  const session = {
    role,
    id: user.id || user.workerId || user.email || "",
    email: user.email || "",
    workerId: user.workerId || "",
    mobile: user.mobile || "",
    name: user.name || "",
    factoryId: factory.id,
    factoryCode: factory.code,
    loginAt: Date.now(),
  };
  return { ok: true, session, data: tenantSnapshot(data, factory) };
}

async function syncDatabase(incomingData, removedKeys) {
  const pool = await getPostgresPool();
  if (pool) {
    return { storage: "postgres", ...(await syncPostgresDatabase(pool, incomingData, removedKeys)) };
  }

  const snapshot = readJsonDatabase();
  const nextData = { ...snapshot.data };
  for (const [key, value] of Object.entries(incomingData)) {
    if (isDatabaseKey(key)) nextData[key] = String(value);
  }
  for (const key of removedKeys) {
    if (isDatabaseKey(key)) delete nextData[key];
  }
  return {
    storage: process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR ? "persistent-json-file" : "local-json-file",
    warning: hasPostgresConfig() ? postgresUnavailableReason : "DATABASE_URL not configured",
    ...writeJsonDatabase(nextData),
  };
}

function isDatabaseKey(key) {
  return typeof key === "string" && key.startsWith(databaseKeyPrefix) && key.length <= 240;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxJsonBodyBytes) {
        rejectBody(new Error("Request body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        rejectBody(new Error("Invalid JSON body"));
      }
    });

    request.on("error", rejectBody);
  });
}

async function handleDatabaseApi(request, response) {
  const parsed = new URL(request.url || "/", "http://localhost");

  if (parsed.pathname === "/api/health" && request.method === "GET") {
    const pool = await getPostgresPool();
    if (pool) await pool.query("SELECT 1");
    sendJson(response, 200, {
      ok: true,
      storage: pool ? "postgres" : "json-fallback",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (parsed.pathname === "/api/auth/session" && request.method === "GET") {
    const session = sessionFromRequest(request);
    sendJson(response, session ? 200 : 401, { ok: Boolean(session), session: session || null });
    return true;
  }

  if (parsed.pathname === "/api/auth/logout" && request.method === "POST") {
    clearSessionCookie(response);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (parsed.pathname === "/api/auth/login" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await authenticateLogin(body);
      if (!result.ok) {
        sendJson(response, 401, result);
        return true;
      }
      setSessionCookie(response, createSessionToken(result.session));
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "Login failed" });
    }
    return true;
  }

  if (parsed.pathname.startsWith("/api/db")) {
    const maxRequests = parsed.pathname === "/api/db/sync" ? syncRateLimitMax : apiRateLimitMax;
    const rateLimit = applyRateLimit(request, maxRequests);
    response.setHeader("RateLimit-Limit", String(maxRequests));
    response.setHeader("RateLimit-Remaining", String(rateLimit.remaining));
    response.setHeader("RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));
    if (!rateLimit.allowed) {
      sendJson(response, 429, { ok: false, error: "Too many requests. Please try again shortly." });
      return true;
    }
  }

  if (request.method !== "GET" && parsed.pathname.startsWith("/api/db") && !isAllowedOrigin(request)) {
    sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
    return true;
  }

  if (request.method === "GET" && parsed.pathname === "/api/db/snapshot") {
    const snapshot = await readDatabase();
    sendJson(response, 200, {
      ok: true,
      storage: snapshot.storage,
      warning: snapshot.warning,
      updatedAt: snapshot.updatedAt,
      data: snapshot.data,
    });
    return true;
  }

  if (request.method === "POST" && parsed.pathname === "/api/db/sync") {
    try {
      const body = await readJsonBody(request);
      const incomingData = body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
      const removedKeys = Array.isArray(body?.removed) ? body.removed : [];
      const saved = await syncDatabase(incomingData, removedKeys);
      sendJson(response, 200, {
        ok: true,
        storage: saved.storage,
        warning: saved.warning,
        updatedAt: saved.updatedAt,
        keys: Object.keys(saved.data).length,
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "Database sync failed" });
    }
    return true;
  }

  if (parsed.pathname.startsWith("/api/db")) {
    sendJson(response, 404, { ok: false, error: "Database endpoint not found" });
    return true;
  }

  return false;
}

function fileForUrl(url) {
  const parsed = new URL(url, "http://localhost");
  const pathname = decodeURIComponent(parsed.pathname);
  const normalized = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const requested = resolve(join(root, normalized));
  if (!requested.startsWith(root)) return join(root, "index.html");
  if (existsSync(requested) && statSync(requested).isFile()) return requested;
  const publicFile = resolve(join(publicRoot, normalized));
  if (publicFile.startsWith(publicRoot) && existsSync(publicFile) && statSync(publicFile).isFile()) return publicFile;
  return join(root, "index.html");
}

function sendFile(response, filePath) {
  const stream = createReadStream(filePath);
  response.writeHead(200, securityHeaders(mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream"));
  stream.pipe(response);
  stream.on("error", () => {
    response.writeHead(500, securityHeaders("text/plain; charset=utf-8"));
    response.end("Server error");
  });
}

createServer(async (request, response) => {
  attachRequestLogger(request, response);
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }
  if (await handleDatabaseApi(request, response)) return;
  sendFile(response, fileForUrl(request.url));
}).listen(port, "0.0.0.0", () => {
  console.log(`GarmentWorks server running on port ${port}`);
});

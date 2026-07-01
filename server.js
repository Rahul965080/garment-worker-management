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
const otpExpiryMinutes = Number(process.env.OTP_EXPIRY_MINUTES || 10);
const otpMaxAttempts = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const memoryOtpStore = new Map();
const smtpHost = process.env.SMTP_HOST || "smtp-relay.brevo.com";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || smtpPort === 465;
const smtpUser = process.env.SMTP_USER || process.env.BREVO_SMTP_USER || "";
const smtpPass = process.env.SMTP_PASS || process.env.BREVO_SMTP_KEY || "";
const smtpFrom = process.env.SMTP_FROM || smtpUser;
let smtpTransportPromise = null;

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

function createPasswordResetToken(record) {
  const payload = base64UrlEncode(JSON.stringify({
    purpose: "password-reset",
    resetId: record.reset_id || record.resetId,
    role: record.role,
    factoryId: record.factory_id || record.factoryId,
    userId: record.user_id || record.userId,
    nonce: randomBytes(10).toString("hex"),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  }));
  return `${payload}.${signPayload(payload)}`;
}

function verifyPasswordResetToken(token) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = signPayload(payload);
  const actualBuffer = Buffer.from(signature || "");
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    if (parsed.purpose !== "password-reset") return null;
    if (!parsed.exp || Number(parsed.exp) < Math.floor(Date.now() / 1000)) return null;
    return parsed;
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

function hasSmtpConfig() {
  return Boolean(smtpHost && smtpPort && smtpUser && smtpPass && smtpFrom);
}

async function getSmtpTransport() {
  if (!hasSmtpConfig()) return null;
  if (!smtpTransportPromise) {
    smtpTransportPromise = (async () => {
      const { default: nodemailer } = await import("nodemailer");
      return nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    })();
  }
  return smtpTransportPromise;
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function deliverOtp(record, otp, target) {
  const contact = String(record.contact || "").trim();
  if (isEmail(contact) && hasSmtpConfig()) {
    try {
      const transport = await getSmtpTransport();
      await transport.sendMail({
        from: smtpFrom,
        to: contact,
        subject: "GarmentWorks Password Reset OTP",
        text: [
          `Hello ${target.user?.name || "GarmentWorks user"},`,
          "",
          `Your password reset OTP is: ${otp}`,
          `This OTP will expire in ${otpExpiryMinutes} minutes.`,
          "",
          "If you did not request this reset, please ignore this email.",
        ].join("\n"),
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
            <h2>GarmentWorks Password Reset OTP</h2>
            <p>Hello ${String(target.user?.name || "GarmentWorks user").replace(/[<>]/g, "")},</p>
            <p>Your password reset OTP is:</p>
            <p style="font-size:28px;font-weight:800;letter-spacing:4px">${otp}</p>
            <p>This OTP will expire in ${otpExpiryMinutes} minutes.</p>
            <p>If you did not request this reset, please ignore this email.</p>
          </div>
        `,
      });
      console.log(JSON.stringify({
        at: new Date().toISOString(),
        event: "password_reset_otp_email_sent",
        resetId: record.resetId,
        role: record.role,
        factoryId: record.factoryId,
        contact: maskContact(contact),
      }));
      return { delivery: "email", message: "OTP registered email par send ho gaya." };
    } catch (error) {
      console.error("SMTP OTP delivery failed:", error);
    }
  }

  console.log(JSON.stringify({
    at: new Date().toISOString(),
    event: "password_reset_otp",
    resetId: record.resetId,
    role: record.role,
    factoryId: record.factoryId,
    contact: maskContact(contact),
    otp,
    expiresAt: record.expiresAt,
  }));
  return {
    delivery: "railway-logs",
    message: hasSmtpConfig()
      ? "Email send nahi ho paaya. OTP Railway logs me available hai."
      : "SMTP configure nahi hai. OTP Railway logs me available hai.",
  };
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
        await pool.query(`
          CREATE TABLE IF NOT EXISTS garmentworks_password_reset_otps (
            reset_id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            factory_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            contact TEXT NOT NULL,
            otp_hash TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await pool.query("CREATE INDEX IF NOT EXISTS garmentworks_kv_updated_at_idx ON garmentworks_kv (updated_at DESC)");
        await pool.query("CREATE INDEX IF NOT EXISTS garmentworks_password_reset_otps_expires_at_idx ON garmentworks_password_reset_otps (expires_at)");
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

function dataKeyForFactory(data, baseKey, factory) {
  const ids = [factory?.id, factory?.code, factory?.factoryId, factory?.factoryCode].filter(Boolean);
  for (const id of ids) {
    const key = scopedKey(baseKey, id);
    if (data[key] !== undefined) return key;
  }
  if (data[baseKey] !== undefined) return baseKey;
  return ids.length ? scopedKey(baseKey, ids[0]) : baseKey;
}

function factoryIdentitySet(factory) {
  return new Set(
    [factory?.id, factory?.code, factory?.factoryId, factory?.factoryCode]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean),
  );
}

function sameFactoryIdentity(factory, value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const code = cleanCode(raw);
  const text = lower(raw);
  return Array.from(factoryIdentitySet(factory)).some((item) => item === raw || cleanCode(item) === code || lower(item) === text);
}

function factoryForKey(data, key) {
  const suffix = String(key || "").startsWith("garmentworks_db_staff_")
    ? String(key).slice("garmentworks_db_staff_".length)
    : String(key || "").startsWith("garmentworks_db_workers_")
      ? String(key).slice("garmentworks_db_workers_".length)
      : "";
  if (!suffix) return null;
  return factoriesFromData(data).map(normalizeFactory).filter(Boolean).find((factory) => sameFactoryIdentity(factory, suffix)) || null;
}

function accountIdentity(row) {
  return {
    email: lower(row?.email || row?.ownerEmail || row?.adminEmail || ""),
    mobile: digits(row?.mobile || row?.ownerMobile || row?.adminMobile || row?.phone || ""),
  };
}

function factoryCodeLabel(factory) {
  return String(factory?.code || factory?.factoryCode || factory?.id || factory?.factoryId || "").trim();
}

function findAccountByIdentity(data, identity, excludeFactoryIds = []) {
  const email = lower(identity?.email || "");
  const mobile = digits(identity?.mobile || "");
  if (!email && !mobile) return null;
  const excluded = excludeFactoryIds.map((value) => String(value || "").trim()).filter(Boolean);

  for (const factory of factoriesFromData(data).map(normalizeFactory).filter(Boolean)) {
    if (excluded.some((id) => sameFactoryIdentity(factory, id))) continue;
    const factoryIdentity = accountIdentity(factory);
    if ((email && factoryIdentity.email === email) || (mobile && factoryIdentity.mobile === mobile)) {
      return { factory, source: "factory" };
    }

    const staff = rowsForFactory(data, "garmentworks_db_staff", factory);
    for (const row of staff) {
      const rowIdentity = accountIdentity(row);
      if ((email && rowIdentity.email === email) || (mobile && rowIdentity.mobile === mobile)) {
        return { factory, source: lower(row.role) === "admin" ? "admin" : "staff" };
      }
    }
  }
  return null;
}

function findDuplicateCreateAccount(data, body) {
  const identity = accountIdentity(body || {});
  const match = findAccountByIdentity(data, identity);
  if (!match) return null;
  return {
    factoryCode: factoryCodeLabel(match.factory),
    factoryName: match.factory.name || match.factory.factoryName || "",
    source: match.source,
  };
}

function findIncomingDuplicateAccount(existingData, incomingData) {
  const incomingFactories = parseJsonValue(incomingData.garmentworks_factories, null);
  if (Array.isArray(incomingFactories)) {
    for (const factory of incomingFactories.map(normalizeFactory).filter(Boolean)) {
      const duplicate = findAccountByIdentity(existingData, accountIdentity(factory), Array.from(factoryIdentitySet(factory)));
      if (duplicate) return { duplicate, incomingFactory: factory };
    }
  }

  for (const [key, value] of Object.entries(incomingData || {})) {
    if (!/^garmentworks_db_staff(_|$)/.test(key)) continue;
    const rows = parseJsonValue(value, []);
    if (!Array.isArray(rows)) continue;
    const incomingFactory = factoryForKey({ ...existingData, ...incomingData }, key);
    const exclude = incomingFactory ? Array.from(factoryIdentitySet(incomingFactory)) : [];
    for (const row of rows) {
      if (lower(row?.role) !== "admin") continue;
      const duplicate = findAccountByIdentity(existingData, accountIdentity(row), exclude);
      if (duplicate) return { duplicate, incomingFactory };
    }
  }

  return null;
}

function recoverFactoriesByIdentity(data, body) {
  const role = lower(body.role || body.portal || "");
  if (!["admin", "staff", "worker"].includes(role)) return { ok: false, error: "Invalid portal" };
  const rawQuery = String(body.query || body.email || body.mobile || body.workerId || "").trim();
  if (rawQuery.length < 3) return { ok: false, error: "Registered detail kam se kam 3 character ka hona chahiye" };
  const email = lower(rawQuery);
  const mobile = digits(rawQuery);
  const workerId = lower(rawQuery);
  const matches = [];

  for (const factory of factoriesFromData(data).map(normalizeFactory).filter(Boolean)) {
    let found = false;
    if (role === "admin") {
      const factoryIdentity = accountIdentity(factory);
      found = (email && factoryIdentity.email === email) || (mobile && factoryIdentity.mobile === mobile);
    }

    const staff = rowsForFactory(data, "garmentworks_db_staff", factory);
    if (!found && role !== "worker") {
      found = staff.some((row) => {
        const isAdmin = lower(row.role) === "admin";
        if (role === "admin" && !isAdmin) return false;
        if (role === "staff" && isAdmin) return false;
        const identity = accountIdentity(row);
        return (email && identity.email === email) || (mobile && identity.mobile === mobile);
      });
    }

    if (!found && role === "worker") {
      const workers = rowsForFactory(data, "garmentworks_db_workers", factory);
      found = workers.some((row) => {
        const identity = accountIdentity(row);
        return (mobile && identity.mobile === mobile) || (workerId && lower(row.workerId) === workerId);
      });
    }

    if (found) {
      matches.push({
        id: factory.id,
        code: factoryCodeLabel(factory),
        name: factory.name || factory.factoryName || factoryCodeLabel(factory),
      });
    }
  }

  return matches.length ? { ok: true, matches } : { ok: false, error: "Is detail se factory code nahi mila." };
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

function findPasswordResetTarget(data, body) {
  const role = lower(body.role || body.portal || "");
  if (!["admin", "staff", "worker"].includes(role)) return { ok: false, error: "Invalid portal" };

  const factory = findFactoryForLogin(data, body.factoryCode || body.factory || body.factoryName);
  if (!factory) return { ok: false, error: "Factory code/name match nahi hua" };

  if (role === "admin" || role === "staff") {
    const email = lower(body.email);
    const mobile = digits(body.mobile);
    const staffKey = dataKeyForFactory(data, "garmentworks_db_staff", factory);
    const staff = parseJsonValue(data[staffKey], []);
    const user = (Array.isArray(staff) ? staff : []).find((row) => lower(row.email) === email && digits(row.mobile) === mobile);
    if (!user) return { ok: false, error: "Email/mobile factory se match nahi hua" };
    const isAdmin = lower(user.role) === "admin";
    if (role === "admin" && !isAdmin) return { ok: false, error: "Is account ko admin reset allowed nahi hai" };
    if (role === "staff" && isAdmin) return { ok: false, error: "Admin account staff reset me allowed nahi hai" };
    if (!isActive(user)) return { ok: false, error: "Account suspended/inactive hai" };
    return { ok: true, role, factory, baseKey: "garmentworks_db_staff", dataKey: staffKey, user, contact: user.email || user.mobile || mobile };
  }

  const workerId = lower(body.workerId);
  const mobile = digits(body.mobile);
  const workerKey = dataKeyForFactory(data, "garmentworks_db_workers", factory);
  const workers = parseJsonValue(data[workerKey], []);
  const user = (Array.isArray(workers) ? workers : []).find((row) => lower(row.workerId) === workerId && digits(row.mobile) === mobile);
  if (!user) return { ok: false, error: "Worker ID/mobile factory se match nahi hua" };
  if (!isActive(user)) return { ok: false, error: "Worker suspended/inactive hai" };
  return { ok: true, role, factory, baseKey: "garmentworks_db_workers", dataKey: workerKey, user, contact: user.email || user.mobile || mobile };
}

function maskContact(contact) {
  const raw = String(contact || "");
  if (raw.includes("@")) {
    const [name, domain] = raw.split("@");
    return `${name.slice(0, 2)}***@${domain || "***"}`;
  }
  const onlyDigits = digits(raw);
  if (onlyDigits.length >= 4) return `******${onlyDigits.slice(-4)}`;
  return "***";
}

function createOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function otpHash(resetId, otp) {
  return createHmac("sha256", sessionSecret).update(`${resetId}:${otp}`).digest("hex");
}

function userIdentity(user) {
  return String(user?.id || user?.workerId || user?.email || user?.mobile || "").trim();
}

function isPasswordTableKey(key) {
  return /^garmentworks_db_(staff|workers)(_|$)/.test(String(key || ""));
}

function hasExistingPasswordMutation(existingData, incomingData) {
  for (const [key, value] of Object.entries(incomingData || {})) {
    if (!isPasswordTableKey(key)) continue;

    const oldValue = parseJsonValue(existingData[key], []);
    const newValue = parseJsonValue(value, []);
    const oldRows = Array.isArray(oldValue) ? oldValue : oldValue && typeof oldValue === "object" ? [oldValue] : [];
    const newRows = Array.isArray(newValue) ? newValue : newValue && typeof newValue === "object" ? [newValue] : [];

    const oldByIdentity = new Map();
    oldRows.forEach((row) => {
      const identity = userIdentity(row);
      if (identity) oldByIdentity.set(identity, row);
    });

    for (const row of newRows) {
      const identity = userIdentity(row);
      if (!identity || !oldByIdentity.has(identity)) continue;
      const oldRow = oldByIdentity.get(identity);
      if (String(oldRow?.password || "") !== String(row?.password || "")) {
        return true;
      }
    }
  }
  return false;
}

async function storeOtp(record) {
  const pool = await getPostgresPool();
  if (pool) {
    await pool.query("DELETE FROM garmentworks_password_reset_otps WHERE expires_at < NOW() OR used_at IS NOT NULL");
    await pool.query(
      `INSERT INTO garmentworks_password_reset_otps
       (reset_id, role, factory_id, user_id, contact, otp_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [record.resetId, record.role, record.factoryId, record.userId, record.contact, record.otpHash, record.expiresAt],
    );
    return;
  }
  memoryOtpStore.set(record.resetId, { ...record, attempts: 0, usedAt: null });
}

async function loadOtp(resetId) {
  const pool = await getPostgresPool();
  if (pool) {
    const result = await pool.query(
      "SELECT * FROM garmentworks_password_reset_otps WHERE reset_id = $1 AND used_at IS NULL",
      [resetId],
    );
    return result.rows[0] || null;
  }
  return memoryOtpStore.get(resetId) || null;
}

async function markOtpAttempt(resetId, used) {
  const pool = await getPostgresPool();
  if (pool) {
    await pool.query(
      `UPDATE garmentworks_password_reset_otps
       SET attempts = attempts + 1, used_at = CASE WHEN $2 THEN NOW() ELSE used_at END
       WHERE reset_id = $1`,
      [resetId, used],
    );
    return;
  }
  const record = memoryOtpStore.get(resetId);
  if (record) {
    record.attempts = Number(record.attempts || 0) + 1;
    if (used) record.usedAt = new Date().toISOString();
  }
}

async function requestPasswordReset(body) {
  const snapshot = await readDatabase();
  const target = findPasswordResetTarget(snapshot.data || {}, body);
  if (!target.ok) return target;

  const resetId = randomBytes(16).toString("hex");
  const otp = createOtp();
  const expiresAt = new Date(Date.now() + otpExpiryMinutes * 60 * 1000).toISOString();
  const record = {
    resetId,
    role: target.role,
    factoryId: target.factory.id,
    userId: userIdentity(target.user),
    contact: String(target.contact || ""),
    otpHash: otpHash(resetId, otp),
    expiresAt,
  };
  await storeOtp(record);
  const delivery = await deliverOtp(record, otp, target);

  return {
    ok: true,
    resetId,
    expiresAt,
    contact: maskContact(target.contact),
    delivery: delivery.delivery,
    message: delivery.message,
    debugOtp: process.env.OTP_DEBUG_RESPONSE === "1" ? otp : undefined,
  };
}

async function verifyPasswordReset(body) {
  const resetId = String(body.resetId || "").trim();
  const otp = String(body.otp || "").trim();
  const newPassword = String(body.password || body.newPassword || "").trim();
  if (!resetId || !otp) return { ok: false, error: "OTP required hai" };
  if (newPassword.length < 4) return { ok: false, error: "New password kam se kam 4 character ka hona chahiye" };

  const record = await loadOtp(resetId);
  if (!record) return { ok: false, error: "OTP invalid ya expire ho gaya" };
  const attempts = Number(record.attempts || 0);
  if (attempts >= otpMaxAttempts) return { ok: false, error: "OTP attempts limit cross ho gayi. New OTP request karo." };
  const expiresAt = new Date(record.expires_at || record.expiresAt).getTime();
  if (!expiresAt || Date.now() > expiresAt) return { ok: false, error: "OTP expire ho gaya. New OTP request karo." };
  const expectedHash = record.otp_hash || record.otpHash;
  if (otpHash(resetId, otp) !== expectedHash) {
    await markOtpAttempt(resetId, false);
    return { ok: false, error: "OTP match nahi hua" };
  }

  const snapshot = await readDatabase();
  const data = snapshot.data || {};
  const factory = findFactoryForLogin(data, record.factory_id || record.factoryId);
  if (!factory) return { ok: false, error: "Factory record nahi mila" };
  const baseKey = record.role === "worker" ? "garmentworks_db_workers" : "garmentworks_db_staff";
  const dataKey = dataKeyForFactory(data, baseKey, factory);
  const rows = parseJsonValue(data[dataKey], []);
  const userId = String(record.user_id || record.userId || "");
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (String(userIdentity(row)) === userId) return { ...row, password: newPassword };
    return row;
  });
  const changed = JSON.stringify(rows) !== JSON.stringify(nextRows);
  if (!changed) return { ok: false, error: "User record nahi mila" };

  const saved = await syncDatabase({ [dataKey]: JSON.stringify(nextRows) }, []);
  await markOtpAttempt(resetId, true);
  return {
    ok: true,
    storage: saved.storage,
    updatedAt: saved.updatedAt,
    message: "Password OTP verify hone ke baad update ho gaya.",
  };
}

async function verifyPasswordResetOtpOnly(body) {
  const resetId = String(body.resetId || "").trim();
  const otp = String(body.otp || "").trim();
  if (!resetId || !otp) return { ok: false, error: "OTP required hai" };

  const record = await loadOtp(resetId);
  if (!record) return { ok: false, error: "OTP invalid ya expire ho gaya" };
  const attempts = Number(record.attempts || 0);
  if (attempts >= otpMaxAttempts) return { ok: false, error: "OTP attempts limit cross ho gayi. New OTP request karo." };
  const expiresAt = new Date(record.expires_at || record.expiresAt).getTime();
  if (!expiresAt || Date.now() > expiresAt) return { ok: false, error: "OTP expire ho gaya. New OTP request karo." };
  const expectedHash = record.otp_hash || record.otpHash;
  if (otpHash(resetId, otp) !== expectedHash) {
    await markOtpAttempt(resetId, false);
    return { ok: false, error: "OTP match nahi hua" };
  }

  await markOtpAttempt(resetId, true);
  return {
    ok: true,
    resetToken: createPasswordResetToken(record),
    message: "OTP verify ho gaya. Ab naya password set karo.",
  };
}

async function changePasswordWithResetToken(body) {
  const token = verifyPasswordResetToken(String(body.resetToken || ""));
  const newPassword = String(body.password || body.newPassword || "").trim();
  if (!token) return { ok: false, error: "Password reset token invalid ya expire ho gaya. New OTP request karo." };
  if (newPassword.length < 4) return { ok: false, error: "New password kam se kam 4 character ka hona chahiye" };

  const snapshot = await readDatabase();
  const data = snapshot.data || {};
  const factory = findFactoryForLogin(data, token.factoryId);
  if (!factory) return { ok: false, error: "Factory record nahi mila" };
  const baseKey = token.role === "worker" ? "garmentworks_db_workers" : "garmentworks_db_staff";
  const dataKey = dataKeyForFactory(data, baseKey, factory);
  const rows = parseJsonValue(data[dataKey], []);
  const nextRows = (Array.isArray(rows) ? rows : []).map((row) => {
    if (String(userIdentity(row)) === String(token.userId || "")) return { ...row, password: newPassword };
    return row;
  });
  const changed = JSON.stringify(rows) !== JSON.stringify(nextRows);
  if (!changed) return { ok: false, error: "User record nahi mila" };

  const saved = await syncDatabase({ [dataKey]: JSON.stringify(nextRows) }, []);
  return {
    ok: true,
    storage: saved.storage,
    updatedAt: saved.updatedAt,
    message: "Password change ho gaya. Ab new password se login karo.",
  };
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
      smtp: hasSmtpConfig() ? "configured" : "not-configured",
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

  if (parsed.pathname === "/api/auth/check-create-account" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const snapshot = await readDatabase();
      const duplicate = findDuplicateCreateAccount(snapshot.data || {}, body);
      if (duplicate) {
        sendJson(response, 409, {
          ok: false,
          duplicate: true,
          factoryCode: duplicate.factoryCode,
          factoryName: duplicate.factoryName,
          error: `Is email/mobile se account pehle se bana hua hai. Naya account create nahi hoga. Old Factory Code: ${duplicate.factoryCode}`,
        });
        return true;
      }
      sendJson(response, 200, { ok: true });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "Duplicate account check failed" });
    }
    return true;
  }

  if (parsed.pathname === "/api/auth/recover-factory-code" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const snapshot = await readDatabase();
      const result = recoverFactoriesByIdentity(snapshot.data || {}, body);
      sendJson(response, result.ok ? 200 : 404, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "Factory code recovery failed" });
    }
    return true;
  }

  if (parsed.pathname === "/api/auth/password-reset/request" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await requestPasswordReset(body);
      sendJson(response, result.ok ? 200 : 401, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "OTP request failed" });
    }
    return true;
  }

  if (parsed.pathname === "/api/auth/password-reset/verify" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await verifyPasswordReset(body);
      sendJson(response, result.ok ? 200 : 401, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "OTP verify failed" });
    }
    return true;
  }

  if (parsed.pathname === "/api/auth/password-reset/verify-otp" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await verifyPasswordResetOtpOnly(body);
      sendJson(response, result.ok ? 200 : 401, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "OTP verify failed" });
    }
    return true;
  }

  if (parsed.pathname === "/api/auth/password-reset/change" && request.method === "POST") {
    try {
      if (!isAllowedOrigin(request)) {
        sendJson(response, 403, { ok: false, error: "Request origin is not allowed" });
        return true;
      }
      const body = await readJsonBody(request);
      const result = await changePasswordWithResetToken(body);
      sendJson(response, result.ok ? 200 : 401, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message || "Password change failed" });
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
      const current = await readDatabase();
      if (hasExistingPasswordMutation(current.data || {}, incomingData)) {
        sendJson(response, 403, {
          ok: false,
          error: "Password change sirf OTP verification ke baad allowed hai.",
        });
        return true;
      }
      const duplicate = findIncomingDuplicateAccount(current.data || {}, incomingData);
      if (duplicate) {
        sendJson(response, 409, {
          ok: false,
          error: `Duplicate account blocked. Is email/mobile ka old Factory Code: ${factoryCodeLabel(duplicate.duplicate.factory)}`,
        });
        return true;
      }
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

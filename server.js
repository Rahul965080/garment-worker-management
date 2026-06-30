import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT || 8080);
const dataRoot = resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || join(root, ".data"));
const databaseFile = join(dataRoot, "garmentworks-db.json");
const databaseKeyPrefix = "garmentworks_";
const maxJsonBodyBytes = 25 * 1024 * 1024;

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

function readDatabase() {
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

function writeDatabase(data) {
  ensureDataRoot();
  const payload = { updatedAt: new Date().toISOString(), data };
  const tempFile = `${databaseFile}.tmp`;
  writeFileSync(tempFile, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tempFile, databaseFile);
  return payload;
}

function isDatabaseKey(key) {
  return typeof key === "string" && key.startsWith(databaseKeyPrefix) && key.length <= 240;
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
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

  if (request.method === "GET" && parsed.pathname === "/api/db/snapshot") {
    const snapshot = readDatabase();
    sendJson(response, 200, {
      ok: true,
      storage: process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR ? "persistent-json-file" : "local-json-file",
      updatedAt: snapshot.updatedAt,
      data: snapshot.data,
    });
    return true;
  }

  if (request.method === "POST" && parsed.pathname === "/api/db/sync") {
    try {
      const body = await readJsonBody(request);
      const snapshot = readDatabase();
      const nextData = { ...snapshot.data };
      const incomingData = body && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
      const removedKeys = Array.isArray(body?.removed) ? body.removed : [];

      for (const [key, value] of Object.entries(incomingData)) {
        if (isDatabaseKey(key)) nextData[key] = String(value);
      }

      for (const key of removedKeys) {
        if (isDatabaseKey(key)) delete nextData[key];
      }

      const saved = writeDatabase(nextData);
      sendJson(response, 200, {
        ok: true,
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
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=3600",
  });
  stream.pipe(response);
  stream.on("error", () => {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Server error");
  });
}

createServer(async (request, response) => {
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

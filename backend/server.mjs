import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.API_PORT || 8787);
const configuredKeys = (process.env.POLARIS_DATASET_API_KEYS || "")
  .split(",")
  .map(key => key.trim())
  .filter(Boolean);
const dataDir = resolve(root, process.env.POLARIS_DATA_DIR || "backend/data");
const adminUsername = process.env.POLARIS_ADMIN_USERNAME || "admin";
const adminPassword = process.env.POLARIS_ADMIN_PASSWORD || "";
const adminApiKey = process.env.POLARIS_ADMIN_API_KEY || "";
const adminTokens = new Set();
const accountRolesFile = "account-roles.json";
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "";
const useSupabase = Boolean(supabaseUrl && supabaseServiceKey);

const datasetFiles = {
  polaris: "polaris-dataset.json",
  infrastructure: "infrastructure-dataset.json",
  utilities: "utilities-dataset.json",
  "data-transfer": "data-transfer-dataset.json",
  alerts: "alerts-dataset.json"
};

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(payload));
}

function authorized(request) {
  if (!configuredKeys.length) return true;
  const header = request.headers["x-api-key"] || request.headers.authorization || "";
  const key = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  return configuredKeys.includes(key);
}

function adminAuthorized(request) {
  const header = request.headers["x-api-key"] || request.headers.authorization || "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  return (adminApiKey && token === adminApiKey) || adminTokens.has(token);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

async function supabaseRpc(name, body) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: supabaseServiceKey, Authorization: `Bearer ${supabaseServiceKey}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Supabase RPC failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function readDataset(moduleName) {
  const filename = datasetFiles[moduleName];
  if (useSupabase) {
    const rows = await supabaseRequest(`datasets?module=eq.${encodeURIComponent(moduleName)}&select=data`);
    if (rows[0]?.data) return rows[0].data;
    const fixture = JSON.parse(await readFile(resolve(root, "assets", filename), "utf8"));
    await supabaseRequest("datasets", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ module: moduleName, data: fixture }) });
    return fixture;
  }
  const storedPath = resolve(dataDir, filename);
  try {
    return JSON.parse(await readFile(storedPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const fixture = JSON.parse(await readFile(resolve(root, "assets", filename), "utf8"));
    await mkdir(dataDir, { recursive: true });
    await writeFile(storedPath, JSON.stringify(fixture, null, 2) + "\n");
    return fixture;
  }
}

async function writeDataset(moduleName, dataset) {
  if (useSupabase) {
    await supabaseRequest("datasets", { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ module: moduleName, data: dataset, updated_by: "admin" }) });
    return;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(resolve(dataDir, datasetFiles[moduleName]), JSON.stringify(dataset, null, 2) + "\n");
}

async function readAccountRoles() {
  if (useSupabase) {
    const rows = await supabaseRequest("login?select=email,username,role");
    return Object.fromEntries(rows.flatMap(user => [
      user.email ? [user.email.toLowerCase(), { role: user.role || "visitor", updatedAt: null }] : [],
      user.username ? [user.username.toLowerCase(), { role: user.role || "visitor", updatedAt: null }] : []
    ]));
  }
  try {
    return JSON.parse(await readFile(resolve(dataDir, accountRolesFile), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {};
  }
}

async function writeAccountRoles(roles) {
  if (useSupabase) {
    const [identifier, assignment] = Object.entries(roles).at(-1) || [];
    if (identifier && assignment) await supabaseRpc("set_login_role", { user_identifier: identifier, user_role: assignment.role || assignment });
    return;
  }
  await mkdir(dataDir, { recursive: true });
  await writeFile(resolve(dataDir, accountRolesFile), JSON.stringify(roles, null, 2) + "\n");
}

function setPath(target, path, value) {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) throw new Error("A dataset path is required.");
  let current = target;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      if (current === null || typeof current !== "object") throw new Error("Invalid dataset path.");
      current[Array.isArray(current) ? Number(part) : part] = value;
      return;
    }
    current = current[Array.isArray(current) ? Number(part) : part];
    if (current === undefined) throw new Error("Invalid dataset path.");
  });
}

async function requestBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

async function datasetResponse(response, requestedModule) {
  const moduleName = requestedModule === "transfer" ? "data-transfer" : requestedModule;
  const filename = datasetFiles[moduleName];
  if (!filename) {
    json(response, 404, { error: "Unknown dataset", available: Object.keys(datasetFiles) });
    return;
  }

  const dataset = await readDataset(moduleName);
  json(response, 200, {
    module: moduleName,
    data: dataset,
    dom: true,
    domAttributes: {
      module: "data-dataset",
      item: "data-dataset-item",
      path: "data-dataset-path"
    }
  }, { "cache-control": "public, max-age=60" });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  response.setHeader("access-control-allow-origin", process.env.CORS_ORIGIN || "http://localhost:5173");

  if (request.method === "OPTIONS") {
    response.writeHead(204, { "access-control-allow-headers": "authorization, x-api-key, content-type", "access-control-allow-methods": "GET, OPTIONS" });
    response.end();
    return;
  }

  if (request.method !== "GET" && request.method !== "POST" && request.method !== "PATCH") {
    json(response, 405, { error: "Method not allowed" }, { allow: "GET, POST, PATCH, OPTIONS" });
    return;
  }

  if (url.pathname === "/api/auth/admin" && request.method === "POST") {
    try {
      const credentials = await requestBody(request);
      if (!adminPassword || credentials.username !== adminUsername || credentials.password !== adminPassword) {
        json(response, 401, { error: "Invalid administrator credentials" });
        return;
      }
      const token = randomBytes(32).toString("hex");
      adminTokens.add(token);
      json(response, 200, { role: "admin", token });
    } catch {
      json(response, 400, { error: "Invalid login request" });
    }
    return;
  }

  if (url.pathname === "/api/auth/account-role" && request.method === "POST") {
    try {
      const payload = await requestBody(request);
      const identifier = String(payload.identifier || "").trim().toLowerCase();
      const roles = await readAccountRoles();
      const assignment = roles[identifier];
      json(response, 200, { role: typeof assignment === "string" ? assignment : assignment?.role || null });
    } catch {
      json(response, 400, { error: "Invalid account role request" });
    }
    return;
  }

  const isMutation = request.method !== "GET";
  const adminRoute = url.pathname === "/api/accounts";
  if (isMutation || adminRoute ? !adminAuthorized(request) : !authorized(request)) {
    json(response, 401, { error: "API key required", hint: "Use x-api-key or Authorization: Bearer <key>." }, { "www-authenticate": "Bearer" });
    return;
  }

  try {
    if (url.pathname === "/api/health") {
      json(response, 200, { ok: true, service: "polaris-ops-api", timestamp: new Date().toISOString() });
      return;
    }

    if (url.pathname === "/api/accounts" && request.method === "PATCH") {
      const payload = await requestBody(request);
      const identifier = String(payload.identifier || "").trim().toLowerCase();
      const role = String(payload.role || "");
      if (!identifier || !["visitor", "researcher", "admin"].includes(role)) {
        json(response, 400, { error: "Identifier and a valid role are required." });
        return;
      }
      const roles = await readAccountRoles();
      roles[identifier] = { role, updatedAt: new Date().toISOString() };
      await writeAccountRoles(roles);
      json(response, 200, { identifier, role, persisted: true });
      return;
    }

    if (url.pathname === "/api/accounts" && request.method === "GET") {
      const roles = await readAccountRoles();
      const accounts = Object.entries(roles).map(([identifier, value]) => ({
        identifier,
        role: typeof value === "string" ? value : value.role,
        updatedAt: typeof value === "string" ? null : value.updatedAt
      }));
      json(response, 200, { accounts });
      return;
    }

    const match = url.pathname.match(/^\/api\/datasets\/([^/]+)$/);
    if (match) {
      if (isMutation) {
        const requestedModule = decodeURIComponent(match[1]);
        const moduleName = requestedModule === "transfer" ? "data-transfer" : requestedModule;
        if (!datasetFiles[moduleName]) {
          json(response, 404, { error: "Unknown dataset", available: Object.keys(datasetFiles) });
          return;
        }
        const payload = await requestBody(request);
        const dataset = await readDataset(moduleName);
        setPath(dataset, payload.path, payload.value);
        await writeDataset(moduleName, dataset);
        json(response, 200, { module: moduleName, data: dataset, path: payload.path, persisted: true });
        return;
      }
      await datasetResponse(response, decodeURIComponent(match[1]));
      return;
    }

    json(response, 404, { error: "Route not found" });
  } catch (error) {
    console.error(error);
    json(response, 500, { error: "Unable to load dataset" });
  }
});

server.listen(port, () => {
  console.log(`Polaris Ops API listening on http://localhost:${port}`);
});
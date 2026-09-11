const assignments = new Map();

function isAdmin(request) {
  const header = request.headers?.["x-api-key"] || request.headers?.authorization || "";
  const suppliedKey = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  return Boolean(process.env.POLARIS_ADMIN_API_KEY && suppliedKey === process.env.POLARIS_ADMIN_API_KEY);
}

export default function handler(request, response) {
  if (!isAdmin(request)) {
    response.status(401).json({ error: "Administrator authorization required" });
    return;
  }

  if (request.method === "GET") {
    response.status(200).json({ accounts: [...assignments.entries()].map(([identifier, value]) => ({ identifier, ...value })) });
    return;
  }

  if (request.method === "PATCH") {
    const identifier = String(request.body?.identifier || "").trim().toLowerCase();
    const role = String(request.body?.role || "");
    if (!identifier || !["visitor", "researcher", "admin"].includes(role)) {
      response.status(400).json({ error: "Identifier and a valid role are required." });
      return;
    }
    const updatedAt = new Date().toISOString();
    assignments.set(identifier, { role, updatedAt });
    response.status(200).json({ identifier, role, updatedAt, persisted: true });
    return;
  }

  response.setHeader("Allow", "GET, PATCH");
  response.status(405).json({ error: "Method not allowed" });
}

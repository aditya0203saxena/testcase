function json(response, status, payload) {
  response.status(status).json(payload);
}

export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "Method not allowed" });
  }

  const { username, password } = request.body || {};
  const expectedUsername = process.env.POLARIS_ADMIN_USERNAME || "admin";
  const expectedPassword = process.env.POLARIS_ADMIN_PASSWORD || "";
  const adminApiKey = process.env.POLARIS_ADMIN_API_KEY || "";

  if (!expectedPassword || username !== expectedUsername || password !== expectedPassword) {
    return json(response, 401, { error: "Invalid administrator credentials" });
  }

  if (!adminApiKey) {
    return json(response, 503, { error: "Administrator API key is not configured on the deployment." });
  }

  return json(response, 200, { role: "admin", token: adminApiKey });
}

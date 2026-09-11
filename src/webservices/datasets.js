const DEFAULT_API_BASE = "/api";

function apiBase() {
  return (globalThis.__POLARIS_API_BASE__ || DEFAULT_API_BASE).replace(/\/$/, "");
}

export async function getDataset(moduleName, options = {}) {
  const response = await fetch(`${apiBase()}/datasets/${encodeURIComponent(moduleName)}`, {
    headers: options.apiKey ? { "x-api-key": options.apiKey } : undefined,
    signal: options.signal
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Dataset request failed (${response.status})`);
  }
  return response.json();
}

export async function getHealth(options = {}) {
  const response = await fetch(`${apiBase()}/health`, { signal: options.signal });
  if (!response.ok) throw new Error(`Health request failed (${response.status})`);
  return response.json();
}
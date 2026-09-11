import polaris from "../../assets/polaris-dataset.json";
import infrastructure from "../../assets/infrastructure-dataset.json";
import utilities from "../../assets/utilities-dataset.json";
import transfer from "../../assets/data-transfer-dataset.json";
import alerts from "../../assets/alerts-dataset.json";

const datasets = { polaris, infrastructure, utilities, "data-transfer": transfer, alerts };

function isAuthorized(request) {
  const configuredKeys = (process.env.POLARIS_DATASET_API_KEYS || "")
    .split(",")
    .map(key => key.trim())
    .filter(Boolean);
  const adminApiKey = process.env.POLARIS_ADMIN_API_KEY || "";
  if (adminApiKey) configuredKeys.push(adminApiKey);
  if (!configuredKeys.length) return true;
  const header = request.headers?.["x-api-key"] || request.headers?.authorization || "";
  const suppliedKey = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : header.trim();
  return configuredKeys.includes(suppliedKey);
}

export default function handler(request, response) {
  if (!isAuthorized(request)) {
    response.setHeader("WWW-Authenticate", "Bearer");
    response.status(401).json({ error: "API key required", hint: "Use x-api-key or Authorization: Bearer <key>." });
    return;
  }
  const requestedModule = request.query?.module;
  const moduleName = requestedModule === "transfer" ? "data-transfer" : requestedModule;
  const dataset = datasets[moduleName];

  if (!dataset) {
    response.status(404).json({
      error: "Unknown dataset",
      available: Object.keys(datasets)
    });
    return;
  }

  // Keep the boolean for existing consumers and publish the DOM binding contract
  // so automation can locate a module, item, or individual dataset field.
  response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
  response.status(200).json({
    module: moduleName,
    data: dataset,
    dom: true,
    domAttributes: {
      module: "data-dataset",
      item: "data-dataset-item",
      path: "data-dataset-path"
    }
  });
}

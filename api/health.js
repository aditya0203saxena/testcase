export default function handler(_request, response) {
  response.status(200).json({
    ok: true,
    service: "polaris-ops-api",
    timestamp: new Date().toISOString()
  });
}

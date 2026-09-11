export default function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Role assignments for production should be stored in Supabase or another durable database.
  response.status(200).json({ role: null });
}

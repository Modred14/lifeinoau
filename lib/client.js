// lib/client.js
export const naira = (kobo) => "₦" + (BigInt(kobo) / 100n).toLocaleString("en-NG");
export async function call(path, body) {
  try {
    const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ...j, status: r.status, failed: !r.ok };
  } catch { return { failed: true, status: 0, error: "No connection. Check your network and try again." }; }
}

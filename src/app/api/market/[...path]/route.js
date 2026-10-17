import { getUserId } from "@/lib/auth";
import { campusRequest, readUpstream, sameOrigin, noStore } from "@/lib/campus-proxy";
const paths = new Set(["summary", "order", "cancel", "rider/queue", "rider/claim", "rider/pickup", "rider/deliver", "rider/cancel"]);
export const dynamic = "force-dynamic";
export async function POST(request, context) {
  if (!sameOrigin(request)) return Response.json({ error: "signed_out" }, { status: 403, headers: noStore });
  if (!await getUserId()) return Response.json({ error: "signed_out" }, { status: 401, headers: noStore });
  const { path } = await context.params;
  const route = path.join("/");
  if (!paths.has(route)) return Response.json({ error: "invalid" }, { status: 404, headers: noStore });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid" }, { status: 400, headers: noStore }); }
  try {
    const { status, data } = await readUpstream(await campusRequest(request, `/market/${route}`, body), `/market/${route}`);
    return Response.json(data, { status, headers: noStore });
  } catch (err) {
    console.error("[market] upstream failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "unavailable" }, { status: 503, headers: noStore });
  }
}
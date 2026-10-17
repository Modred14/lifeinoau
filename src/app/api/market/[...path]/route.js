import { getUserId } from "@/lib/auth";
import { campusRequest, sameOrigin, noStore } from "@/lib/campus-proxy";
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
    const upstream = await campusRequest(request, `/market/${route}`, body);
    return Response.json(await upstream.json(), { status: upstream.status, headers: noStore });
  } catch { return Response.json({ error: "unavailable" }, { status: 503, headers: noStore }); }
}

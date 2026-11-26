// One custom group: GET shows what the caller may see; POST { action } changes it. Roles are checked on the server (lib/customGroupService.js).
import { guard, db, fail, body } from "@/lib/facultyApi";
import { detail, act } from "@/lib/customGroupService";
export const dynamic = "force-dynamic";
export async function GET(req, ctx) {
  const g = await guard("grpd", 90); if (g.res) return g.res;
  try {
    const p = new URL(req.url).searchParams;
    return Response.json(await detail(db, g.uid, (await ctx.params).id, { q: p.get("q") ?? "", offset: p.get("offset") }));
  } catch (e) { return fail(e); }
}
export async function POST(req, ctx) {
  const g = await guard("grpa", 60); if (g.res) return g.res;
  try { return Response.json(await act(db, g.uid, (await ctx.params).id, (await body(req)) ?? {})); } catch (e) { return fail(e); }
}

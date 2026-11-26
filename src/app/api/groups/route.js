// Custom groups: GET lists mine (and my invitations) or, with ?view=discover, the ones I could join. POST creates one.
import { guard, db, fail, body } from "@/lib/facultyApi";
import { myGroups, discover, createGroup } from "@/lib/customGroupService";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const g = await guard("grp", 90); if (g.res) return g.res;
  try {
    const p = new URL(req.url).searchParams;
    return Response.json(p.get("view") === "discover" ? await discover(db, g.uid, { q: p.get("q") ?? "", offset: p.get("offset") }) : await myGroups(db, g.uid));
  } catch (e) { return fail(e); }
}
export async function POST(req) {
  const g = await guard("grpc", 10); if (g.res) return g.res;
  try { return Response.json(await createGroup(db, g.uid, (await body(req)) ?? {})); } catch (e) { return fail(e); }
}

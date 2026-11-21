// src/app/api/faculty-groups/members/route.js: the member directory of the caller's own faculty, searchable (?q=), paged (?offset=).
import { guard, db, fail } from "@/lib/facultyApi";
import { members } from "@/lib/facultyGroupService";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const g = await guard("fgm", 90); if (g.res) return g.res;
  try { const u = new URL(req.url).searchParams; return Response.json(await members(db, g.uid, { q: u.get("q") ?? "", offset: u.get("offset") ?? 0 })); } catch (e) { return fail(e); }
}

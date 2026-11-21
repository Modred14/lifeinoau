// src/app/api/faculty-groups/profile/route.js: a colleague's public profile (?name=). Someone outside the caller's faculty is "not found".
import { guard, db, fail } from "@/lib/facultyApi";
import { memberProfile } from "@/lib/facultyGroupService";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const g = await guard("fgp", 90); if (g.res) return g.res;
  try { return Response.json(await memberProfile(db, g.uid, new URL(req.url).searchParams.get("name"))); } catch (e) { return fail(e); }
}

// src/app/api/faculty-groups/route.js: my faculty group's front page (name, member count, online, offices, unread). Members only: the group is always the caller's own.
import { guard, db, fail } from "@/lib/facultyApi";
import { overview } from "@/lib/facultyGroupService";
export const dynamic = "force-dynamic"; // never cache API responses
export async function GET() {
  const g = await guard("fg", 90); if (g.res) return g.res;
  try { return Response.json(await overview(db, g.uid)); } catch (e) { return fail(e); }
}

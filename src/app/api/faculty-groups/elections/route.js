// src/app/api/faculty-groups/elections/route.js: the faculty-elections screen of the caller's own faculty (read only).
// Voting and registering are the SUG election's own actions (POST /api/sug), so there is one set of election rules.
import { guard, db, fail } from "@/lib/facultyApi";
import { view } from "@/lib/facultyGroupElections";
export const dynamic = "force-dynamic";
export async function GET() {
  const g = await guard("fge", 90); if (g.res) return g.res;
  try { return Response.json(await view(db, g.uid)); } catch (e) { return fail(e); }
}

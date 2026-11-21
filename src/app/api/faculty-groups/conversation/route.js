// src/app/api/faculty-groups/conversation/route.js: start or reopen a private chat with a colleague. The server checks the faculty; the chat itself is the normal one.
import { guard, db, fail, body } from "@/lib/facultyApi";
import { openConversation } from "@/lib/facultyGroupService";
export const dynamic = "force-dynamic";
export async function POST(req) {
  const g = await guard("fgc", 40); if (g.res) return g.res;
  try { return Response.json(await openConversation(db, g.uid, (await body(req)).name)); } catch (e) { return fail(e); }
}

// The group conversations listed in the Messages app: my faculty group and my custom groups, each with its last post and unread count.
import { guard, db, fail } from "@/lib/facultyApi";
import { groupChats } from "@/lib/groupInbox";
export const dynamic = "force-dynamic";
export async function GET() {
  const g = await guard("grpl", 90); if (g.res) return g.res;
  try { return Response.json(await groupChats(db, g.uid)); } catch (e) { return fail(e); }
}

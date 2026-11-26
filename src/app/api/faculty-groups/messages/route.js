// The faculty group's discussion. The group is always the caller's own, derived on the server.
import { guard, db, fail, body } from "@/lib/facultyApi";
import { facultyRoom } from "@/lib/facultyGroupService";
import { readMessages, sendMessage, deleteMessage } from "@/lib/groupChat";
export const dynamic = "force-dynamic";
export async function GET(req) {
  const g = await guard("fgm", 90); if (g.res) return g.res;
  try { return Response.json(await readMessages(db, await facultyRoom(db, g.uid), { before: new URL(req.url).searchParams.get("before") })); } catch (e) { return fail(e); }
}
export async function POST(req) {
  const g = await guard("fgms", 40); if (g.res) return g.res;
  try {
    const b = (await body(req)) ?? {}, room = await facultyRoom(db, g.uid);
    return Response.json(b.action === "delete" ? await deleteMessage(db, room, b.id) : await sendMessage(db, room, b.body));
  } catch (e) { return fail(e); }
}

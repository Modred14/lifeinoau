// A custom group's discussion: members only.
import { guard, db, fail, body } from "@/lib/facultyApi";
import { roomFor } from "@/lib/customGroupService";
import { readMessages, sendMessage, deleteMessage } from "@/lib/groupChat";
export const dynamic = "force-dynamic";
export async function GET(req, ctx) {
  const g = await guard("grpm", 90); if (g.res) return g.res;
  try { return Response.json(await readMessages(db, await roomFor(db, g.uid, (await ctx.params).id), { before: new URL(req.url).searchParams.get("before") })); } catch (e) { return fail(e); }
}
export async function POST(req, ctx) {
  const g = await guard("grpms", 40); if (g.res) return g.res;
  try {
    const b = (await body(req)) ?? {}, room = await roomFor(db, g.uid, (await ctx.params).id);
    return Response.json(b.action === "delete" ? await deleteMessage(db, room, b.id) : await sendMessage(db, room, b.body));
  } catch (e) { return fail(e); }
}

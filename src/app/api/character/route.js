// app/api/character/route.js
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { currentWeek } from "@/lib/clock";
import { drawClass, lifestyle } from "@/lib/rng";
import { PERSONALITIES, allowedHostels, startingTransport } from "@/lib/rules";
import { cleanLook } from "@/lib/look";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const bad = (m, s = 400) => Response.json({ error: m }, { status: s });

// Step 1 of 2 (hostel is chosen after the class reveal). Client sends only choices. The server decides class, stats and money.
export async function POST(req) {
  const userId = await getUserId();
  if (!userId) return bad("Please log in.", 401);
  if (!(await allowed(db, "char:" + userId, 10, 3600000))) return tooMany();
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  if (!/^[A-Za-z0-9 _.-]{3,20}$/.test(name))
    return bad("Name must be 3-20 letters, numbers or spaces.");
  if (!["M", "F"].includes(b.gender)) return bad("Choose a gender.");
  const pers = [...new Set(b.personalities ?? [])];
  if (!pers.length || !pers.every((p) => PERSONALITIES.includes(p)))
    return bad("Pick at least one valid personality.");
  if (
    await db.character.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    })
  )
    return bad("That name is taken.", 409);
  const faculty = await db.faculty.findUnique({
    where: { id: Number(b.facultyId) },
  });
  if (!faculty) return bad("Unknown faculty.");
  const cls = drawClass(); // drawn once and saved immediately: retrying can never reroll it
  const week = await currentWeek(db);
  try {
    const c = await db.$transaction(async (tx) => {
      const ch = await tx.character.create({
        data: {
          userId,
          name,
          gender: b.gender,
          class: cls,
          personalities: pers,
          facultyId: faculty.id,
          hostel: "",
          transport: startingTransport(cls),
          look: cleanLook(b.look, b.gender),
          lastTickWeek: week - 1,
          lastParentCallWeek: week,
          joinedWeek: week,
          sessionStartWeek: week,
          ...lifestyle(pers),
        },
      });
      await tx.account.create({ data: { kind: "PLAYER", characterId: ch.id } });
      return ch; // allowance arrives through catchUp(), which pays week `week` exactly once
    });
    return Response.json({
      class: c.class,
      hostels: allowedHostels(c.class, c.gender, 100),
    });
  } catch (e) {
    if (e.code === "P2002")
      return bad("You already have a character, or that name is taken.", 409);
    throw e;
  }
}

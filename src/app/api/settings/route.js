// src/app/api/settings/route.js
// The Settings screen: GET reads the player's profile, appearance, preferences and account in one go; POST saves ONE kind of change per request.
// The player is always the logged-in one (taken from the signed cookie, never from the request body), so nobody can edit another player through here.
import { PrismaClient } from "@prisma/client";
import { after } from "next/server";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { pingRealtime } from "@/lib/realtimeNotify";
import { GameError, safety } from "@/lib/gameService";
import { getSettingsView, saveName, saveAppearance, saveSettings, changePassword, changeEmail } from "@/lib/profileService";
import { newLifeCheck, startNewLife } from "@/lib/newLifeService";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (m, s = 400) => Response.json({ error: m }, { status: s });
const oops = (e) => {
  if (e instanceof GameError) return fail(e.message, e.status);
  console.error(e);
  return fail("Something went wrong. Try again.", 500);
};

export async function GET() {
  const uid = await getUserId();
  if (!uid) return fail("Please log in.", 401);
  if (!(await allowed(db, "settings:" + uid, 60, 60_000))) return tooMany();
  try { return Response.json(await getSettingsView(db, uid)); } catch (e) { return oops(e); }
}

// action -> [rate-limit key, max, window ms, handler]. Sensitive ones (password, email, new life) are counted in Postgres so every server instance agrees.
const ACTIONS = {
  name: ["name", 10, 3_600_000, (uid, b) => saveName(db, uid, b.name)],
  appearance: ["look", 60, 3_600_000, (uid, b) => saveAppearance(db, uid, { gender: b.gender, look: b.look })],
  preferences: ["prefs", 120, 3_600_000, (uid, b) => saveSettings(db, uid, b.settings)],
  password: ["acct:pw", 5, 3_600_000, (uid, b) => changePassword(db, uid, { current: b.current, next: b.next })],
  email: ["acct:email", 5, 3_600_000, (uid, b) => changeEmail(db, uid, { password: b.password, email: b.email })],
  // "Start a new life": the check only reads; the reset needs the confirmation token and the password, and is counted per account (wrong passwords count too)
  newLifeCheck: ["lifecheck", 30, 60_000, (uid) => newLifeCheck(db, uid)],
  newLife: ["acct:life", 5, 3_600_000, (uid, b) => startNewLife(db, uid, { password: b.password, confirm: b.confirm })],
};

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return fail("Please log in.", 401);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === "unblock") { // the existing block list, managed from here too
      if (!(await allowed(db, "safety:" + uid, 10, 60_000))) return tooMany();
      const { notify, ...out } = await safety(db, uid, { action: "unblock", name: b.name });
      if (notify) after(() => pingRealtime(notify));
      return Response.json(out);
    }
    const a = ACTIONS[b.action];
    if (!a) return fail("Unknown action.");
    const key = a[0].startsWith("acct:") ? a[0] + ":" + uid : "settings:" + a[0] + ":" + uid;
    if (!(await allowed(db, key, a[1], a[2]))) return tooMany();
    return Response.json({ ok: true, ...(await a[3](uid, b)) });
  } catch (e) { return oops(e); }
}

// src/app/api/sug/flyer/route.js: campaign flyers (see lib/sugFlyer.js for the rules).
//   GET  ?view=state          the facts the flyer states + whether a photo is on file (JSON)
//   GET  ?view=photo          the signed-in candidate's OWN stored photograph (image/jpeg), nobody else's
//   GET  (default)            the finished flyer as a PNG; add &download=1 for a file download
//   POST  body = the picture  (Content-Type image/jpeg | image/png | image/webp, at most 4 MB) stores / replaces the candidate's photograph
// The candidate is always the signed-in player's own. A candidateId or position in the query is only compared with the truth (a mismatch is a 403).
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { GameError, getFlyerState, savePhoto, getPhoto, makeFlyer, PHOTO } from "@/lib/sugFlyer";
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // the renderer is native code
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (e) => {
  if (e instanceof GameError) return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
  console.error(e);
  return Response.json({ error: "Something went wrong. Try again." }, { status: 500, headers: NO_STORE });
};
const claimedOf = (u) => ({ candidateId: u.get("candidateId"), position: u.get("position") });
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function GET(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401, headers: NO_STORE });
  const u = new URL(req.url).searchParams, view = u.get("view") ?? "flyer";
  if (!(await allowed(db, "flyer:" + uid, view === "flyer" ? 20 : 60, 60_000))) return tooMany();
  try {
    if (view === "state") return Response.json(await getFlyerState(db, uid, claimedOf(u)), { headers: NO_STORE });
    if (view === "photo") { const p = await getPhoto(db, uid, claimedOf(u)); return new Response(p.bytes, { headers: { ...NO_STORE, "Content-Type": p.mime } }); }
    if (view !== "flyer") return Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
    const f = await makeFlyer(db, uid, claimedOf(u));
    return new Response(f.png, { headers: { ...NO_STORE, "Content-Type": "image/png", "Content-Disposition": `${u.get("download") ? "attachment" : "inline"}; filename="${f.filename}"` } });
  } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401, headers: NO_STORE });
  if (!(await allowed(db, "flyer-up:" + uid, 10, 60_000))) return tooMany();
  try {
    const type = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TYPES.has(type)) throw new GameError("Upload a JPEG, PNG or WebP picture.", 415);
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > PHOTO.maxBytes + 1024) throw new GameError("That picture is too large. Use one under 4 MB.", 413);
    const body = Buffer.from(await req.arrayBuffer());
    return Response.json(await savePhoto(db, uid, body, claimedOf(new URL(req.url).searchParams)), { headers: NO_STORE });
  } catch (e) { return fail(e); }
}

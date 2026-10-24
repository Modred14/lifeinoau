// src/app/api/admin/console/[...path]/route.js
// The administrator console API. One door, in this order: signed in -> role ADMIN (everyone else gets a plain 404, so the console's existence is not
// revealed) -> rate limit -> same-origin check on anything that changes data -> the handler table in lib/adminRoutes.js. The handlers do their own
// validation, audit logging and idempotency. Nothing here trusts the browser: the administrator id always comes from the session cookie.
import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { requireAdmin, AdminError } from "@/lib/admin";
import { GET as READS, POST as WRITES, pick, sameOrigin } from "@/lib/adminRoutes";
export const dynamic = "force-dynamic"; // never cache API responses
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const NO_STORE = { "Cache-Control": "no-store" };
const notFound = () => Response.json({ error: "Not found." }, { status: 404, headers: NO_STORE });

async function handle(req, ctx, table, isWrite) {
  const uid = await getUserId();
  if (!uid) return notFound();
  try {
    await requireAdmin(db, uid);
    if (!(await allowed(db, "admin:" + uid, 300, 60_000))) return tooMany();
    const path = ((await ctx.params).path ?? []).join("/"), run = pick(table, path);
    if (!run) return notFound();
    if (isWrite && !sameOrigin(req.headers.get("origin"), req.headers.get("host"))) return Response.json({ error: "Cross-site request refused." }, { status: 403, headers: NO_STORE });
    const input = isWrite ? await req.json().catch(() => ({})) : Object.fromEntries(new URL(req.url).searchParams);
    if (isWrite && (input === null || typeof input !== "object" || Array.isArray(input))) throw new AdminError("Send a JSON object.");
    const out = await run(db, uid, input);
    if (out.csv != null) return new Response(out.csv, { headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${out.name}"` } });
    return Response.json(out.json, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status, headers: NO_STORE });
    console.error("admin console:", e);
    return Response.json({ error: "Something went wrong. The attempt was recorded if it reached the database." }, { status: 500, headers: NO_STORE });
  }
}
export const GET = (req, ctx) => handle(req, ctx, READS, false);
export const POST = (req, ctx) => handle(req, ctx, WRITES, true);

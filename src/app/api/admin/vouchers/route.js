import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany } from "@/lib/ratelimit";
import { requireAdmin, AdminError } from "@/lib/admin";
import { configureVoucher, createVoucher, listVouchers, setVoucherActive, VoucherError } from "@/lib/voucherService";

export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof VoucherError || e instanceof AdminError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Voucher administration is temporarily unavailable." }, { status: 500 });
};
async function admin(req) {
  const uid = await getUserId();
  if (!uid) throw new AdminError("Not found.", 404);
  if (!(await allowed(db, `admin:${uid}`, 60, 60_000))) throw new AdminError("Too many requests. Wait a moment and try again.", 429);
  await requireAdmin(db, uid);
  return uid;
}

export async function GET(req) {
  try { await admin(req); return Response.json({ vouchers: await listVouchers(db) }); } catch (e) { return fail(e); }
}

/** Create a draft with a new one-time code, or issue one secure management action. */
export async function POST(req) {
  try {
    const uid = await admin(req), body = await req.json().catch(() => ({}));
    if (body.action === "create") return Response.json(await createVoucher(db, uid, body));
    if (body.action === "configure") return Response.json({ voucher: await configureVoucher(db, uid, body.id, body) });
    if (body.action === "activate" || body.action === "deactivate") return Response.json({ voucher: await setVoucherActive(db, uid, body.id, body.action === "activate") });
    throw new VoucherError("Choose create, configure, activate or deactivate.");
  } catch (e) { return fail(e); }
}

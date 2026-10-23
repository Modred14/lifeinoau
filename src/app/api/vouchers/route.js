import { PrismaClient } from "@prisma/client";
import { getUserId } from "@/lib/auth";
import { allowed, tooMany, ipOf } from "@/lib/ratelimit";
import { playerVoucherState, redeemVoucher, VoucherError } from "@/lib/voucherService";

export const dynamic = "force-dynamic";
const db = (globalThis.db ??= new PrismaClient({ transactionOptions: { maxWait: 15_000, timeout: 60_000 } }));
const fail = (e) => {
  if (e instanceof VoucherError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Voucher service is temporarily unavailable." }, { status: 500 });
};

export async function GET() {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, `voucher:${uid}`, 60, 60_000))) return tooMany();
  try { return Response.json(await playerVoucherState(db, uid)); } catch (e) { return fail(e); }
}

export async function POST(req) {
  const uid = await getUserId();
  if (!uid) return Response.json({ error: "Please log in." }, { status: 401 });
  if (!(await allowed(db, `voucher:${uid}`, 12, 60_000)) || !(await allowed(db, `voucher-ip:${ipOf(req)}`, 60, 60_000))) return tooMany();
  try { return Response.json(await redeemVoucher(db, uid, await req.json().catch(() => ({})))); } catch (e) { return fail(e); }
}

// src/instrumentation.js
// Next.js calls register() once when the server starts, before any request.
//
// Every API route does `const db = (globalThis.db ??= new PrismaClient())`, so whichever route runs first creates the one shared client.
// Creating it here first, with longer transaction limits, means all of them reuse it. Prisma's default is 5 seconds for a whole
// interactive transaction (and 2 seconds to wait for a connection), which a game action on a remote database easily goes over:
// each money transfer alone is about 7 queries. When it does, the transaction is closed in the middle and every later query fails
// with "Transaction already closed" or "Transaction not found".
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return; // the Prisma client only runs on the Node.js runtime
  const { PrismaClient } = await import("@prisma/client");
  globalThis.db ??= new PrismaClient({
    transactionOptions: { maxWait: 15_000, timeout: 60_000 },
  });
}
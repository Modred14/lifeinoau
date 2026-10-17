import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "../config/env";
import * as schema from "./schema";

const CLOSE_TIMEOUT_SECONDS = 5;

const client = postgres(env.DATABASE_URL, { max: env.DB_POOL_MAX, onnotice: () => {} });

const base = drizzle(client, { schema });
type Transaction = Parameters<Parameters<typeof base.transaction>[0]>[0];
const transactions = new AsyncLocalStorage<Transaction>();
export const db = new Proxy(base, {
  get(_target, key) {
    const source = transactions.getStore() ?? base;
    const value = Reflect.get(source, key, source);
    return typeof value === "function" ? value.bind(source) : value;
  },
});
export async function worldTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (transactions.getStore()) return fn();
  return base.transaction((tx) => transactions.run(tx, fn));
}

export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), env.MIGRATIONS_DIR) });
}

export async function closeDatabase() {
  await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
}

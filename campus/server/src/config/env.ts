import { z } from "zod";

const DEFAULT_PORT = 2567;
const DEFAULT_DB_POOL_MAX = 10;
const DEFAULT_JOINS_PER_MINUTE_PER_IP = 60;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 40;
const DEFAULT_WS_MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MIGRATIONS_DIR = "drizzle";
const DEFAULT_SESSION_DAYS = 30;
const DEFAULT_SIGN_IN_FAILURES_PER_ACCOUNT = 8;
const DEFAULT_AUTH_REQUESTS_PER_IP = 120;
const DEFAULT_SIGN_UPS_PER_IP = 40;
const DEFAULT_MARKET_DELIVERY_FEE_KOBO = 300 * 100;
const DEFAULT_MARKET_MAX_OPEN_ORDERS = 2;
const DEFAULT_MARKET_ORDERS_PER_HOUR = 6;
const DEFAULT_MARKET_REQUESTS_PER_IP = 600;
const AUTH_PROXY_SECRET_MIN_LENGTH = 32;
const DRAW_SECRET_MIN_LENGTH = 16;

const origin = z.string().refine((value) => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
}, "must be an origin like https://example.com, with no path or trailing slash");

const originList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  )
  .pipe(z.array(origin));

const schema = z
  .object({
    OAU_ONLY: z.literal("true").default("true").transform(() => true),
    SESSION_SECRET: z.string().min(32),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(DEFAULT_PORT),
    DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// connection string"),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(DEFAULT_DB_POOL_MAX),
    MIGRATIONS_DIR: z.string().default(DEFAULT_MIGRATIONS_DIR),
    ALLOWED_ORIGINS: originList,
    JOINS_PER_MINUTE_PER_IP: z.coerce.number().int().min(1).default(DEFAULT_JOINS_PER_MINUTE_PER_IP),
    MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).default(DEFAULT_MAX_CONNECTIONS_PER_IP),
    WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).default(DEFAULT_WS_MAX_PAYLOAD_BYTES),
    CLOCK_OFFSET_MINUTES: z.coerce.number().optional(),
    AUTH_PROXY_SECRET: z.string().min(AUTH_PROXY_SECRET_MIN_LENGTH),
    DRAW_SECRET: z.string().min(DRAW_SECRET_MIN_LENGTH).optional(),
    SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(DEFAULT_SESSION_DAYS),
    SIGN_IN_FAILURES_PER_ACCOUNT: z.coerce.number().int().min(1).default(DEFAULT_SIGN_IN_FAILURES_PER_ACCOUNT),
    AUTH_REQUESTS_PER_IP: z.coerce.number().int().min(1).default(DEFAULT_AUTH_REQUESTS_PER_IP),
    SIGN_UPS_PER_IP: z.coerce.number().int().min(1).default(DEFAULT_SIGN_UPS_PER_IP),
    MARKET_DELIVERY_FEE_KOBO: z.coerce.number().int().min(0).default(DEFAULT_MARKET_DELIVERY_FEE_KOBO),
    MARKET_MAX_OPEN_ORDERS: z.coerce.number().int().min(1).default(DEFAULT_MARKET_MAX_OPEN_ORDERS),
    MARKET_ORDERS_PER_HOUR: z.coerce.number().int().min(1).default(DEFAULT_MARKET_ORDERS_PER_HOUR),
    MARKET_REQUESTS_PER_IP: z.coerce.number().int().min(1).default(DEFAULT_MARKET_REQUESTS_PER_IP),
  })
  .refine((value) => value.NODE_ENV !== "production" || value.AUTH_PROXY_SECRET !== undefined, {
    path: ["AUTH_PROXY_SECRET"],
    message: "is required in production",
  })
  .refine((value) => value.NODE_ENV !== "production" || value.ALLOWED_ORIGINS.length > 0, {
    path: ["ALLOWED_ORIGINS"],
    message: "is required in production",
  });

function readEnv() {
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    console.error(`Invalid environment:\n${problems}\nSee .env.example.`);
    process.exit(1);
  }
  return parsed.data;
}

export const env = readEnv();

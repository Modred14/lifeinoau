import { spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DAYS, MINUTES_PER_DAY, REAL_SECONDS_PER_GAME_MINUTE, formatClock, gameMinutesAt, gameTime, setClockOffset } from "@campuslife/shared";

export const SMOKE_PORT = Number(process.env.SMOKE_PORT ?? 2599);
export const SMOKE_URL = `http://localhost:${SMOKE_PORT}`;
export const OWNER_PORT = 2567;
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOOT_TIMEOUT_MS = 40_000;
const STOP_TIMEOUT_MS = 8_000;
const POLL_MS = 150;
const LOG_KEEP = 4000;
const WEEK_DAYS = 7;
const TROUBLE = /\b(error|failed|unhandled|exception|cannot|could not)\b/i;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const gameMinutesToMs = (minutes: number) => minutes * REAL_SECONDS_PER_GAME_MINUTE * 1000;

export interface WeekMoment {
  cycle: number;
  weekday: number;
  hour: number;
  minute?: number;
}

export const totalAt = (m: WeekMoment) => (m.cycle * WEEK_DAYS + m.weekday) * MINUTES_PER_DAY + m.hour * 60 + (m.minute ?? 0);
export const dayTotal = (dayIndex: number, minuteOfDay: number) => dayIndex * MINUTES_PER_DAY + minuteOfDay;
export const describe = (total: number) => `${formatClock(gameTime(total))} (${DAYS[gameTime(total).weekday]}, day ${gameTime(total).dayIndex}, week ${Math.floor(gameTime(total).dayIndex / WEEK_DAYS)})`;

let offset = 0;
export const realTotalNow = () => gameMinutesAt(Date.now()) - offset;
export const offsetFor = (total: number) => total - realTotalNow();
export const serverTotalNow = () => gameMinutesAt(Date.now());

export function pastCycle(span = 900, floor = 60): number {
  const current = Math.floor(realTotalNow() / (WEEK_DAYS * MINUTES_PER_DAY));
  return floor + (Math.floor(Date.now() / 1000) % Math.max(1, Math.min(span, current - floor - 4)));
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(800, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export const portUp = listening;

let child: ChildProcess | undefined;
let lines: string[] = [];

export const serverLog = (): readonly string[] => lines;
export const serverTrouble = (): string[] => lines.filter((line) => TROUBLE.test(line));

function keep(chunk: Buffer) {
  for (const line of chunk.toString("utf8").split("\n")) if (line.trim()) lines.push(line);
  if (lines.length > LOG_KEEP) lines = lines.slice(-LOG_KEEP / 2);
}

export async function startServer(total: number): Promise<string> {
  if (child) throw new Error("a private server is already running, stop it first");
  if (SMOKE_PORT === OWNER_PORT) throw new Error("refusing to use the owner's dev port");
  if (await listening(SMOKE_PORT)) throw new Error(`port ${SMOKE_PORT} is already in use`);
  setClockOffset(0);
  offset = 0;
  const minutes = offsetFor(total);
  const started = spawn(process.execPath, ["--import", "tsx", "--env-file-if-exists=../.env", "src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(SMOKE_PORT), CLOCK_OFFSET_MINUTES: String(minutes), NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = started;
  started.stdout?.on("data", keep);
  started.stderr?.on("data", keep);
  let exited = false;
  started.once("exit", () => {
    exited = true;
    if (child === started) child = undefined;
  });
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`private server exited while booting:\n${lines.slice(-20).join("\n")}`);
    if (await listening(SMOKE_PORT)) {
      offset = minutes;
      setClockOffset(minutes);
      console.log(`\n== private server on ${SMOKE_PORT}, campus clock ${describe(serverTotalNow())} ==`);
      return SMOKE_URL;
    }
    await sleep(POLL_MS);
  }
  await stopServer();
  throw new Error("private server did not open its port in time");
}

export async function stopServer(): Promise<void> {
  const running = child;
  if (!running) return;
  child = undefined;
  const gone = new Promise<void>((resolve) => running.once("exit", () => resolve()));
  running.kill("SIGTERM");
  const timer = setTimeout(() => running.kill("SIGKILL"), STOP_TIMEOUT_MS);
  await gone;
  clearTimeout(timer);
  for (let i = 0; i < 40 && (await listening(SMOKE_PORT)); i++) await sleep(POLL_MS);
}

process.on("exit", () => child?.kill("SIGKILL"));
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    child?.kill("SIGKILL");
    process.exit(130);
  });

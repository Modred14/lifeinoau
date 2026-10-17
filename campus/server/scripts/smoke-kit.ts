import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";
import postgres from "postgres";
import { INTERIORS, INTERIOR_X0, Msg, PLACES, PX_PER_METER, SPOTS, ServerMsg, USE_DISTANCE, doorPoint, findPath, interiorAt, isBlocked, segmentClear, type JoinOptions, type Point } from "@campuslife/shared";
import { joinWith, smokeAccount } from "./smoke-account";
import { OWNER_PORT, SMOKE_PORT, portUp, realTotalNow, serverTrouble, sleep, stopServer } from "./smoke-clock";

export const OAU = "obafemi-awolowo-university-ile-ife";
export const SAVE_SETTLE_MS = 2500;
const SMOKE_NAME = /^@?smoke_[a-z0-9_]+$/i;
const ARRIVE_PX = 14;
const STALL_MS = 1600;
const WALK_TIMEOUT_MS = 240_000;
const GRID_PX = 10;
const DEFAULT_NEEDS = { food: 80, energy: 85, fun: 70 };
const STALE_STATE_WEEKS = 8;

let failed = 0;
let passed = 0;
export function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (ok) passed++;
  else failed++;
}
export const note = (label: string) => console.log(`NOTE  ${label}`);
export const failures = () => failed;

export async function until(test: () => boolean, timeoutMs: number, stepMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (test()) return true;
    await sleep(stepMs);
  }
  return test();
}

let sql: ReturnType<typeof postgres> | undefined;
function database() {
  if (sql) return sql;
  if (!process.env.DATABASE_URL) {
    try {
      process.loadEnvFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env"));
    } catch {
      /* DATABASE_URL may already be in the environment */
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  sql = postgres(url, { max: 2, onnotice: () => {} });
  return sql;
}

export async function playerIdOf(username: string): Promise<string> {
  if (!SMOKE_NAME.test(username)) throw new Error(`${username} is not a smoke account`);
  const rows = await database()<{ player_id: string }[]>`select player_id from accounts where username = ${username.replace(/^@/, "").toLowerCase()}`;
  if (!rows[0]) throw new Error(`no account row for ${username}`);
  return rows[0].player_id;
}

export interface SaveSeed {
  cash: number;
  at?: Point;
  background?: string;
  energy?: number;
  food?: number;
  fun?: number;
  conditions?: Record<string, unknown>;
}

export async function seedSave(username: string, seed: SaveSeed) {
  const id = await playerIdOf(username);
  const needs = { ...DEFAULT_NEEDS, ...seed };
  const row = {
    id,
    name: username,
    background: seed.background ?? "regular",
    cash: Math.floor(seed.cash),
    food: needs.food,
    energy: needs.energy,
    fun: needs.fun,
    pos_x: seed.at?.x ?? null,
    pos_y: seed.at?.y ?? null,
    conditions: database().json((seed.conditions ?? {}) as never),
  };
  const db = database();
  await db`delete from players where id = ${id}`;
  await db`insert into players ${db(row)}`;
}

export async function patchSave(username: string, patch: { cash?: number; at?: Point; energy?: number; conditions?: Record<string, unknown> }) {
  const id = await playerIdOf(username);
  const set: Record<string, unknown> = {};
  if (patch.cash !== undefined) set.cash = Math.floor(patch.cash);
  if (patch.energy !== undefined) set.energy = patch.energy;
  if (patch.at) {
    set.pos_x = patch.at.x;
    set.pos_y = patch.at.y;
  }
  if (patch.conditions) set.conditions = database().json(patch.conditions as never);
  if (Object.keys(set).length === 0) return;
  const db = database();
  const done = await db`update players set ${db(set)} where id = ${id} returning id`;
  if (done.length !== 1) throw new Error(`no save row to patch for ${username}`);
}

export async function clearPolitics(usernames: readonly string[], cycle: number) {
  const db = database();
  const ids: string[] = [];
  for (const name of usernames) ids.push(await playerIdOf(name));
  for (const span of [cycle - 1, cycle, cycle + 1]) {
    await db`delete from politics_votes where cycle = ${span} and account_id in ${db(ids)}`;
    await db`delete from politics_endorsements where cycle = ${span} and account_id in ${db(ids)}`;
    await db`delete from politics_marks where cycle = ${span} and account_id in ${db(ids)}`;
    await db`delete from politics_offices where cycle = ${span} and account_id in ${db(ids)}`;
    await db`delete from politics_candidacies where cycle = ${span} and account_id in ${db(ids)}`;
  }
  await db`delete from politics_congress_sides where account_id in ${db(ids)} and sitting like ${`%:${cycle}:%`}`;
  await db`delete from politics_campus_states where id like ${`%c:s:${cycle}:%`}`;
}

export async function clearBeds(usernames: readonly string[]) {
  const db = database();
  const ids: string[] = [];
  for (const name of usernames) ids.push(await playerIdOf(name));
  await db`delete from bed_spaces where account_id in ${db(ids)}`;
}

export async function sweepSmokeStates() {
  const stale = realTotalNow() - STALE_STATE_WEEKS * 7 * 24 * 60;
  await database()`delete from politics_campus_states where starts_at < ${stale}`;
}

export async function closeDatabase() {
  await sql?.end({ timeout: 3 });
  sql = undefined;
}

export interface Heard {
  type: string;
  payload: unknown;
}

type CampusRoom = Awaited<ReturnType<typeof joinWith>>;

export class Actor {
  readonly heard: Heard[] = [];

  private constructor(
    readonly username: string,
    readonly room: CampusRoom,
  ) {
    for (const type of new Set(Object.values(ServerMsg))) room.onMessage(type, (payload: unknown) => this.heard.push({ type, payload }));
    room.onMessage("*", () => {});
  }

  static async join(client: Client, url: string, username: string, options: Omit<JoinOptions, "ticket"> = {}): Promise<Actor> {
    if (!SMOKE_NAME.test(username)) throw new Error(`${username} is not a smoke account`);
    const account = await smokeAccount(url, username);
    const room = await joinWith(client, url, account.token, options);
    const actor = new Actor(username, room);
    await until(() => !!room.state.players.get(room.sessionId), 4000);
    await sleep(300);
    return actor;
  }

  get me() {
    const p = this.room.state.players.get(this.room.sessionId);
    if (!p) throw new Error(`${this.username} is not in the room`);
    return p;
  }

  get clock(): number {
    return this.room.state.clock;
  }

  get at(): Point {
    return { x: this.me.x, y: this.me.y };
  }

  get mark(): number {
    return this.heard.length;
  }

  notices(from = 0): string[] {
    return this.heard.slice(from).flatMap((h) => (h.type === ServerMsg.Notice && typeof h.payload === "string" ? [h.payload] : []));
  }

  said(pattern: RegExp, from = 0): string | undefined {
    return this.notices(from).find((text) => pattern.test(text));
  }

  waitNotice(pattern: RegExp, timeoutMs: number, from = 0): Promise<boolean> {
    return until(() => this.said(pattern, from) !== undefined, timeoutMs);
  }

  last<T>(type: string, from = 0): T | undefined {
    for (let i = this.heard.length - 1; i >= from; i--) if (this.heard[i].type === type) return this.heard[i].payload as T;
    return undefined;
  }

  async ask<T>(send: string, payload: unknown, reply: string, timeoutMs = 4000): Promise<T | undefined> {
    const from = this.mark;
    this.room.send(send, payload);
    await until(() => this.last(reply, from) !== undefined, timeoutMs);
    return this.last<T>(reply, from);
  }

  async tell(send: string, payload: unknown, settleMs = 500): Promise<number> {
    const from = this.mark;
    this.room.send(send, payload);
    await sleep(settleMs);
    return from;
  }

  private async leg(to: Point): Promise<boolean> {
    this.room.send(Msg.MoveTo, { x: Math.round(to.x), y: Math.round(to.y) });
    let last = this.at;
    let lastMoved = Date.now();
    const deadline = Date.now() + WALK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(100);
      const here = this.at;
      if (Math.hypot(here.x - to.x, here.y - to.y) <= ARRIVE_PX) return true;
      if (Math.hypot(here.x - last.x, here.y - last.y) > 1) {
        last = here;
        lastMoved = Date.now();
      } else if (Date.now() - lastMoved > STALL_MS) return false;
    }
    return false;
  }

  async walkTo(target: Point, tries = 4): Promise<boolean> {
    for (let attempt = 0; attempt < tries; attempt++) {
      const here = this.at;
      if (Math.hypot(here.x - target.x, here.y - target.y) <= ARRIVE_PX) return true;
      const path = here.x >= INTERIOR_X0 ? roomPath(here, target) : findPath(here, target);
      if (path.length === 0) return false;
      let ok = true;
      for (const wp of path) if (!(ok = await this.leg(wp))) break;
      if (ok) return Math.hypot(this.at.x - target.x, this.at.y - target.y) <= ARRIVE_PX * 3;
    }
    console.log(`NOTE  ${this.username} could not walk from (${this.me.x}, ${this.me.y}) to (${Math.round(target.x)}, ${Math.round(target.y)}), act ${this.me.act}, queue ${this.me.queue}, ride ${this.me.ride}`);
    return false;
  }

  async enter(place: number): Promise<boolean> {
    if (interiorAt(this.me.x, this.me.y)?.place === place) return true;
    const door = PLACES[place].door;
    if (Math.hypot(this.me.x - door.x, this.me.y - door.y) > 5 * PX_PER_METER) await this.walkTo(doorPoint(PLACES[place], isBlocked));
    this.room.send(Msg.Enter, { place });
    return until(() => interiorAt(this.me.x, this.me.y)?.place === place, 3000);
  }

  async exit(): Promise<boolean> {
    this.room.send(Msg.Exit);
    return until(() => this.me.x < INTERIOR_X0, 3000);
  }

  async reach(spot: number): Promise<boolean> {
    const s = SPOTS[spot];
    await this.walkTo({ x: s.sx, y: s.sy });
    return Math.hypot(this.me.x - s.sx, this.me.y - s.sy) <= USE_DISTANCE;
  }

  async use(spot: number, settleMs = 500): Promise<number> {
    return this.tell(Msg.Use, { spot }, settleMs);
  }

  async stand(settleMs = 400) {
    await this.tell(Msg.StopAct, undefined, settleMs);
  }

  async leave() {
    await this.room.leave(true);
  }
}

export function roomPath(from: Point, to: Point): Point[] {
  const it = interiorAt(from.x, from.y);
  if (!it || interiorAt(to.x, to.y) !== it) return [];
  if (segmentClear(from.x, from.y, to.x, to.y)) return [to];
  const cols = Math.ceil(it.w / GRID_PX);
  const rows = Math.ceil(it.h / GRID_PX);
  const cellOf = (p: Point) => ({ c: Math.round((p.x - it.ox) / GRID_PX), r: Math.round((p.y - it.oy) / GRID_PX) });
  const pointOf = (c: number, r: number): Point => ({ x: it.ox + c * GRID_PX, y: it.oy + r * GRID_PX });
  const open = (c: number, r: number) => c >= 0 && r >= 0 && c <= cols && r <= rows && !isBlocked(it.ox + c * GRID_PX, it.oy + r * GRID_PX);
  const key = (c: number, r: number) => r * (cols + 1) + c;
  const start = cellOf(from);
  const prev = new Map<number, number>([[key(start.c, start.r), -1]]);
  const queue: [number, number][] = [[start.c, start.r]];
  let best = start;
  let bestD = Infinity;
  for (let head = 0; head < queue.length; head++) {
    const [c, r] = queue[head];
    const p = pointOf(c, r);
    const d = Math.hypot(p.x - to.x, p.y - to.y);
    if (d < bestD) {
      bestD = d;
      best = { c, r };
    }
    if (d < GRID_PX) break;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (prev.has(key(nc, nr)) || !open(nc, nr)) continue;
      prev.set(key(nc, nr), key(c, r));
      queue.push([nc, nr]);
    }
  }
  const cells: Point[] = [];
  for (let k = key(best.c, best.r); k >= 0; k = prev.get(k) ?? -1) cells.unshift(pointOf(k % (cols + 1), Math.floor(k / (cols + 1))));
  if (!isBlocked(to.x, to.y) && segmentClear(cells[cells.length - 1].x, cells[cells.length - 1].y, to.x, to.y)) cells.push(to);
  const out: Point[] = [];
  let anchor = from;
  for (let i = 0; i < cells.length; i++) {
    const next = cells[i + 1];
    if (next && segmentClear(anchor.x, anchor.y, next.x, next.y)) continue;
    out.push(cells[i]);
    anchor = cells[i];
  }
  return out;
}

export function spotsIn(place: number, test: (spot: (typeof SPOTS)[number]) => boolean): number[] {
  const it = INTERIORS[place];
  if (!it) return [];
  return Array.from({ length: it.spotEnd - it.spotStart }, (_, k) => it.spotStart + k)
    .filter((i) => test(SPOTS[i]))
    .sort((p, q) => Math.hypot(SPOTS[p].sx - it.entry.x, SPOTS[p].sy - it.entry.y) - Math.hypot(SPOTS[q].sx - it.entry.x, SPOTS[q].sy - it.entry.y));
}

export async function reachOne(actor: Actor, spots: readonly number[], skip = 0, tries = 6): Promise<number> {
  for (const spot of spots.slice(skip, skip + tries)) if (await actor.reach(spot)) return spot;
  return -1;
}

export const interiorOf = (place: number) => {
  const it = INTERIORS[place];
  if (!it) throw new Error(`${PLACES[place]?.name ?? place} has no interior`);
  return it;
};

export const placeNamed = (pattern: RegExp) => {
  const i = PLACES.findIndex((p) => pattern.test(p.name));
  if (i < 0) throw new Error(`no place matches ${pattern}`);
  return i;
};

export const outside = (place: number): Point => doorPoint(PLACES[place], isBlocked);

export async function run(name: string, body: () => Promise<void>) {
  let crashed = false;
  try {
    await body();
  } catch (err) {
    crashed = true;
    console.error(`\n${name} stopped early:`, err);
  } finally {
    await stopServer();
    await sweepSmokeStates().catch((err: unknown) => console.error("could not sweep old smoke campus states", err));
    await closeDatabase();
  }
  const trouble = serverTrouble();
  if (trouble.length > 0) console.log(`\nServer log lines worth reading (${trouble.length}):\n${[...new Set(trouble)].slice(0, 25).join("\n")}`);
  const mine = await portUp(SMOKE_PORT);
  const owner = await portUp(OWNER_PORT);
  console.log(`\nport ${SMOKE_PORT} ${mine ? "STILL LISTENING" : "is free"}, owner's port ${OWNER_PORT} ${owner ? "is up" : "is not listening"}`);
  const bad = failed + (crashed ? 1 : 0) + (mine ? 1 : 0);
  console.log(bad ? `\n${name}: ${failed} check(s) failed${crashed ? ", and the script stopped early" : ""} (${passed} passed)` : `\n${name}: all ${passed} checks passed`);
  process.exit(bad ? 1 : 0);
}

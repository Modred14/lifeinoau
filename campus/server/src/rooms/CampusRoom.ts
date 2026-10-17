/**
 * CampusRoom: the shared outdoor campus everyone walks around in.
 *
 * Authoritative model:
 *  - Clients send movement INTENT only (Msg.MoveDir / Msg.MoveTo).
 *  - The server advances every player at a fixed tick using the shared
 *    stepMovement() rules (same collision data the client renders).
 *  - Synced state (positions, facing, names) is patched to clients at the
 *    same rate. Clients never get to say where they are.
 *
 * Building interiors live in this same room (in slots south of the map, see
 * interiors.ts), so entering a building is just an authoritative teleport.
 * The room also runs the campus shuttles/buses and everyone's needs.
 */
import { env } from "../config/env";
import { linkedProfile, OAU_SCHOOL, settleWorld, type WorldStudent } from "../oau/bridge";
import { Room, ServerError, matchMaker, type AuthContext, type Client, type Deferred } from "@colyseus/core";
import {
  ACTS,
  ACT_DURATION,
  ACT_POSE,
  ACT_RATES,
  ALLOWANCE_COOLDOWN,
  BOARD_DISTANCE,
  CAMPUS_ROOM,
  INPUT_BURST,
  INPUT_RATE_PER_SECOND,
  INPUT_VIOLATIONS_BEFORE_KICK,
  INTERIORS,
  IDLE,
  MAX_CLIENTS_PER_ROOM,
  Msg,
  JoinError,
  NEEDS_DECAY,
  PLACES,
  PX_PER_METER,
  RECONNECT_WINDOW_SECONDS,
  SERVER_TICK_MS,
  SPAWN_POINT,
  SPAWN_RADIUS_PX,
  SPOTS,
  STUDY_SECONDS_PER_POINT,
  ServerMsg,
  USE_DISTANCE,
  WORLD_WIDTH_PX,
  MAP_HEIGHT_PX,
  Direction,
  EMOTES,
  EMOTE_COOLDOWN_MS,
  LOOK_COOLDOWN_MS,
  directionFromVector,
  doorPoint,
  interiorAt,
  isBlocked,
  sanitizeLook,
  stepMovement,
  parseDirection,
  BACKGROUNDS,
  BACKGROUND_INFO,
  JOB_DISTANCE,
  JOB_PAY,
  LOAN_AMOUNT,
  LOAN_CUT,
  LOAN_REPAY,
  MOTOR_PARK,
  PLAYER_FARE,
  STOP_FARE,
  TUTOR_MIN_STUDY,
  angleToByte,
  besideCar,
  parseDriveInput,
  sanitizeBackground,
  rollBackground,
  skillPay,
  QUEUES,
  QUEUE_JOIN_DISTANCE,
  COOK_SECONDS,
  CHEAT_BOOST,
  CHEAT_CATCH_CHANCE,
  EXAM_MINUTES,
  paperName,
  EXAM_SECONDS,
  REAL_SECONDS_PER_GAME_MINUTE,
  RUSTICATE_AFTER,
  RUSTICATE_MINUTES,
  eventPlace,
  gradeFor,
  isToc,
  conditionPace,
  sanitizeConditions,
  type ConditionsRecord,
  EVENTS,
  activeEvents,
  gameMinutesAt,
  gameTime,
  DELIVER_DISTANCE,
  DELIVERY_FEE,
  NPC_RIDER_SPEED,
  NPC_RIDER_WAIT,
  ORDER,
  PACK_FOOD,
  PACK_FUN,
  lineFare,
  fareWithFactor,
  orderRefusal,
  queueOfStop,
  queueOfSpot,
  type ActKind,
  type Background,
  LeaveCode,
  type JoinOptions,
  type Mover,
} from "@campuslife/shared";
import { formatHandle } from "@campuslife/shared/account";
import { sanitizeDepartment } from "@campuslife/shared/departments";
import { sanitizeLevel } from "@campuslife/shared/levels";
import { findSchool } from "@campuslife/shared/schools";
import { CampusState, PlayerState, VehicleState } from "./schema/CampusState";
import { RateLimiter } from "../utils/RateLimiter";
import { createVehicles, isDwelling, stepVehicles, vehicleRot, type Vehicle } from "../sim/Transit";
import { DRIVER_SEATS, createDriverSlots, stepDrivers, type DriverSlot } from "../sim/Drivers";
import { HailDesk, loadSchoolTransportRows } from "../sim/Hail";
import { TrafficDesk, type RoadUser } from "../sim/Traffic";
import { KNOCK, PUSH_SPEED, VEHICLE_KINDS, VEHICLE_SPECS, knocks, pushOut, touchesBody, vehicleBody, type VehicleBody } from "@campuslife/shared";
import { NPC, createQueues, npcArrivals, npcMask, type LiveQueue } from "../sim/Queues";
import { findTableSeat, mealServed, serveMeal } from "../sim/Dining";
import { showAnnouncements, showGate } from "../sim/Shows";
import { SocialDesk } from "../sim/shows/desk";
import { buyPhone, initialPhone } from "../sim/Phones";
import { ShoppingDesk } from "../sim/Shopping";
import { PoliticsDesk } from "../sim/Politics";
import { politicsStore } from "../persistence/PoliticsStore";
import { bedStore } from "../persistence/BedStore";
import { Classes } from "../sim/Classes";
import { AdminDesk } from "../sim/Admin";
import { sanitizeAdminRecord, type AdminRecord } from "@campuslife/shared";
import { ConditionsDesk } from "../sim/Conditions";
import { profiles, type Profile } from "../persistence/ProfileStore";
import { redeemTicket, type TicketHolder } from "../auth/tickets";
import { addConnection, allowJoin, ipKey, removeConnection } from "../security/ipLimits";
import { isOriginAllowed } from "../security/origins";
import { OrderState, QueueState } from "./schema/CampusState";

/** Server-only per-player data. Never synced to clients. */
interface SimPlayer extends Mover {
  limiter: RateLimiter;
  lastEmoteAt: number;
  lastLookAt: number;
  /** Seat / counter in use. */
  act?: { spot: number; kind: ActKind; t: number; cheated?: boolean };
  /** Vehicle index while riding. */
  ride: number;
  /** Where on the line the ticket was bought and what was paid, so the rest is charged by distance. */
  boarded?: { s: number; paid: number };
  // Exact needs (synced rounded).
  food: number;
  energy: number;
  fun: number;
  cash: number;
  studySeconds: number;
  study: number;
  lastAllowanceAt: number;
  background: Background;
  school: string;
  level: string;
  department: string;
  skills: { drive: number; cook: number; teach: number };
  debt: number;
  /** Driver slot index while on a driving shift, -1 otherwise. */
  driving: number;
  /** Queue id while standing in a queue, -1 otherwise. */
  queue: number;
  packs: number;
  rider: boolean;
  /** Where this student's progress is saved (null = guest, not saved). */
  profileId: string;
  ip: string;
  attended: number;
  /** Game minutes spent in each of today's lectures (by lecture key). */
  /** Event instances already blessed ("jumat:123"). */
  blessed: Set<string>;
  // Academics
  gpTotal: number;
  exams: number;
  lastGrade: string;
  malpractice: number;
  rusticatedUntil: number;
  weekStudy: number;
  weekAttended: number;
  attendance: Record<string, number[]>;
  admin: AdminRecord;
  /** Exam sittings already written ("exam:<day>"). */
  written: Set<string>;
  tocNoticed: number;
  phone: string;
  conditions: ConditionsRecord;
}

/** Server-side order bookkeeping (status etc. is synced in state.orders). */
interface Order {
  id: string;
  customer: string;
  spot: number;
  status: number;
  rider: string;
  /** ms timestamps */
  readyAt: number;
  /** When a campus rider will arrive (set when no student took it). */
  npcEta?: number;
}

interface SolidVehicle {
  body: VehicleBody;
  label: string;
  knocks: boolean;
  friend?: string;
  halt(): void;
}

const KNOCK_NOTICE = (label: string) => `A ${label.toLowerCase()} knocked you. Watch the road.`;

const NEEDS_TICK_MS = 1000;
const QUEUE_TICK_MS = 500;
const SAVE_EVERY_MS = 30_000;
const RESUME_SEARCH_M = 3;

const JOIN_REFUSED = {
  origin: "This site is not allowed to connect.",
  joins: "Too many joins from your network. Try again in a minute.",
  connections: "Too many players are connected from your network.",
  save: "We couldn't load your save. Try again shortly.",
  signIn: "Sign in to play.",
  elsewhere: "This account just joined from another device.",
};

interface JoinAuth extends TicketHolder {
  ip: string;
}

/** How often to refresh the global "students online" counter. */
const ONLINE_REFRESH_MS = 3000;

export class CampusRoom extends Room<{ state: CampusState }> {
  maxClients = MAX_CLIENTS_PER_ROOM;

  /**
   * Hard safety net enforced by Colyseus itself: a client sending more than
   * this many messages per second is disconnected. The softer per-client
   * token bucket below drops excess input before this kicks in.
   */
  maxMessagesPerSecond = 60;

  /** sessionId -> simulation data (exact float positions + intent). */
  private static playing = new Map<string, { room: CampusRoom; sessionId: string }>();
  private sims = new Map<string, SimPlayer>();
  private shopping = new ShoppingDesk();
  private evicted = new Set<string>();
  private waiting = new Map<string, Deferred<Client>>();
  private vehicles: Vehicle[] = createVehicles();
  /** Student-driven shuttles; synced after the campus-run ones in state.vehicles. */
  private slots: DriverSlot[] = createDriverSlots();
  private hail!: HailDesk;
  private traffic!: TrafficDesk;
  private social = new SocialDesk(showGate, {
    player: (id) => this.sims.get(id),
    players: () => this.sims,
    name: (id) => this.state.players.get(id)?.name ?? "A student",
    send: (id, type, payload) => this.clients.getById(id)?.send(type, payload),
    notice: (id, text) => this.clients.getById(id)?.send(ServerMsg.Notice, text),
    changed: (id) => {
      const sim = this.sims.get(id);
      if (!sim) return;
      this.syncPlayerNeeds(id, sim);
      this.saveProfile(id, sim);
    },
  });
  private politics = new PoliticsDesk({
    store: politicsStore,
    player: (id) => this.sims.get(id),
    players: () => this.sims,
    name: (id) => this.state.players.get(id)?.name ?? "A student",
    send: (id, type, payload) => this.clients.getById(id)?.send(type, payload),
    broadcast: (text) => this.broadcast(ServerMsg.Notice, text),
    changed: (id) => {
      const sim = this.sims.get(id);
      if (!sim) return;
      this.syncPlayerNeeds(id, sim);
      this.saveProfile(id, sim);
    },
    earn: (id, amount) => {
      const sim = this.sims.get(id);
      return sim ? this.earn(id, sim, amount) : 0;
    },
    setOffice: (id, office) => {
      const p = this.state.players.get(id);
      if (p && p.office !== office) p.office = office;
    },
    cheer: (id) => {
      const p = this.state.players.get(id);
      if (!p) return;
      p.emote = EMOTES.indexOf("wave");
      p.emoteSeq = (p.emoteSeq + 1) & 0xff;
    },
  });
  private conditions = new ConditionsDesk({
    notify: (id, text) => this.clients.getById(id)?.send(ServerMsg.Notice, text),
    send: (id, payload) => this.clients.getById(id)?.send(ServerMsg.Conditions, payload),
    status: (id, bits) => {
      const p = this.state.players.get(id);
      if (p && p.status !== bits) p.status = bits;
    },
    readers: (place) => {
      let n = 0;
      for (const sim of this.sims.values()) if (sim.act?.kind === "study" && SPOTS[sim.act.spot].place === place) n++;
      return n;
    },
  });
  private admin = new AdminDesk({
    beds: bedStore,
    notify: (id, text) => this.clients.getById(id)?.send(ServerMsg.Notice, text),
    send: (id, payload) => this.clients.getById(id)?.send(ServerMsg.Admin, payload),
    earn: (id, amount) => {
      const sim = this.sims.get(id);
      return sim ? this.earn(id, sim, amount) : 0;
    },
    changed: (id) => {
      const sim = this.sims.get(id);
      if (!sim) return;
      this.syncPlayerNeeds(id, sim);
      this.saveProfile(id, sim);
    },
    evict: (id, to) => {
      const sim = this.sims.get(id);
      if (!sim) return;
      if (sim.act) this.endAct(id, sim, false);
      this.teleport(id, sim, to);
    },
  });
  private classes = new Classes({
    timetable: (id, now) => {
      const sim = this.sims.get(id);
      return sim ? this.admin.timetable(sim, now) : undefined;
    },
    boycott: () => this.politics.campusEffects().boycott,
    notify: (id, text) => this.clients.getById(id)?.send(ServerMsg.Notice, text),
    send: (id, payload) => this.clients.getById(id)?.send(ServerMsg.Classes, payload),
  });
  private walkers: SimPlayer[] = [];
  private knockedAt = new Map<string, number>();
  private queues: LiveQueue[] = createQueues();
  /** Simulated passengers on each campus-run vehicle. */
  private npcRiders: number[] = this.vehicles.map(() => Math.floor(Math.random() * 6));
  /** Last stop each campus-run vehicle was seen dwelling at (to detect arrivals). */
  private lastStop: number[] = this.vehicles.map(() => -1);
  private orders = new Map<string, Order>();
  private orderSeq = 0;
  /** SPOTS index -> sessionId using it. */
  private spotOwners = new Map<number, string>();

  private operations: Promise<unknown> = Promise.resolve();
  private queuedJobs = new Set<string>();
  private queuedInputs = new Map<string, number>();
  private processing = false;
  private failed = false;
  private departed = new Map<string, Profile>();
  private departedLooks = new Map<string, string>();

  private queueWorld(action: string, mutate: () => unknown, targets?: string[]): Promise<unknown> {
    const periodic = ["campus life", "queue", "delivery", "save"].includes(action);
    if (periodic && this.queuedJobs.has(action)) return this.operations;
    if (periodic) this.queuedJobs.add(action);
    const next = this.operations.then(async () => {
      if (this.failed) return;
      this.processing = true;
      const students = new Map([...this.sims].filter(([id]) => !targets || targets.includes(id)));
      try {
        return await settleWorld(students as unknown as Map<string, WorldStudent>, (id) => {
          const sim = students.get(id);
          return this.departed.get(id) ?? this.profileData(id, sim!);
        }, (id) => this.state.players.get(id)?.look ?? this.departedLooks.get(id), action, async () => {
          const out = await mutate();
          for (const [id, sim] of this.sims) this.syncPlayerNeeds(id, sim);
          return out;
        });
      } catch (err) {
        console.error("[oau] campus operation rolled back", err);
        this.failed = true;
        for (const client of this.clients) client.send(ServerMsg.Notice, "Campus could not save that change. Rejoin to load your saved progress.");
        void this.disconnect();
      } finally {
        this.processing = false;
        this.queuedJobs.delete(action);
        this.departed.clear();
        this.departedLooks.clear();
      }
    });
    this.operations = next.catch(() => undefined);
    return next;
  }

  private registerMessage(type: string, handler: (client: Client, payload: any) => unknown) {
    this.onMessage(type, (client, payload) => {
      const sim = this.sims.get(client.sessionId);
      const movement = (type === Msg.MoveDir || type === Msg.MoveTo) && !sim?.act && (sim?.queue ?? -1) < 0;
      if (movement || type === Msg.Drive || type === "*") {
        if (!this.processing && !this.failed) return handler(client, payload);
        return;
      }
      if (payload && typeof payload === "object" && (payload as { a?: unknown }).a === "status") return handler(client, payload);
      const pending = this.queuedInputs.get(client.sessionId) ?? 0;
      if (pending >= 8) return;
      this.queuedInputs.set(client.sessionId, pending + 1);
      const shared = [Msg.Board, Msg.Alight, Msg.StartDriving, Msg.StopDriving, Msg.Deliver, Msg.RiderDuty, Msg.Politics].includes(type as any);
      void this.queueWorld(`action ${type}`, () => handler(client, payload), shared ? undefined : [client.sessionId]).finally(() => this.queuedInputs.set(client.sessionId, Math.max(0, (this.queuedInputs.get(client.sessionId) ?? 1) - 1)));
    });
  }

  onCreate() {
    this.setState(new CampusState());
    this.state.clock = gameMinutesAt(Date.now());
    this.setPatchRate(SERVER_TICK_MS);
    this.setSimulationInterval((dt) => { if (!this.processing && !this.failed) this.tick(dt); }, SERVER_TICK_MS);

    // ---- Input handlers: validate everything, trust nothing ----

    for (const v of this.vehicles) {
      const vs = new VehicleState();
      vs.line = v.line.id;
      vs.kind = v.line.kind === "bus" ? 1 : 0;
      vs.driver = "";
      vs.active = true;
      this.state.vehicles.push(vs);
    }
    for (let k = 0; k < this.slots.length; k++) {
      const vs = new VehicleState();
      vs.line = 255;
      vs.kind = 0;
      vs.driver = "";
      vs.active = false;
      vs.stop = 255;
      this.state.vehicles.push(vs);
    }
    this.hail = new HailDesk({
      vehicles: this.state.vehicles,
      rider: (id) => this.sims.get(id),
      riders: () => this.sims,
      send: (id, type, payload) => this.clients.getById(id)?.send(type, payload),
      seat: (id, vehicle) => {
        void this.queueWorld("ride boarding", () => {
        const sim = this.sims.get(id);
        if (!sim) return;
        if (sim.act) this.endAct(id, sim, false);
        if (sim.queue >= 0) this.leaveQueue(id, sim);
        sim.ride = vehicle;
        sim.intent = IDLE;
        const p = this.state.players.get(id);
        if (p) p.ride = vehicle + 1;
        }, [id]);
      },
      unseat: (id, to) => {
        void this.queueWorld("ride arrival", () => {
        const sim = this.sims.get(id);
        if (!sim) return;
        this.leaveVehicle(id, sim);
        this.teleport(id, sim, to);
        }, [id]);
      },
      charge: (id, amount) => {
        void this.queueWorld("ride fare", () => {
        const sim = this.sims.get(id);
        if (!sim) return;
        if (sim.cash < amount) { this.leaveVehicle(id, sim); return; }
        sim.cash -= amount;
        this.syncPlayerNeeds(id, sim);
        }, [id]);
      },
      walkers: () => this.walkers,
      loadRows: loadSchoolTransportRows,
    });
    void this.hail.loadOverrides();
    this.traffic = new TrafficDesk({
      vehicles: this.state.vehicles,
      walkers: () => this.walkers,
      others: () => this.roadUsers(),
    });
    for (let i = 0; i < QUEUES.length; i++) this.state.queues.push(new QueueState());
    this.syncVehicles();
    this.syncQueues();

    this.registerMessage(Msg.MoveDir, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0) return;
      const dir = parseDirection(payload.dx, payload.dy);
      if (dir && sim.act) this.endAct(client.sessionId, sim, false); // walking stands you up
      if (dir && sim.queue >= 0) this.leaveQueue(client.sessionId, sim);
      sim.intent = dir ? { kind: "dir", ...dir } : IDLE;
    });

    this.registerMessage(Msg.MoveTo, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0) return;
      const { x, y } = payload;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
      if (sim.act) this.endAct(client.sessionId, sim, false);
      if (sim.queue >= 0) this.leaveQueue(client.sessionId, sim);
      sim.intent = { kind: "target", x: clamp(x, 0, WORLD_WIDTH_PX), y: clamp(y, 0, MAP_HEIGHT_PX) };
    });

    this.registerMessage(Msg.Enter, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0 || interiorAt(sim.x, sim.y)) return;
      const i = payload.place;
      if (typeof i !== "number" || !Number.isInteger(i)) return;
      const place = PLACES[i];
      const inside = INTERIORS[i];
      if (!place || !inside) return;
      if (Math.hypot(sim.x - place.door.x, sim.y - place.door.y) > ENTER_DISTANCE) return;
      if (sim.act) this.endAct(client.sessionId, sim, false);
      this.teleport(client.sessionId, sim, freeNear(inside.entry.x, inside.entry.y, 1.5));
    });

    this.registerMessage(Msg.Exit, (client) => {
      const sim = this.acceptInput(client);
      if (!sim) return;
      const inside = interiorAt(sim.x, sim.y);
      if (!inside) return;
      if (sim.act) this.endAct(client.sessionId, sim, false);
      this.teleport(client.sessionId, sim, doorPoint(PLACES[inside.place], isBlocked));
    });

    this.registerMessage(Msg.Use, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0) return;
      const idx = payload.spot;
      if (typeof idx !== "number" || !Number.isInteger(idx)) return;
      const spot = SPOTS[idx];
      if (!spot || sim.act?.spot === idx || (sim.act?.kind === "eat" && spot.kind === "eat")) return;
      if (Math.hypot(sim.x - spot.sx, sim.y - spot.sy) > USE_DISTANCE) return;
      // A counter with a line: join the back instead of jumping it.
      const qid = queueOfSpot.get(idx);
      if (qid !== undefined && (this.queues[qid].entries.length > 0 || this.spotOwners.has(idx))) return this.joinQueue(client.sessionId, sim, qid);
      this.startUse(client.sessionId, sim, idx);
    });

    this.registerMessage(Msg.Queue, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0 || sim.queue >= 0) return;
      const qid = payload.queue;
      if (typeof qid !== "number" || !Number.isInteger(qid) || !QUEUES[qid]) return;
      const q = QUEUES[qid];
      const lq = this.queues[qid];
      const tail = q.slots[Math.min(lq.entries.length, q.slots.length - 1)];
      if (Math.hypot(sim.x - q.slots[0].x, sim.y - q.slots[0].y) > QUEUE_JOIN_DISTANCE && Math.hypot(sim.x - tail.x, sim.y - tail.y) > QUEUE_JOIN_DISTANCE) return;
      this.joinQueue(client.sessionId, sim, qid);
    });

    this.registerMessage(Msg.Order, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload)) return;
      const idx = payload.spot;
      if (typeof idx !== "number" || !Number.isInteger(idx) || SPOTS[idx]?.kind !== "eat") return;
      if ([...this.orders.values()].some((o) => o.customer === client.sessionId)) return this.notice(client, "You already have an order on the way.");
      const shut = orderRefusal(idx, gameTime(gameMinutesAt(Date.now())));
      if (shut) return this.notice(client, shut);
      const total = (SPOTS[idx].price ?? 0) + DELIVERY_FEE;
      if (sim.cash < total) return this.notice(client, `That's ₦${total.toLocaleString("en-NG")} with delivery. Not enough cash.`);
      sim.cash -= total;
      this.syncPlayerNeeds(client.sessionId, sim);
      const id = String(++this.orderSeq);
      const o: Order = { id, customer: client.sessionId, spot: idx, status: ORDER.cooking, rider: "", readyAt: Date.now() + COOK_SECONDS * 1000 };
      this.orders.set(id, o);
      const os = new OrderState();
      os.customer = o.customer;
      os.spot = idx;
      os.status = o.status;
      os.rider = "";
      this.state.orders.set(id, os);
      this.notice(client, `Order placed: ${SPOTS[idx].label}. The kitchen is on it.`);
    });

    this.registerMessage(Msg.EatPack, (client) => {
      const sim = this.acceptInput(client);
      if (!sim || sim.packs <= 0) return;
      sim.packs--;
      sim.food = clamp(sim.food + PACK_FOOD, 0, 100);
      sim.fun = clamp(sim.fun + PACK_FUN, 0, 100);
      this.syncPlayerNeeds(client.sessionId, sim);
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.emote = EMOTES.indexOf("interact");
        p.emoteSeq = (p.emoteSeq + 1) & 0xff;
      }
    });

    this.registerMessage(Msg.RiderDuty, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload)) return;
      const on = payload.on === true;
      if (on === sim.rider) return;
      sim.rider = on;
      const p = this.state.players.get(client.sessionId);
      if (p) p.rider = on;
      if (!on) this.dropRiderJobs(client.sessionId);
      this.notice(client, on ? "🛵 You're online as a delivery rider. New orders will show up." : "You're offline.");
    });

    this.registerMessage(Msg.Accept, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      const o = isObject(payload) && typeof payload.id === "string" ? this.orders.get(payload.id) : undefined;
      if (!sim || !o || !sim.rider) return;
      if ([...this.orders.values()].some((x) => x.rider === client.sessionId)) return this.notice(client, "Finish your current delivery first.");
      if (o.status !== ORDER.open || o.customer === client.sessionId) return this.notice(client, "Someone else took that order.");
      this.setOrder(o, ORDER.accepted, client.sessionId);
      this.notice(client, `Go and pick up ${SPOTS[o.spot].label}.`);
      const cc = this.clients.getById(o.customer);
      if (cc) this.notice(cc, `🛵 ${this.state.players.get(client.sessionId)?.name ?? "A rider"} is picking up your order.`);
    });

    this.registerMessage(Msg.Pickup, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      const o = isObject(payload) && typeof payload.id === "string" ? this.orders.get(payload.id) : undefined;
      if (!sim || !o || o.rider !== client.sessionId || o.status !== ORDER.accepted) return;
      const v = SPOTS[o.spot];
      if (Math.hypot(sim.x - v.sx, sim.y - v.sy) > USE_DISTANCE) return;
      this.setOrder(o, ORDER.carrying, client.sessionId);
      this.notice(client, `Picked up. Deliver to ${this.state.players.get(o.customer)?.name ?? "the customer"}.`);
    });

    this.registerMessage(Msg.Deliver, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      const o = isObject(payload) && typeof payload.id === "string" ? this.orders.get(payload.id) : undefined;
      if (!sim || !o || o.rider !== client.sessionId || o.status !== ORDER.carrying) return;
      const cust = this.sims.get(o.customer);
      if (!cust || Math.hypot(sim.x - cust.x, sim.y - cust.y) > DELIVER_DISTANCE) return;
      const fee = DELIVERY_FEE * skillPay(sim.skills.drive);
      const got = this.earn(client.sessionId, sim, fee);
      this.gainSkill(client.sessionId, sim, "drive", 1);
      this.notice(client, `💰 Delivered! +₦${Math.round(got)}${got < fee ? ` (₦${Math.round(fee - got)} to your loan)` : ""}.`);
      this.completeOrder(o);
    });

    this.registerMessage(Msg.Cheat, (client) => {
      const sim = this.acceptInput(client);
      const act = sim?.act;
      if (!sim || !act || act.kind !== "exam" || act.cheated) return;
      act.cheated = true;
      if (Math.random() < CHEAT_CATCH_CHANCE) {
        // Caught! The paper is seized and the case goes to the panel.
        sim.malpractice++;
        const name = this.state.players.get(client.sessionId)?.name ?? "A student";
        act.cheated = false;
        act.t = -1; // marks the sitting as voided for endAct
        this.endAct(client.sessionId, sim, true);
        this.broadcast(ServerMsg.Notice, `🚨 ${name} was caught in exam malpractice!`);
        if (sim.malpractice >= RUSTICATE_AFTER) {
          sim.rusticatedUntil = gameMinutesAt(Date.now()) + RUSTICATE_MINUTES;
          this.notice(client, "⚖️ Second malpractice case: you've been RUSTICATED for a week. No lectures or exams.");
        } else {
          this.notice(client, "😬 The invigilator seized your paper. F for this test. One more case and you'll be rusticated.");
        }
        this.syncPlayerNeeds(client.sessionId, sim);
      } else {
        this.notice(client, "🤫 You copied a few answers... the invigilator didn't notice.");
      }
    });

    this.registerMessage(Msg.StopAct, (client) => {
      const sim = this.acceptInput(client);
      if (sim?.act) this.endAct(client.sessionId, sim, false);
      if (sim && sim.queue >= 0) this.leaveQueue(client.sessionId, sim);
    });

    this.registerMessage(Msg.Board, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload) || sim.ride >= 0 || sim.driving >= 0 || interiorAt(sim.x, sim.y)) return;
      const i = payload.vehicle;
      if (typeof i !== "number" || !Number.isInteger(i)) return;
      const veh = this.vehicleAt(i);
      if (!veh) return;
      if (Math.hypot(sim.x - veh.x, sim.y - veh.y) > BOARD_DISTANCE) return;
      if (!veh.stopped) return this.notice(client, "Wait for it to stop.");
      // Campus buses load their stop's queue in order: no jumping the line.
      const ai = this.vehicles[i];
      if (ai && isDwelling(ai)) {
        const qid = queueOfStop.get(`${ai.line.id}:${ai.atStop}`);
        if (qid !== undefined && this.queues[qid].entries.some((e) => e !== client.sessionId)) return this.notice(client, "Join the queue! People dey wait before you.");
      }
      this.boardVehicle(client.sessionId, sim, i);
    });

    this.registerMessage(Msg.Alight, (client) => {
      const sim = this.acceptInput(client);
      if (!sim || sim.ride < 0) return;
      if (this.hail.cancel(client.sessionId)) return;
      const veh = this.vehicleAt(sim.ride);
      if (!veh) return;
      if (!veh.alightAt) return this.notice(client, veh.driverId ? "Tell the driver to stop first." : "Wait for the next stop.");
      const driverId = veh.driverId;
      const line = this.vehicles[sim.ride];
      const boarded = sim.boarded;
      this.leaveVehicle(client.sessionId, sim);
      this.teleport(client.sessionId, sim, freeNear(veh.alightAt.x, veh.alightAt.y, 1));
      if (line && boarded) this.settleLineFare(client, sim, line, boarded);
      // Pay the student driver.
      const driver = driverId ? this.sims.get(driverId) : undefined;
      if (driver && driverId) {
        const fare = Math.min(PLAYER_FARE, Math.floor(sim.cash));
        sim.cash -= fare;
        this.syncPlayerNeeds(client.sessionId, sim);
        if (fare > 0) {
          const got = this.earn(driverId, driver, fare);
          this.notice(client, `You paid ₦${fare} fare.`);
          const dc = this.clients.getById(driverId);
          if (dc) this.notice(dc, `💰 Passenger paid ₦${fare}${got < fare ? ` (₦${fare - got} to your loan)` : ""}.`);
          const slot = this.slots[driver.driving];
          if (slot) slot.earned += got;
        }
      }
    });

    this.registerMessage(Msg.Hail, (client, payload: unknown) => {
      if (this.acceptInput(client)) this.hail.request(client.sessionId, payload);
    });

    this.registerMessage(Msg.HailCancel, (client) => {
      if (this.acceptInput(client)) this.hail.cancel(client.sessionId);
    });

    this.registerMessage(Msg.Transport, (client) => {
      if (this.acceptInput(client)) this.hail.sendConfig(client.sessionId);
    });

    this.registerMessage(Msg.Classes, (client) => {
      const sim = this.acceptInput(client);
      if (sim) this.classes.resend(client.sessionId, sim);
    });

    this.registerMessage(Msg.StartDriving, (client) => {
      const sim = this.acceptInput(client);
      if (!sim || sim.ride >= 0 || sim.driving >= 0 || interiorAt(sim.x, sim.y)) return;
      if (Math.hypot(sim.x - MOTOR_PARK.x, sim.y - MOTOR_PARK.y) > JOB_DISTANCE) return;
      const sp = MOTOR_PARK.spawn;
      if (this.slots.some((sl) => sl.active && Math.hypot(sl.car.x - sp.x, sl.car.y - sp.y) < 9 * PX_PER_METER)) {
        return this.notice(client, "Another driver's bus is at the park. Wait for them to move.");
      }
      const k = this.slots.findIndex((sl) => !sl.active);
      if (k < 0) return this.notice(client, "All the shuttles are out. Try again soon.");
      if (sim.act) this.endAct(client.sessionId, sim, false);
      const slot = this.slots[k];
      slot.active = true;
      slot.driver = client.sessionId;
      slot.car = { x: sp.x, y: sp.y, angle: sp.angle, v: 0 };
      slot.input = { t: 0, s: 0 };
      slot.riders.clear();
      slot.stoppedFor = 0;
      slot.lastPaid.clear();
      slot.earned = 0;
      sim.driving = k;
      sim.intent = IDLE;
      sim.x = sp.x;
      sim.y = sp.y;
      const p = this.state.players.get(client.sessionId);
      if (p) {
        p.driving = this.vehicles.length + k + 1;
        p.x = Math.round(sp.x);
        p.y = Math.round(sp.y);
      }
      this.notice(client, "You're on shift! Stop at bus stops to pick up passengers. W/S or the joystick to drive.");
    });

    this.registerMessage(Msg.Drive, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || sim.driving < 0 || !isObject(payload)) return;
      const input = parseDriveInput(payload.t, payload.s);
      if (input) this.slots[sim.driving].input = input;
    });

    this.registerMessage(Msg.StopDriving, (client) => {
      const sim = this.acceptInput(client);
      if (!sim || sim.driving < 0) return;
      const slot = this.slots[sim.driving];
      if (Math.abs(slot.car.v) > 1 * PX_PER_METER) return this.notice(client, "Stop the bus first.");
      this.endShift(client.sessionId, sim);
    });

    this.registerMessage(Msg.SetLook, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload)) return;
      const now = Date.now();
      if (now - sim.lastLookAt < LOOK_COOLDOWN_MS) return;
      sim.lastLookAt = now;
      const p = this.state.players.get(client.sessionId);
      if (p) p.look = sanitizeLook(payload.look);
    });

    this.registerMessage(Msg.Emote, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim || !isObject(payload)) return;
      const id = payload.id;
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0 || id >= EMOTES.length) return;
      const now = Date.now();
      if (now - sim.lastEmoteAt < EMOTE_COOLDOWN_MS) return;
      sim.lastEmoteAt = now;
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.emote = id;
      p.emoteSeq = (p.emoteSeq + 1) & 0xff;
    });

    this.registerMessage(Msg.BuyPhone, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      const player = this.state.players.get(client.sessionId);
      if (!sim || !player) return;
      const purchase = buyPhone(sim, payload);
      if (purchase.bought) {
        player.phone = sim.phone;
        this.syncPlayerNeeds(client.sessionId, sim);
        this.saveProfile(client.sessionId, sim);
      }
      this.notice(client, purchase.notice);
    });

    this.registerMessage(Msg.BuyItem, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (!sim) return;
      const receipt = this.shopping.buy(sim, payload);
      if (!receipt) return;
      if (receipt.ok) {
        this.syncPlayerNeeds(client.sessionId, sim);
        this.saveProfile(client.sessionId, sim);
      }
      client.send(ServerMsg.Shop, receipt);
    });

    this.registerMessage(Msg.Admin, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (sim) return this.admin.handle(client.sessionId, sim, payload);
    });

    this.registerMessage(Msg.Social, (client, payload: unknown) => {
      if (this.acceptInput(client)) this.social.handle(client.sessionId, payload, gameTime(gameMinutesAt(Date.now())));
    });

    this.registerMessage(Msg.Politics, (client, payload: unknown) => {
      if (this.acceptInput(client)) return this.politics.handle(client.sessionId, payload);
    });

    this.registerMessage(Msg.Conditions, (client, payload: unknown) => {
      const sim = this.acceptInput(client);
      if (sim && this.conditions.resend(client.sessionId, sim, payload, gameTime(gameMinutesAt(Date.now())))) return;
      if (sim && !sim.act && sim.ride < 0 && sim.driving < 0 && sim.queue < 0) this.conditions.act(client.sessionId, sim, payload, gameTime(gameMinutesAt(Date.now())));
    });

    // Ignore any other message type instead of logging noise.
    this.registerMessage("*", () => {});

    this.refreshOnlineCount();
    this.clock.setInterval(() => this.refreshOnlineCount(), ONLINE_REFRESH_MS);
    this.clock.setInterval(() => { void this.queueWorld("campus life", () => this.tickNeeds(NEEDS_TICK_MS / 1000)); }, NEEDS_TICK_MS);
    this.clock.setInterval(() => { void this.queueWorld("queue", () => this.tickQueues(QUEUE_TICK_MS / 1000)); }, QUEUE_TICK_MS);
    this.clock.setInterval(() => { void this.queueWorld("delivery", () => this.tickOrders()); }, 1000);
    // Save everyone's progress regularly (a server crash loses at most this much).
    this.clock.setInterval(() => {
      void this.queueWorld("save", () => undefined);
    }, SAVE_EVERY_MS);
  }

  static async onAuth(_token: string, options: Partial<JoinOptions> | undefined, context: AuthContext): Promise<JoinAuth> {
    if (!isOriginAllowed(context.headers.get("origin"))) throw new ServerError(JoinError.OriginNotAllowed, JOIN_REFUSED.origin);
    const ip = ipKey(context.ip);
    if (!allowJoin(ip)) throw new ServerError(JoinError.TooManyJoins, JOIN_REFUSED.joins);
    const holder = redeemTicket(options?.ticket);
    if (!holder) throw new ServerError(JoinError.SignInRequired, JOIN_REFUSED.signIn);
    return { ...holder, ip };
  }

  async onDispose() {
    if (this.failed) return;
    await this.queueWorld("shutdown refund", () => {
      for (const o of this.orders.values()) {
        const customer = this.sims.get(o.customer);
        if (customer) customer.cash += (SPOTS[o.spot].price ?? 0) + DELIVERY_FEE;
      }
      this.orders.clear();
    });
    await profiles.flush();
  }

  async onJoin(client: Client, options: Partial<JoinOptions> | undefined, auth: JoinAuth) {
    const profileId = auth.playerId;
    const playing = CampusRoom.playing.get(profileId);
    if (playing) await playing.room.evict(playing.sessionId);
    CampusRoom.playing.set(profileId, { room: this, sessionId: client.sessionId });
    if (options?.fresh === true && !env.OAU_ONLY) {
      profiles.delete(profileId);
      await bedStore.release?.(profileId).catch((err: unknown) => console.error("[admin] bed release failed", err));
    }
    let saved: Profile | undefined;
    try {
      saved = await linkedProfile(profileId, await profiles.load(profileId));
    } catch (err) {
      console.error("[profiles] load failed", err);
      this.forget(profileId, client.sessionId);
      throw new ServerError(JoinError.SaveUnavailable, JOIN_REFUSED.save);
    }
    if (CampusRoom.playing.get(profileId)?.sessionId !== client.sessionId) throw new ServerError(LeaveCode.SignedInElsewhere, JOIN_REFUSED.elsewhere);
    const ip = ipKey(auth.ip);
    if (!addConnection(ip)) {
      this.forget(profileId, client.sessionId);
      throw new ServerError(JoinError.TooManyConnections, JOIN_REFUSED.connections);
    }
    const name = env.OAU_ONLY ? auth.username : formatHandle(auth.username);
    const spawn = savedSpawnPoint(saved) ?? findSpawnPoint();

    const player = new PlayerState();
    player.id = client.sessionId;
    player.name = name;
    player.x = Math.round(spawn.x);
    player.y = Math.round(spawn.y);
    player.dir = Direction.S;
    player.look = sanitizeLook(auth.oau?.look ?? options?.look);
    player.emote = 0;
    player.emoteSeq = 0;
    player.act = 0;
    player.spot = 0;
    player.ride = 0;
    player.driving = 0;
    player.queue = 0;
    player.packs = 0;
    player.rider = false;
    player.attended = 0;
    player.cgpa = 0;
    player.exams = 0;
    player.lastGrade = "";
    player.malpractice = 0;
    player.rusticatedUntil = 0;
    player.weekStudy = 0;
    player.weekAttended = 0;
    const background = saved ? sanitizeBackground(saved.background) : rollBackground();
    player.bg = BACKGROUNDS.indexOf(background);
    player.phone = initialPhone(saved?.phone, background);
    const school = findSchool(OAU_SCHOOL);
    const level = auth.oau?.level ?? saved?.level ?? "100L";
    const department = auth.oau?.department ?? saved?.department ?? "oau:Science";
    const sim: SimPlayer = {
      x: spawn.x,
      y: spawn.y,
      dir: Direction.S,
      intent: IDLE,
      limiter: new RateLimiter(INPUT_RATE_PER_SECOND, INPUT_BURST),
      lastEmoteAt: 0,
      lastLookAt: 0,
      ride: -1,
      food: saved?.food ?? 80,
      energy: saved?.energy ?? 85,
      fun: saved?.fun ?? 70,
      cash: saved?.cash ?? BACKGROUND_INFO[background].startCash,
      studySeconds: saved?.studySeconds ?? 0,
      study: saved?.study ?? 0,
      lastAllowanceAt: saved?.lastAllowanceAt ?? 0,
      background,
      school: school?.id ?? "",
      level,
      department,
      skills: { drive: saved?.skills.drive ?? 0, cook: saved?.skills.cook ?? 0, teach: saved?.skills.teach ?? 0 },
      debt: saved?.debt ?? 0,
      driving: -1,
      queue: -1,
      packs: saved?.packs ?? 0,
      rider: false,
      profileId,
      ip,
      attended: saved?.attended ?? 0,
      blessed: new Set(),
      gpTotal: saved?.gpTotal ?? 0,
      exams: saved?.exams ?? 0,
      lastGrade: saved?.lastGrade ?? "",
      malpractice: saved?.malpractice ?? 0,
      rusticatedUntil: saved?.rusticatedUntil ?? 0,
      weekStudy: saved?.weekStudy ?? 0,
      weekAttended: saved?.weekAttended ?? 0,
      attendance: saved?.attendance ?? {},
      admin: sanitizeAdminRecord(saved?.admin),
      written: new Set(saved?.written ?? []),
      tocNoticed: -1,
      phone: player.phone,
      conditions: sanitizeConditions(saved?.conditions),
    };
    syncNeeds(player, sim);
    this.state.players.set(client.sessionId, player);
    this.sims.set(client.sessionId, sim);
    showGate.load(profileId || client.sessionId, saved?.social);
    await this.queueWorld("arrival", async () => {
      this.admin.join(client.sessionId, sim);
      this.classes.join(client.sessionId, sim, gameTime(gameMinutesAt(Date.now())));
      this.conditions.join(client.sessionId, sim, gameTime(gameMinutesAt(Date.now())));
      await this.politics.joined(client.sessionId);
    });
    this.hail.sendConfig(client.sessionId);
    const info = BACKGROUND_INFO[background];
    const greeting = saved
      ? `Welcome back, ${name}! ${info.icon} ${info.label} · ₦${Math.floor(sim.cash).toLocaleString("en-NG")} in your pocket.`
      : `${info.icon} You are a ${info.label}. ${info.blurb}`;
    this.clock.setTimeout(() => this.notice(client, greeting), 1500);

    void this.refreshOnlineCount();
    console.log(`[campus ${this.roomId}] + ${name} (${client.sessionId}): ${this.clients.length} here`);
  }

  /** Connection lost without the client asking to leave (mobile data hiccup, tab sleep...). */
  onDrop(client: Client) {
    // Freeze the avatar while we wait for them to come back.
    const sim = this.sims.get(client.sessionId);
    if (sim) sim.intent = IDLE;
    if (sim && sim.driving >= 0) this.slots[sim.driving].input = { t: -1, s: 0 }; // brake while they're gone
    if (this.evicted.has(client.sessionId)) return;
    const waiting = this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
    this.waiting.set(client.sessionId, waiting);
    waiting
      .catch(() => {
        /* never joined, window expired, signed in elsewhere, or the room is closing: onLeave runs next */
      })
      .finally(() => this.waiting.delete(client.sessionId));
  }

  onReconnect(client: Client) {
    console.log(`[campus ${this.roomId}] ↻ ${client.sessionId} reconnected`);
  }

  /** Final removal: consented leave, or the reconnection window expired. */
  async onLeave(client: Client) {
    this.evicted.delete(client.sessionId);
    if (this.failed) { this.forget(this.sims.get(client.sessionId)?.profileId ?? "", client.sessionId); return; }
    await this.queueWorld("departure", () => this.removePlayer(client.sessionId));
  }

  /** Saves a player and takes them off campus. Safe to call twice for the same session. */
  private removePlayer(sessionId: string) {
    const name = this.state.players.get(sessionId)?.name;
    const sim = this.sims.get(sessionId);
    if (!sim) return;
    // Undelivered food order: refund it (before saving).
    for (const o of this.orders.values()) {
      if (o.customer === sessionId) sim.cash += (SPOTS[o.spot].price ?? 0) + DELIVERY_FEE;
    }
    removeConnection(sim.ip);
    this.forget(sim.profileId, sessionId);
    if (sim.act) this.endAct(sessionId, sim, false);
    if (sim.ride >= 0) this.leaveVehicle(sessionId, sim);
    if (sim.driving >= 0) this.endShift(sessionId, sim);
    if (sim.queue >= 0) this.leaveQueue(sessionId, sim);
    this.dropRiderJobs(sessionId);
    for (const o of [...this.orders.values()]) if (o.customer === sessionId) this.removeOrder(o);
    this.politics.left(sessionId);
    this.departed.set(sessionId, this.profileData(sessionId, sim));
    this.departedLooks.set(sessionId, this.state.players.get(sessionId)?.look ?? "");
    this.state.players.delete(sessionId);
    this.sims.delete(sessionId);
    this.admin.leave(sessionId);
    this.classes.leave(sessionId);
    this.conditions.leave(sessionId);
    this.knockedAt.delete(sessionId);
    showGate.forget(sim.profileId || sessionId);
    void this.refreshOnlineCount();
    console.log(`[campus ${this.roomId}] - ${name ?? sessionId}`);
  }

  private forget(profileId: string, sessionId: string) {
    if (CampusRoom.playing.get(profileId)?.sessionId === sessionId) CampusRoom.playing.delete(profileId);
  }

  /** The same account joined again from somewhere else: save this session and end it, so one save is never open twice. */
  private async evict(sessionId: string) {
    if (!this.sims.has(sessionId)) return;
    this.evicted.add(sessionId);
    await this.queueWorld("session replacement", () => this.removePlayer(sessionId));
    const waiting = this.waiting.get(sessionId);
    if (waiting) waiting.reject(false);
    else this.clients.getById(sessionId)?.leave(LeaveCode.SignedInElsewhere);
  }

  // ---------------------------------------------------------------------

  /** Fixed-rate simulation step. */
  private tick(dtMs: number) {
    // Vehicles first (they stop for anyone on foot outdoors), then riders follow them.
    const walkers: SimPlayer[] = [];
    for (const sim of this.sims.values()) if (sim.ride < 0 && sim.driving < 0 && !interiorAt(sim.x, sim.y)) walkers.push(sim);
    this.walkers = walkers;
    const traffic = [...this.slots.filter((sl) => sl.active).map((sl) => sl.car), ...this.traffic.roadUsers()];
    stepVehicles(this.vehicles, dtMs / 1000, this.politics.roadCrowd(walkers), traffic);
    for (const pick of stepDrivers(this.slots, dtMs / 1000, Date.now())) void this.queueWorld("shuttle wages", () => this.payStopPassengers(pick.slot, pick.stop));
    this.syncVehicles();
    this.hail.step(dtMs / 1000);
    this.traffic.step(dtMs / 1000);

    for (const [id, sim] of this.sims) {
      const p = this.state.players.get(id);
      if (sim.driving >= 0 || sim.ride >= 0) {
        const veh = sim.driving >= 0 ? this.slots[sim.driving].car : (this.vehiclePos(sim.ride) ?? this.hail.position(sim.ride));
        if (!veh) continue;
        sim.x = veh.x;
        sim.y = veh.y;
        if (p) {
          p.x = Math.round(sim.x);
          p.y = Math.round(sim.y);
        }
        continue;
      }
      if (sim.intent.kind === "idle") continue;
      stepMovement(sim, dtMs * conditionPace(p?.status), sim);

      // Copy to synced state. Colyseus only transmits fields whose value changed.
      if (!p) continue;
      p.x = Math.round(sim.x);
      p.y = Math.round(sim.y);
      p.dir = sim.dir;
      if (p.emote !== 0) p.emote = 0; // walking cancels an emote
    }
    this.clearVehicles(dtMs / 1000);
  }

  private roadUsers(): RoadUser[] {
    const out: RoadUser[] = this.vehicles.map((v) => ({ x: v.x, y: v.y, angle: v.angle, speed: v.v }));
    for (const sl of this.slots) if (sl.active) out.push({ x: sl.car.x, y: sl.car.y, angle: sl.car.angle, speed: Math.abs(sl.car.v) });
    for (const h of this.hail.bodies()) out.push({ x: h.body.x, y: h.body.y, angle: h.body.angle, speed: h.body.speed });
    return out;
  }

  private solidVehicles(): SolidVehicle[] {
    const out: SolidVehicle[] = this.vehicles.map((v) => ({
      body: vehicleBody(v.line.kind, v.x, v.y, v.angle, v.v),
      label: v.spec.label,
      knocks: true,
      halt: () => {
        v.v = 0;
      },
    }));
    for (const sl of this.slots) if (sl.active) out.push({ body: vehicleBody("shuttle", sl.car.x, sl.car.y, sl.car.angle, sl.car.v), label: VEHICLE_SPECS.shuttle.label, knocks: false, halt: () => {} });
    for (const h of this.hail.bodies()) out.push({ body: h.body, label: VEHICLE_SPECS[VEHICLE_KINDS[this.state.vehicles[h.index]?.kind ?? 0] ?? "okada"].label, knocks: true, friend: h.rider, halt: h.halt });
    for (const t of this.traffic.bodies()) out.push({ body: t.body, label: VEHICLE_SPECS[VEHICLE_KINDS[this.state.vehicles[t.index]?.kind ?? 0] ?? "keke"].label, knocks: true, halt: t.halt });
    return out;
  }

  private clearVehicles(dt: number) {
    if (!this.walkers.length) return;
    const solids = this.solidVehicles();
    const now = Date.now();
    for (const [id, sim] of this.sims) {
      if (sim.ride >= 0 || sim.driving >= 0 || sim.queue >= 0 || sim.act || interiorAt(sim.x, sim.y)) continue;
      for (const v of solids) {
        if (!touchesBody(v.body, sim.x, sim.y)) continue;
        const knocked = v.knocks && v.friend !== id && knocks(v.body, sim.x, sim.y) && now - (this.knockedAt.get(id) ?? 0) > KNOCK.cooldownMs;
        const to = pushOut(v.body, sim, isBlocked, knocked ? { extra: KNOCK.shove } : { maxStep: PUSH_SPEED * dt });
        if (!to) continue;
        sim.x = to.x;
        sim.y = to.y;
        const p = this.state.players.get(id);
        if (p) {
          p.x = Math.round(sim.x);
          p.y = Math.round(sim.y);
        }
        if (knocked) void this.queueWorld("traffic", () => this.knock(id, sim, v));
        break;
      }
    }
  }

  private knock(id: string, sim: SimPlayer, v: SolidVehicle) {
    this.knockedAt.set(id, Date.now());
    v.halt();
    sim.intent = IDLE;
    sim.energy = Math.max(0, sim.energy - KNOCK.energy);
    sim.fun = Math.max(0, sim.fun - KNOCK.fun);
    this.syncPlayerNeeds(id, sim);
    const client = this.clients.getById(id);
    if (!client) return;
    client.send(ServerMsg.Knock, { x: Math.round(sim.x), y: Math.round(sim.y) });
    this.notice(client, KNOCK_NOTICE(v.label));
  }

  /** Start using a seat / counter / desk (after any queue). */
  private startUse(id: string, sim: SimPlayer, idx: number) {
    const spot = SPOTS[idx];
    const client = this.clients.getById(id);
    const say = (t: string) => client && this.notice(client, t);
    const owner = this.spotOwners.get(idx);
    if (owner && owner !== id) return say("Someone is already using that.");
    if (spot.kind === "eat" && sim.cash < (spot.price ?? 0)) return say("Not enough cash. Withdraw your allowance at a bank ATM, or find work.");
    if (spot.kind === "tutor" && sim.study < TUTOR_MIN_STUDY) {
      return say(`Nobody go pay you to teach yet. Earn ${TUTOR_MIN_STUDY} study points in lectures or the library first.`);
    }
    if (spot.kind === "loan" && sim.debt > 0) return say(`Clear your ₦${sim.debt.toLocaleString("en-NG")} loan first. Repayments come from your job pay.`);
    // A seat in the exam hall during a test or the semester exam = write the paper.
    let kind = spot.kind;
    const now = gameTime(gameMinutesAt(Date.now()));
    const exam = activeEvents(now).find((e) => e.id === "exam");
    if (spot.kind === "study" && exam && spot.place === eventPlace(exam)) {
      if (now.total < sim.rusticatedUntil) return say("You're rusticated. You can't write exams until your suspension ends.");
      const key = `exam:${now.dayIndex}`;
      if (sim.written.has(key)) return say(`You've already written today's ${paperName(now.weekday)}.`);
      sim.written.add(key);
      kind = "exam";
    }
    const gate = showGate.admit(sim.profileId || id, sim, spot, now);
    if (gate.refuse) return say(gate.refuse);
    if (gate.text) say(gate.text);
    if (sim.act) this.endAct(id, sim, false);
    if (sim.queue >= 0) this.leaveQueue(id, sim);
    if (spot.kind === "eat") sim.cash -= spot.price ?? 0;
    const table = findTableSeat(idx, this.spotOwners);
    const used = table ?? idx;
    const at = SPOTS[used];
    sim.act = { spot: used, kind, t: 0 };
    if (table !== undefined) serveMeal(sim.act, idx);
    this.spotOwners.set(used, id);
    const pose = ACT_POSE[at.kind];
    sim.x = pose === "busy" ? at.sx : at.x;
    sim.y = pose === "busy" ? at.sy : at.y;
    sim.dir = directionFromVector(Math.cos(at.face), Math.sin(at.face), sim.dir);
    sim.intent = IDLE;
    const p = this.state.players.get(id);
    if (!p) return;
    p.x = Math.round(sim.x);
    p.y = Math.round(sim.y);
    p.dir = sim.dir;
    p.emote = 0;
    p.act = ACTS.indexOf(kind);
    p.spot = used + 1;
    p.cash = sim.cash;
    if (kind === "exam") say(`📝 ${paperName(now.weekday) === "exam" ? "Exam" : "Test"} started. ${EXAM_MINUTES} minutes. Stand up to submit early.`);
  }

  /** Get on a vehicle (paying the ticket for campus-run lines). */
  private boardVehicle(id: string, sim: SimPlayer, i: number): boolean {
    const veh = this.vehicleAt(i);
    const client = this.clients.getById(id);
    if (!veh) return false;
    const ai = this.vehicles[i];
    const npc = ai ? this.npcRiders[i] : 0;
    if (veh.riders.size + npc >= veh.seats) {
      if (client) this.notice(client, `The ${veh.label} is full. Wait for the next one.`);
      return false;
    }
    const fare = ai ? fareWithFactor(this.hail.lineFare(sim.school, ai.line.id), this.politics.fareFactor()) : 0;
    if (sim.cash < fare) {
      if (client) this.notice(client, `Ticket is ₦${fare}. You no get money. Withdraw at an ATM or find work.`);
      return false;
    }
    if (sim.act) this.endAct(id, sim, false);
    if (sim.queue >= 0) this.leaveQueue(id, sim);
    sim.cash -= fare;
    sim.boarded = ai ? { s: ai.s, paid: fare } : undefined;
    sim.ride = i;
    sim.intent = IDLE;
    veh.riders.add(id);
    const p = this.state.players.get(id);
    if (p) {
      p.ride = i + 1;
      syncNeeds(p, sim);
    }
    if (client) {
      this.notice(
        client,
        veh.driverId
          ? `You entered ${this.state.players.get(veh.driverId)?.name ?? "a student"}'s shuttle. Fare is ₦${PLAYER_FARE} when you get off.`
          : `Conductor: "₦${fare} to enter. The rest na by distance when you drop." You're on the ${veh.label}.`,
      );
    }
    return true;
  }

  private joinQueue(id: string, sim: SimPlayer, qid: number) {
    const q = QUEUES[qid];
    const lq = this.queues[qid];
    const client = this.clients.getById(id);
    if (lq.entries.includes(id)) return;
    if (lq.entries.length >= q.slots.length) {
      if (client) this.notice(client, "The queue is too long. Come back later.");
      return;
    }
    if (q.kind === "counter" && sim.cash < (SPOTS[q.spot!].price ?? 0)) {
      if (client) this.notice(client, "Not enough cash for that.");
      return;
    }
    if (q.kind === "stop" && sim.cash < fareWithFactor(this.hail.lineFare(sim.school, q.line!), this.politics.fareFactor())) {
      if (client) this.notice(client, `Ticket is ₦${fareWithFactor(this.hail.lineFare(sim.school, q.line!), this.politics.fareFactor())}. You no get money.`);
      return;
    }
    if (sim.act) this.endAct(id, sim, false);
    lq.entries.push(id);
    sim.queue = qid;
    const p = this.state.players.get(id);
    if (p) p.queue = qid + 1;
    this.placeQueue(qid);
    const ahead = lq.entries.length - 1;
    if (client && ahead > 0) this.notice(client, `You joined the queue. ${ahead} ${ahead === 1 ? "person" : "people"} ahead of you.`);
    this.syncQueues();
  }

  private leaveQueue(id: string, sim: SimPlayer) {
    const qid = sim.queue;
    sim.queue = -1;
    const p = this.state.players.get(id);
    if (p) p.queue = 0;
    const lq = this.queues[qid];
    if (!lq) return;
    const i = lq.entries.indexOf(id);
    if (i >= 0) lq.entries.splice(i, 1);
    this.placeQueue(qid);
    this.syncQueues();
  }

  /** Stand every queued player on their slot (the line shuffles forward). */
  private placeQueue(qid: number) {
    const q = QUEUES[qid];
    this.queues[qid].entries.forEach((e, i) => {
      if (e === NPC) return;
      const sim = this.sims.get(e);
      const slot = q.slots[Math.min(i, q.slots.length - 1)];
      if (!sim) return;
      sim.x = slot.x;
      sim.y = slot.y;
      sim.intent = IDLE;
      sim.dir = directionFromVector(Math.cos(q.face), Math.sin(q.face), sim.dir);
      const p = this.state.players.get(e);
      if (p) {
        p.x = Math.round(slot.x);
        p.y = Math.round(slot.y);
        p.dir = sim.dir;
      }
    });
  }

  /** Serve counter queues, load buses from stop queues, let simulated students come and go. */
  private tickQueues(dt: number) {
    npcArrivals(this.queues, dt);
    // Buses arriving at a stop: some simulated passengers get off.
    this.vehicles.forEach((v, i) => {
      const at = isDwelling(v) ? v.atStop : -1;
      if (at >= 0 && this.lastStop[i] !== at) {
        const busy = /student union|main gate/i.test(v.line.stops[at].name);
        this.npcRiders[i] = busy ? 0 : Math.floor(this.npcRiders[i] * (0.3 + Math.random() * 0.4));
      }
      this.lastStop[i] = at;
    });
    QUEUES.forEach((q, qi) => {
      const lq = this.queues[qi];
      if (!lq.entries.length) return;
      const head = lq.entries[0];
      if (q.kind === "counter") {
        if (this.spotOwners.has(q.spot!)) return; // someone's being served
        if (head === NPC) {
          if (lq.serving <= 0) lq.serving = 3 + Math.random() * 2;
          lq.serving -= dt;
          if (lq.serving <= 0) {
            lq.entries.shift();
            this.placeQueue(qi);
          }
          return;
        }
        const sim = this.sims.get(head);
        if (!sim) {
          lq.entries.shift();
          return;
        }
        this.startUse(head, sim, q.spot!); // your turn: buy and eat at the counter
        if (sim.queue === qi) this.leaveQueue(head, sim); // couldn't buy (no cash)
        return;
      }
      // Stop queue: board the vehicle waiting here, in order, until it's full.
      const vi = this.vehicles.findIndex((v) => isDwelling(v) && v.line.id === q.line && v.atStop === q.stop);
      if (vi < 0) return;
      const veh = this.vehicles[vi];
      if (veh.riders.size + this.npcRiders[vi] >= veh.spec.seats) return;
      veh.dwell = Math.max(veh.dwell, 1.2); // hold the bus while people climb in
      if (head === NPC) {
        lq.entries.shift();
        this.npcRiders[vi]++;
      } else {
        const sim = this.sims.get(head);
        if (!sim || !this.boardVehicle(head, sim, vi)) {
          lq.entries.shift();
          if (sim) {
            sim.queue = -1;
            const p = this.state.players.get(head);
            if (p) p.queue = 0;
          }
        }
      }
      this.placeQueue(qi);
    });
    this.syncQueues();
  }

  /** Mark a test: preparation, attendance, condition, luck (and copying). */
  private finishExam(id: string, sim: SimPlayer, act: NonNullable<SimPlayer["act"]>, client: Client | undefined) {
    const voided = act.t < 0;
    const done = Math.min(1, Math.max(0, act.t) / EXAM_SECONDS);
    let score = 0;
    if (!voided) {
      score = 28 + Math.min(40, sim.weekStudy * 1.6) + this.classes.testMarks(id, sim, gameTime(gameMinutesAt(Date.now())));
      if (sim.energy < 25) score -= 10; // you slept off in the hall
      if (sim.food < 20) score -= 6; // hungry
      if (act.cheated) score += CHEAT_BOOST;
      score += this.admin.testMarks(id, sim);
      score -= this.classes.penalty(sim);
      score += (Math.random() - 0.5) * 16;
      score = Math.round(Math.max(0, Math.min(100, score * (0.4 + 0.6 * done))));
    }
    const { grade, gp } = gradeFor(score);
    sim.gpTotal += gp;
    sim.exams++;
    this.admin.testDone(id, sim, score);
    sim.lastGrade = grade;
    sim.weekStudy = 0;
    sim.weekAttended = 0;
    this.syncPlayerNeeds(id, sim);
    if (client && !voided) this.notice(client, `📝 Weekly assessment: ${score}% · ${grade}.${done < 1 ? " (You submitted early.)" : ""}`);
  }

  /** Campus-wide heads-ups: events 30 minutes before and at the start. */
  private announced = new Set<string>();
  private announce(t: ReturnType<typeof gameTime>) {
    const say = (key: string, text: string) => {
      if (this.announced.has(key)) return;
      this.announced.add(key);
      if (this.announced.size > 200) this.announced = new Set([...this.announced].slice(-100));
      this.broadcast(ServerMsg.Notice, text);
    };
    for (const e of EVENTS) {
      if (!e.weekdays.includes(t.weekday)) continue;
      if (t.minute >= e.start - 60 && t.minute < e.start) say(`soon:${e.id}:${t.dayIndex}`, `${e.title} starts in an hour.`);
      if (t.minute >= e.start && t.minute < e.start + 5) say(`start:${e.id}:${t.dayIndex}`, `${e.title} has started!`);
    }
    for (const a of showAnnouncements(t)) say(a.key, a.text);
  }

  private saveProfile(id: string, sim: SimPlayer) {
    if (!env.OAU_ONLY) profiles.save(sim.profileId, this.profileData(id, sim));
  }

  private profileData(id: string, sim: SimPlayer): Profile {
    return {
      background: sim.background,
      school: sim.school || undefined,
      level: sim.level || undefined,
      department: sim.department || undefined,
      cash: Math.floor(sim.cash),
      debt: sim.debt,
      study: sim.study,
      studySeconds: sim.studySeconds,
      packs: sim.packs,
      skills: { ...sim.skills },
      food: sim.food,
      energy: sim.energy,
      fun: sim.fun,
      lastAllowanceAt: sim.lastAllowanceAt,
      attended: sim.attended,
      gpTotal: sim.gpTotal,
      exams: sim.exams,
      lastGrade: sim.lastGrade,
      malpractice: sim.malpractice,
      rusticatedUntil: sim.rusticatedUntil,
      weekStudy: sim.weekStudy,
      weekAttended: sim.weekAttended,
      admin: sim.admin,
      attendance: sim.attendance,
      written: [...sim.written].slice(-10),
      x: sim.x,
      y: sim.y,
      phone: sim.phone,
      conditions: { ...sim.conditions },
      social: showGate.save(sim.profileId || id),
      name: this.state.players.get(id)?.name ?? "",
    };
  }

  private setOrder(o: Order, status: number, rider: string) {
    o.status = status;
    o.rider = rider;
    const os = this.state.orders.get(o.id);
    if (os) {
      os.status = status;
      os.rider = rider;
    }
  }

  private removeOrder(o: Order) {
    this.orders.delete(o.id);
    this.state.orders.delete(o.id);
  }

  /** Hand the food to the customer. */
  private completeOrder(o: Order) {
    const cust = this.sims.get(o.customer);
    if (cust) {
      cust.packs = Math.min(9, cust.packs + 1);
      const p = this.state.players.get(o.customer);
      if (p) p.packs = cust.packs;
      const cc = this.clients.getById(o.customer);
      if (cc) this.notice(cc, `🍱 Your ${SPOTS[o.spot].label} has arrived! Eat it from the 📱 Phone.`);
    }
    this.removeOrder(o);
  }

  /** A rider went offline or left: their orders go back on the board. */
  private dropRiderJobs(id: string) {
    for (const o of this.orders.values()) if (o.rider === id) this.setOrder(o, ORDER.open, "");
  }

  /** Kitchens finish cooking; unclaimed orders go to a campus rider; campus riders arrive. */
  private tickOrders() {
    const now = Date.now();
    for (const o of [...this.orders.values()]) {
      if (o.status === ORDER.cooking && now >= o.readyAt) {
        this.setOrder(o, ORDER.open, "");
        const anyRider = [...this.sims.entries()].some(([id, s]) => s.rider && id !== o.customer);
        const cc = this.clients.getById(o.customer);
        if (cc) this.notice(cc, anyRider ? "Your food is ready. Waiting for a rider…" : "Your food is ready. A campus rider is on the way.");
      }
      if (o.status === ORDER.open && !o.npcEta && now >= o.readyAt + NPC_RIDER_WAIT * 1000) {
        const v = SPOTS[o.spot];
        const cust = this.sims.get(o.customer);
        const dist = cust ? Math.hypot(cust.x - v.sx, cust.y - v.sy) : 0;
        o.npcEta = now + Math.min(90, 6 + dist / NPC_RIDER_SPEED) * 1000;
        this.setOrder(o, ORDER.carrying, "");
      }
      if (o.npcEta && o.rider === "" && now >= o.npcEta) {
        const cust = this.sims.get(o.customer);
        const cc = this.clients.getById(o.customer);
        if (cust && cc) cc.send(ServerMsg.Delivered, { x: Math.round(cust.x + 30), y: Math.round(cust.y + 10) });
        this.completeOrder(o);
      }
    }
  }

  private syncQueues() {
    this.queues.forEach((lq, i) => {
      const qs = this.state.queues[i];
      if (qs) qs.mask = npcMask(lq);
    });
  }

  /** Just where a vehicle is (cheap; used every tick for riders). */
  private vehiclePos(i: number): { x: number; y: number } | undefined {
    return this.vehicles[i] ?? (this.slots[i - this.vehicles.length]?.active ? this.slots[i - this.vehicles.length].car : undefined);
  }

  /** A vehicle by its synced index: campus-run first, then student-driven slots. */
  private vehicleAt(i: number):
    | { x: number; y: number; riders: Set<string>; seats: number; label: string; stopped: boolean; alightAt?: { x: number; y: number }; driverId?: string }
    | undefined {
    if (i < 0) return undefined;
    const ai = this.vehicles[i];
    if (ai) {
      const at = isDwelling(ai) ? ai.line.stops[ai.atStop].kerb : undefined;
      return { x: ai.x, y: ai.y, riders: ai.riders, seats: ai.spec.seats, label: ai.line.name, stopped: isDwelling(ai) || ai.v < 0.5 * PX_PER_METER, alightAt: at };
    }
    const slot = this.slots[i - this.vehicles.length];
    if (!slot?.active) return undefined;
    const stopped = Math.abs(slot.car.v) < 0.8 * PX_PER_METER;
    return {
      x: slot.car.x,
      y: slot.car.y,
      riders: slot.riders,
      seats: DRIVER_SEATS,
      label: "shuttle",
      stopped,
      alightAt: stopped ? besideCar(slot.car) : undefined,
      driverId: slot.driver,
    };
  }

  /** Pay money to a player, taking the loan repayment cut first. Returns what reached their pocket. */
  private earn(id: string, sim: SimPlayer, amount: number): number {
    let pocket = Math.round(amount);
    if (sim.debt > 0) {
      const cut = Math.min(sim.debt, Math.round(pocket * LOAN_CUT));
      sim.debt -= cut;
      pocket -= cut;
      if (sim.debt === 0) {
        const c = this.clients.getById(id);
        if (c) this.notice(c, "🎉 Loan fully repaid!");
      }
    }
    sim.cash += pocket;
    this.syncPlayerNeeds(id, sim);
    return pocket;
  }

  private gainSkill(id: string, sim: SimPlayer, skill: "drive" | "cook" | "teach", by: number) {
    sim.skills[skill] = Math.min(100, sim.skills[skill] + by);
    this.syncPlayerNeeds(id, sim);
  }

  private syncPlayerNeeds(id: string, sim: SimPlayer) {
    const p = this.state.players.get(id);
    if (p) syncNeeds(p, sim);
  }

  /** A student driver waited at a stop: the people there pay and climb in. */
  private payStopPassengers(k: number, stopName: string) {
    const slot = this.slots[k];
    const sim = this.sims.get(slot.driver);
    if (!sim) return;
    const heads = 1 + Math.floor(Math.random() * 4);
    const fare = heads * STOP_FARE * skillPay(sim.skills.drive);
    const got = this.earn(slot.driver, sim, fare);
    slot.earned += got;
    this.gainSkill(slot.driver, sim, "drive", 2);
    const c = this.clients.getById(slot.driver);
    if (c) this.notice(c, `🧍 ${heads} passenger${heads > 1 ? "s" : ""} at ${stopName} paid ₦${Math.round(fare)}${got < fare ? ` (₦${Math.round(fare - got)} to your loan)` : ""}.`);
  }

  /** End a driving shift: everyone gets out beside the bus, the slot frees up. */
  private endShift(id: string, sim: SimPlayer) {
    const k = sim.driving;
    const slot = this.slots[k];
    sim.driving = -1;
    if (!slot) return;
    for (const rid of [...slot.riders]) {
      const rs = this.sims.get(rid);
      if (!rs) continue;
      this.leaveVehicle(rid, rs);
      this.teleport(rid, rs, freeNear(besideCar(slot.car).x, besideCar(slot.car).y, 1.5));
      const rc = this.clients.getById(rid);
      if (rc) this.notice(rc, "The driver ended their shift. Everybody down!");
    }
    const out = besideCar(slot.car);
    slot.active = false;
    slot.driver = "";
    slot.riders.clear();
    const p = this.state.players.get(id);
    if (p) p.driving = 0;
    this.teleport(id, sim, out);
    const c = this.clients.getById(id);
    if (c) this.notice(c, `Shift over. You earned ₦${slot.earned.toLocaleString("en-NG")}.`);
  }

  private syncVehicles() {
    this.vehicles.forEach((v, i) => {
      const vs = this.state.vehicles[i];
      if (!vs) return;
      vs.x = Math.round(v.x);
      vs.y = Math.round(v.y);
      vs.rot = vehicleRot(v);
      vs.stop = v.atStop;
      vs.next = v.next;
      vs.riders = v.riders.size + (this.npcRiders[i] ?? 0);
    });
    this.slots.forEach((sl, k) => {
      const vs = this.state.vehicles[this.vehicles.length + k];
      if (!vs) return;
      vs.active = sl.active;
      vs.driver = sl.driver;
      if (!sl.active) return;
      vs.x = Math.round(sl.car.x);
      vs.y = Math.round(sl.car.y);
      vs.rot = angleToByte(sl.car.angle);
      vs.riders = sl.riders.size;
    });
  }

  /** Needs decay, activity effects, timed activities finishing. Runs once a second. */
  private async tickNeeds(dt: number) {
    const now = gameTime(gameMinutesAt(Date.now()));
    this.state.clock = now.total;
    this.announce(now);
    await this.politics.tick();
    this.social.tick(now);
    const events = activeEvents(now);
    for (const [id, sim] of this.sims) {
      this.admin.tick(id, sim, now, dt);
      this.classes.tick(id, sim, now, dt, sim.act?.kind === "study" ? SPOTS[sim.act.spot].place : -1);
      this.conditions.tick(id, sim, sim.act ? SPOTS[sim.act.spot] : undefined, sim.act?.kind, now, dt);
      sim.food -= NEEDS_DECAY.food * dt;
      sim.energy -= NEEDS_DECAY.energy * dt;
      sim.fun -= NEEDS_DECAY.fun * dt;
      const act = sim.act;
      if (act) {
        act.t += dt;
        const rate = ACT_RATES[act.kind];
        sim.food += (rate.food ?? 0) * dt;
        sim.energy += (rate.energy ?? 0) * dt;
        sim.fun += (rate.fun ?? 0) * dt;
        const place = SPOTS[act.spot].place;
        // Praying at the right place during Jumat / Sunday service: blessings (once per event).
        if (act.kind === "pray" && place >= 0) {
          const tpl = INTERIORS[place]?.template.id;
          for (const ev of events) {
            const key = `${ev.id}:${now.dayIndex}`;
            const right = (ev.id === "jumat" && tpl === "mosque") || (ev.id === "service" && tpl === "chapel");
            if (!right || sim.blessed.has(key) || act.t < 20) continue;
            sim.blessed.add(key);
            sim.fun = clamp(sim.fun + 30, 0, 100);
            sim.energy = clamp(sim.energy + 10, 0, 100);
            const c = this.clients.getById(id);
            if (c) this.notice(c, ev.id === "jumat" ? "🕌 Jumu'ah Mubarak! You feel refreshed. +30 fun" : "⛪ Blessings! The service lifted your spirit. +30 fun");
          }
        }
        // Dancing during the SUB night party is way more fun.
        if (act.kind === "dance" && events.some((e) => e.id === "party") && INTERIORS[place]?.template.id === "foodcourt") {
          sim.fun += 1.2 * dt;
        }
        const show = this.conditions.blackout(id, SPOTS[act.spot], now) ? undefined : showGate.tick(sim.profileId || id, sim, act.kind, SPOTS[act.spot], now, dt);
        if (show) {
          const c = this.clients.getById(id);
          if (c) for (const text of show.notices) this.notice(c, text);
          if (show.leave) this.endAct(id, sim, false);
        }
        // Crash reading (TOC) late at night: faster study, more tired.
        if ((act.kind === "study" || act.kind === "tutor") && isToc(now.minute)) {
          sim.studySeconds += 0.5 * dt;
          sim.energy -= 0.15 * dt;
          if (sim.tocNoticed !== now.dayIndex) {
            sim.tocNoticed = now.dayIndex;
            const c = this.clients.getById(id);
            if (c) this.notice(c, "📖 TOC mode: night reading counts 1.5x, but you'll be tired.");
          }
        }
        if (act.kind === "study") {
          sim.studySeconds += dt;
          if (sim.studySeconds >= STUDY_SECONDS_PER_POINT) {
            sim.studySeconds -= STUDY_SECONDS_PER_POINT;
            sim.study = Math.min(65535, sim.study + 1);
            sim.weekStudy = Math.min(65535, sim.weekStudy + 1);
          }
        }
        const limit = ACT_DURATION[act.kind];
        if (limit !== undefined && act.t >= limit) this.endAct(id, sim, true);
        else if (act.kind === "sleep" && sim.energy >= 100) this.endAct(id, sim, true);
      }
      sim.food = clamp(sim.food, 0, 100);
      sim.energy = clamp(sim.energy, 0, 100);
      sim.fun = clamp(sim.fun, 0, 100);
      const p = this.state.players.get(id);
      if (p) syncNeeds(p, sim);
    }
  }

  /** Stop using a seat / counter. `done` = it finished by itself (food eaten, cash out...). */
  private endAct(id: string, sim: SimPlayer, done: boolean) {
    const act = sim.act;
    if (!act) return;
    sim.act = undefined;
    if (this.spotOwners.get(act.spot) === id) this.spotOwners.delete(act.spot);
    const spot = SPOTS[act.spot];
    const client = this.clients.getById(id);
    if (act.kind === "exam") this.finishExam(id, sim, act, client);
    const meal = mealServed(act, spot);
    if (meal && (done || act.t >= 2)) {
      sim.food = clamp(sim.food + (meal.food ?? 0), 0, 100);
      sim.fun = clamp(sim.fun + (meal.fun ?? 0), 0, 100);
      if (client) this.notice(client, `Yum! ${meal.label} hit the spot.`);
    }
    if (spot.kind === "atm" && done && env.OAU_ONLY && client) this.notice(client, `Wallet balance: ₦${Math.floor(sim.cash).toLocaleString("en-NG")}. Your family allowance arrives through OAU Life.`);
    if (spot.kind === "atm" && done && !env.OAU_ONLY) {
      const now = Date.now();
      const wait = ALLOWANCE_COOLDOWN - (now - sim.lastAllowanceAt) / 1000;
      const allowance = BACKGROUND_INFO[sim.background].allowance;
      if (wait <= 0) {
        sim.lastAllowanceAt = now;
        sim.cash += allowance;
        if (client) this.notice(client, sim.background === "nepo" ? `💸 Daddy don send ₦${allowance.toLocaleString("en-NG")}!` : `₦${allowance.toLocaleString("en-NG")} allowance withdrawn.`);
      } else if (client) this.notice(client, `Your next allowance lands in ${Math.ceil(wait)}s.`);
    }
    if ((spot.kind === "cook" || spot.kind === "tutor") && done) {
      const skill = spot.kind === "cook" ? "cook" : "teach";
      const pay = JOB_PAY[spot.kind] * skillPay(sim.skills[skill]);
      const got = this.earn(id, sim, pay);
      sim.skills[skill] = Math.min(100, sim.skills[skill] + 3);
      if (client) this.notice(client, `💰 Shift done: ₦${Math.round(pay)}${got < pay ? ` (₦${Math.round(pay - got)} to your loan)` : ""}. ${skill === "cook" ? "Cooking" : "Teaching"} skill up!`);
    }
    if (spot.kind === "loan" && done && sim.debt === 0) {
      sim.cash += LOAN_AMOUNT;
      sim.debt = LOAN_REPAY;
      if (client) this.notice(client, `₦${LOAN_AMOUNT.toLocaleString("en-NG")} loan collected. You owe ₦${LOAN_REPAY.toLocaleString("en-NG")}; ${Math.round(LOAN_CUT * 100)}% of job pay goes to repayment.`);
    }
    if (spot.kind === "sleep" && done && client) this.notice(client, "You woke up fully rested.");
    // Seats and beds: step off to the free standing point.
    if (ACT_POSE[spot.kind] !== "busy") {
      sim.x = spot.sx;
      sim.y = spot.sy;
    }
    const p = this.state.players.get(id);
    if (p) {
      p.x = Math.round(sim.x);
      p.y = Math.round(sim.y);
      p.act = 0;
      p.spot = 0;
      syncNeeds(p, sim);
    }
  }

  /** Charge the rest of a shuttle or bus ticket for the distance actually ridden. */
  private settleLineFare(client: Client, sim: SimPlayer, veh: { s: number; line: { id: number; length: number } }, boarded: { s: number; paid: number }) {
    const ridden = (veh.s - boarded.s + veh.line.length) % veh.line.length;
    const total = fareWithFactor(this.hail.lineFare(sim.school, veh.line.id, ridden), this.politics.fareFactor());
    const due = Math.min(Math.max(0, total - boarded.paid), Math.floor(sim.cash));
    if (due <= 0) return;
    sim.cash -= due;
    this.syncPlayerNeeds(client.sessionId, sim);
    this.notice(client, `Conductor: "₦${due} more for the distance." You paid ₦${boarded.paid + due} in all.`);
  }

  private leaveVehicle(id: string, sim: SimPlayer) {
    this.vehicles[sim.ride]?.riders.delete(id);
    sim.boarded = undefined;
    this.hail.release(id);
    sim.ride = -1;
    const p = this.state.players.get(id);
    if (p) p.ride = 0;
  }

  private teleport(id: string, sim: SimPlayer, to: { x: number; y: number }) {
    sim.x = to.x;
    sim.y = to.y;
    sim.intent = IDLE;
    const p = this.state.players.get(id);
    if (!p) return;
    p.x = Math.round(sim.x);
    p.y = Math.round(sim.y);
    p.emote = 0;
  }

  private notice(client: Client, text: string) {
    client.send(ServerMsg.Notice, text);
  }

  /** Rate-limit + look up the sender. Kicks clients that keep flooding. */
  private acceptInput(client: Client): SimPlayer | undefined {
    const sim = this.sims.get(client.sessionId);
    if (!sim) return undefined;
    if (!sim.limiter.take()) {
      if (sim.limiter.violations > INPUT_VIOLATIONS_BEFORE_KICK) client.leave();
      return undefined;
    }
    return sim;
  }

  /** Sum clients across every campus instance (on this process / shared driver). */
  private async refreshOnlineCount() {
    try {
      const rooms = await matchMaker.query({ name: CAMPUS_ROOM });
      this.state.online = rooms.reduce((sum, r) => sum + r.clients, 0);
    } catch {
      this.state.online = this.clients.length;
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function clamp(v: number, min: number, max: number) {
  return v < min ? min : v > max ? max : v;
}

/** Max distance (map px) from a building's door to walk in. */
const ENTER_DISTANCE = 6 * PX_PER_METER;

function syncNeeds(p: PlayerState, sim: SimPlayer) {
  p.food = Math.round(sim.food);
  p.energy = Math.round(sim.energy);
  p.fun = Math.round(sim.fun);
  p.cash = Math.max(0, Math.floor(sim.cash));
  p.study = sim.study;
  p.drive = sim.skills.drive;
  p.cook = sim.skills.cook;
  p.teach = sim.skills.teach;
  p.debt = sim.debt;
  p.packs = sim.packs;
  p.attended = sim.attended;
  p.cgpa = sim.exams ? Math.round((sim.gpTotal / sim.exams) * 100) : 0;
  p.exams = Math.min(255, sim.exams);
  p.lastGrade = sim.lastGrade;
  p.malpractice = sim.malpractice;
  p.rusticatedUntil = sim.rusticatedUntil;
  p.weekStudy = Math.min(65535, sim.weekStudy);
  p.weekAttended = Math.min(255, sim.weekAttended);
}

/** A free spot within `radiusM` metres of (x, y), so people don't stack on arrival. */
function freeNear(x: number, y: number, radiusM: number): { x: number; y: number } {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * radiusM * PX_PER_METER;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (!isBlocked(px, py)) return { x: px, y: py };
  }
  return { x, y };
}

/** Where a returning player last stood, nudged to a free spot in the same space if something is in the way. */
function savedSpawnPoint(saved?: Profile): { x: number; y: number } | undefined {
  const x = saved?.x;
  const y = saved?.y;
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  if (x < 0 || y < 0 || x > WORLD_WIDTH_PX || y > MAP_HEIGHT_PX) return undefined;
  if (!isBlocked(x, y)) return { x, y };
  const near = freeNear(x, y, RESUME_SEARCH_M);
  if (isBlocked(near.x, near.y) || interiorAt(near.x, near.y) !== interiorAt(x, y)) return undefined;
  return near;
}

/** Random free spot near the SUB so new arrivals don't stack on top of each other. */
function findSpawnPoint(): { x: number; y: number } {
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * SPAWN_RADIUS_PX;
    const x = SPAWN_POINT.x + Math.cos(a) * d;
    const y = SPAWN_POINT.y + Math.sin(a) * d;
    if (!isBlocked(x, y)) return { x, y };
  }
  return { ...SPAWN_POINT };
}

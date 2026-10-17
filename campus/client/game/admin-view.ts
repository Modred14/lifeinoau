import {
  BED_HALLS,
  BED_SPACE,
  CLASS_MINUTES,
  DAYS,
  HANDOUT,
  HOSTEL_PITCHES,
  HUSTLES,
  HUSTLE_IDS,
  HUSTLE_LIMITS,
  PLACES,
  USE_DISTANCE,
  adminWeek,
  adminWeekMinute,
  atBusinessCentre,
  ballotOpenFor,
  ballotRivals,
  nextBallotWindow,
  carryOverCodes,
  carryOverSlots,
  emptyAdminRecord,
  holdsBed,
  holdsHandout,
  hustleRefusal,
  hustleShiftsToday,
  hustleSite,
  isRegistered,
  lovesHandouts,
  nearestBusinessCentre,
  parseAdminPayload,
  portalStatus,
  registrationClosesIn,
  registrationCost,
  registrationOpen,
  resultSlip,
  slotStart,
  testCourseOn,
  timetableFor,
  type AdminAction,
  type AdminPayload,
  type GameTime,
  type HustleId,
  type HustleSpec,
  type Point,
  type PortalState,
  type ResultSlip,
} from "@campuslife/shared";

export type { AdminAction } from "@campuslife/shared";

export interface AdminLive {
  payload: AdminPayload;
  at: number;
}

export const NO_ADMIN: AdminLive = { payload: { department: "", level: "", record: emptyAdminRecord() }, at: 0 };

export interface PortalView {
  state: PortalState;
  queue: number;
  open: boolean;
  closesIn: number;
  registered: boolean;
  late: boolean;
  portalCost: number;
  centreCost: number;
  nearCentre: boolean;
  centre?: Point;
  courses: { code: string; title: string; units: number; carry: boolean }[];
}

export interface HostelView {
  bed: string;
  ballotOpen: boolean;
  tried: boolean;
  fee: number;
  opensIn: number;
  halls: { place: number; name: string; beds: number; applicants: number }[];
}

export interface HandoutView {
  held: boolean;
  fromRep: boolean;
  loved: boolean;
  repPrice: number;
  copyPrice: number;
}

export interface CarryClassView {
  code: string;
  title: string;
  day: string;
  start: number;
  end: number;
  venue: string;
  door: Point;
}

export interface HustleView {
  spec: HustleSpec;
  skill: number;
  done: number;
  refusal?: string;
  target?: Point;
  here: boolean;
}

export interface AdminView {
  week: number;
  portal: PortalView;
  hostel: HostelView;
  handouts: Record<string, HandoutView>;
  slip: ResultSlip;
  lastSlip: ResultSlip;
  carry: CarryClassView[];
  nextCarry: string[];
  todayTest: string;
  hustles: HustleView[];
  shift?: { id: HustleId; left: number };
}

export interface AdminPrompt {
  d: number;
  p: { id: string; icon: string; label: string; detail?: string; disabled?: boolean };
  run: () => void;
}

const MS_PER_SECOND = 1000;
const NOT_OPENING = -1;
const SHIFT_PRIORITY = 400;
const SITE_PRIORITY = 60;
const TRAY_PRIORITY = 20;
const HAIR_DISTANCE = USE_DISTANCE + 1;
const PROMPT_ICON = { register: "📝", shift: "💼" };
const PROMPT_TEXT = {
  register: "Run my course registration",
  running: (spec: HustleSpec, left: number) => `${spec.title}: ${left}s left`,
  stay: "Stay here till the shift ends",
  pay: (spec: HustleSpec) => `${spec.seconds}s shift · from ₦${spec.basePay.toLocaleString("en-NG")}`,
  trayPay: (spec: HustleSpec) => `${spec.seconds}s shift · ₦${spec.basePay} a customer`,
};
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

export function readAdmin(raw: unknown, at: number): AdminLive | undefined {
  const payload = parseAdminPayload(raw);
  return payload && { payload, at };
}

export function shiftLeft(live: AdminLive, nowMs: number): { id: HustleId; left: number } | undefined {
  const shift = live.payload.shift;
  if (!shift) return undefined;
  const left = Math.ceil(shift.left - (nowMs - live.at) / MS_PER_SECOND);
  return left > 0 ? { id: shift.id, left } : undefined;
}

function nearest<T extends { at: Point }>(list: readonly T[], pos: Point): T | undefined {
  let best: T | undefined;
  let bestD = Infinity;
  for (const item of list) {
    const d = Math.hypot(item.at.x - pos.x, item.at.y - pos.y);
    if (d < bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

function hustleTarget(id: HustleId, pos: Point): Point | undefined {
  if (id === "typing") return nearestBusinessCentre(pos.x, pos.y)?.at;
  if (id === "tray") return nearest(HOSTEL_PITCHES, pos)?.at;
  return nearest(BED_HALLS.map((hall) => ({ at: PLACES[hall.place].door })), pos)?.at;
}

function opensIn(minuteOfWeek: number): number {
  const window = nextBallotWindow(minuteOfWeek);
  return window && minuteOfWeek < window.start ? window.start - minuteOfWeek : NOT_OPENING;
}

export function adminView(live: AdminLive, t: GameTime, pos: Point, energy: number, nowMs: number): AdminView {
  const { department, level, record } = live.payload;
  const week = adminWeek(t);
  const tt = timetableFor(department, level);
  const status = portalStatus(t.total);
  const carryCodes = carryOverCodes(record, week);
  const registered = isRegistered(record, week);
  const handouts: Record<string, HandoutView> = {};
  for (const course of tt.courses) {
    handouts[course.code] = {
      held: holdsHandout(record, week, course.code),
      fromRep: record.handouts.week === week && record.handouts.rep.includes(course.code),
      loved: lovesHandouts(course),
      repPrice: HANDOUT.repPrice,
      copyPrice: HANDOUT.copyPrice,
    };
  }
  const test = testCourseOn(tt, t.dayIndex);
  return {
    week,
    portal: {
      state: status.state,
      queue: status.queue,
      open: registrationOpen(t.total),
      closesIn: registrationClosesIn(t.total),
      registered,
      late: registered ? record.reg?.late === true : !registrationOpen(t.total),
      portalCost: registrationCost(t.total, "portal"),
      centreCost: registrationCost(t.total, "centre"),
      nearCentre: atBusinessCentre(pos.x, pos.y),
      centre: nearestBusinessCentre(pos.x, pos.y)?.at,
      courses: tt.courses.map((course) => ({ code: course.code, title: course.title, units: course.units, carry: carryCodes.includes(course.code) })),
    },
    hostel: {
      bed: holdsBed(record, week) ? (record.bed?.hall ?? "") : "",
      ballotOpen: ballotOpenFor(record, t.total),
      tried: record.ballot.week === week && record.ballot.tried,
      fee: BED_SPACE.fee,
      opensIn: opensIn(adminWeekMinute(t.total)),
      halls: BED_HALLS.map((hall) => ({ place: hall.place, name: hall.name, beds: hall.beds, applicants: ballotRivals(week, hall.place) + 1 })),
    },
    handouts,
    slip: resultSlip(record, week),
    lastSlip: resultSlip(record, week - 1),
    carry: carryOverSlots(tt, carryCodes, week).map((slot) => ({
      code: slot.course.code,
      title: slot.course.title,
      day: DAYS[slot.weekday],
      start: slotStart(slot.slot),
      end: slotStart(slot.slot) + CLASS_MINUTES,
      venue: PLACES[slot.place].name,
      door: PLACES[slot.place].door,
    })),
    nextCarry: carryOverCodes(record, week + 1),
    todayTest: test ? `${test.code} ${test.title}` : "",
    hustles: HUSTLE_IDS.map((id) => ({
      spec: HUSTLES[id],
      skill: record.skills[id],
      done: hustleShiftsToday(record, id, t.dayIndex),
      refusal: hustleRefusal(id, record, t, energy),
      target: hustleTarget(id, pos),
      here: hustleSite(id, pos.x, pos.y) !== undefined,
    })),
    shift: shiftLeft(live, nowMs),
  };
}

export function adminPrompts(live: AdminLive, x: number, y: number, t: GameTime, energy: number, nowMs: number, send: (action: AdminAction) => void): AdminPrompt[] {
  const record = live.payload.record;
  const running = shiftLeft(live, nowMs);
  if (running) {
    const spec = HUSTLES[running.id];
    return [{ d: -SHIFT_PRIORITY, p: { id: `hustle-run-${running.left}`, icon: PROMPT_ICON.shift, label: PROMPT_TEXT.running(spec, running.left), detail: PROMPT_TEXT.stay, disabled: true }, run: () => {} }];
  }
  const out: AdminPrompt[] = [];
  const offer = (id: HustleId, d: number) => {
    const spec = HUSTLES[id];
    const refusal = hustleRefusal(id, record, t, energy);
    const detail = refusal ?? (id === "tray" ? PROMPT_TEXT.trayPay(spec) : PROMPT_TEXT.pay(spec));
    out.push({ d, p: { id: `hustle-${id}-${refusal ? "no" : "go"}`, icon: spec.icon, label: spec.start, detail, disabled: refusal !== undefined }, run: () => send({ a: "hustle", id }) });
  };
  if (hustleSite("hair", x, y) !== undefined) {
    if (HUSTLES.hair.weekdays.includes(t.weekday)) offer("hair", HAIR_DISTANCE);
    return out;
  }
  const centre = nearestBusinessCentre(x, y);
  if (centre && centre.d <= HUSTLE_LIMITS.reach) {
    if (!isRegistered(record, adminWeek(t))) {
      out.push({ d: centre.d - SITE_PRIORITY, p: { id: "admin-centre-register", icon: PROMPT_ICON.register, label: PROMPT_TEXT.register, detail: naira(registrationCost(t.total, "centre")) }, run: () => send({ a: "centre" }) });
    } else offer("typing", centre.d - SITE_PRIORITY);
  }
  const pitch = HOSTEL_PITCHES.find((p) => Math.hypot(p.at.x - x, p.at.y - y) <= HUSTLE_LIMITS.reach);
  if (pitch) offer("tray", Math.hypot(pitch.at.x - x, pitch.at.y - y) - TRAY_PRIORITY);
  return out;
}

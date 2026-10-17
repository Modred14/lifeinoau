import type { GameTime } from "../clock";
import { SPOTS, STALLS } from "../interiors";
import { calendarFor } from "../shows/calendar";
import { freshBatch, stallOpen } from "../shows/night-food";
import { whatsOn, type WhatsOnItem } from "../shows/whats-on";
import { facultyIndexOf } from "../social/faculties";
import { SOCIAL_SITES } from "../social/place";
import { SPECIAL_TRADES, type SpecialId } from "../social/trades";
import { GIST_PRIORITY, GIST_SOON_MINUTES, gistClock, soonness, type GistItem, type GistKind, type GistMe } from "./types";

const KIND_OF: Record<WhatsOnItem["type"], GistKind> = { show: "show", match: "match", pitch: "sport", event: "calendar" };
const FOOD_STALLS: readonly SpecialId[] = ["risky", "hot"];
const SKIPPED_CALENDAR = new Set(["novelty"]);

const TEXT = {
  live: (venue: string, end: number) => `On now at ${venue} till ${gistClock(end)}`,
  soon: (venue: string, start: number) => `${gistClock(start)} at ${venue}`,
  gate: (fee: number) => (fee > 0 ? ` · Gate ₦${fee.toLocaleString("en-NG")}` : " · Free"),
  yours: "Your faculty week",
  week: "Faculty week",
  risky: "Risky don open",
  riskyDetail: (close: number) => `Night food till ${gistClock(close)}`,
  hot: "As E Dey Hot: fresh batch",
  hotDetail: "Puff-puff and buns just comot from fire",
};

function whatsItem(w: WhatsOnItem, t: GameTime): GistItem {
  const base = w.live ? GIST_PRIORITY.live : w.startTotal - t.total <= GIST_SOON_MINUTES ? GIST_PRIORITY.soon : GIST_PRIORITY.today;
  return {
    id: `${w.type}:${w.id}`,
    kind: KIND_OF[w.type],
    title: w.title,
    detail: `${w.live ? TEXT.live(w.venue, w.endTotal) : TEXT.soon(w.venue, w.startTotal)}${TEXT.gate(w.fee)}`,
    start: w.startTotal,
    end: w.endTotal,
    live: w.live,
    act: false,
    priority: base + (w.big ? 5 : 0) + soonness(w.startTotal, t.total),
    place: w.place,
    door: w.go ?? w.door,
    where: w.venue,
  };
}

export function socialGist(t: GameTime, me: GistMe): GistItem[] {
  const listed = whatsOn(t, me.at).filter((w) => w.endTotal > t.total && (w.startTotal - t.total <= GIST_SOON_MINUTES || (w.type === "pitch" && w.dayIndex === t.dayIndex)));
  const out = listed.map((w) => whatsItem({ ...w, live: t.total >= w.startTotal && t.total < w.endTotal }, t));
  const seen = new Set(listed.map((w) => w.id));
  const mine = facultyIndexOf(me.department);
  for (const e of calendarFor(t.dayIndex)) {
    if (e.faculty < 0 || e.endTotal <= t.total || seen.has(e.key) || SKIPPED_CALENDAR.has(e.kind)) continue;
    const own = e.faculty === mine;
    out.push({ id: `calendar:${e.key}`, kind: "calendar", title: e.title, detail: `${own ? TEXT.yours : TEXT.week} · ${TEXT.soon(e.where, e.startTotal)}`, start: e.startTotal, end: e.endTotal, live: false, act: false, priority: (own ? GIST_PRIORITY.mine : GIST_PRIORITY.today) + soonness(e.startTotal, t.total), place: e.place, door: e.at, where: e.where });
  }
  return out;
}

export function foodGist(t: GameTime): GistItem[] {
  const out: GistItem[] = [];
  for (const id of FOOD_STALLS) {
    const stall = SOCIAL_SITES.stalls[id];
    const spot = stall === undefined ? undefined : SPOTS[STALLS[stall]?.spot ?? -1];
    if (stall === undefined || !spot || !stallOpen(stall, t)) continue;
    if (id === "hot" && !freshBatch(t)) continue;
    const trade = SPECIAL_TRADES[id];
    out.push({ id: `food:${id}:${t.dayIndex}`, kind: "food", title: id === "risky" ? TEXT.risky : TEXT.hot, detail: id === "risky" ? TEXT.riskyDetail(trade.close) : TEXT.hotDetail, start: t.total, end: t.total + GIST_SOON_MINUTES, live: true, act: false, priority: id === "hot" ? GIST_PRIORITY.soon : GIST_PRIORITY.note, door: { x: spot.sx, y: spot.sy }, where: STALLS[stall].name });
  }
  return out;
}

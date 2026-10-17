import { BED_SPACE, ballotOpenFor, holdsBed, nextBallotWindow } from "../admin/hostel";
import { REGISTRATION, adminWeek, adminWeekMinute, isRegistered, portalRush, registrationClosesIn, registrationOpen } from "../admin/portal";
import type { GameTime } from "../clock";
import { conditionsNow, zoneLight } from "../conditions/now";
import { nextOutage, outageAt } from "../conditions/power";
import { DRY_TAPS } from "../conditions/water";
import { powerZoneAt, powerZoneOfPlace } from "../conditions/zones";
import { WEEK_MINUTES } from "../politics/calendar";
import { semesterView } from "../semester";
import { GIST_PRIORITY, GIST_SOON_MINUTES, gistClock, gistSpan, soonness, type GistItem, type GistMe } from "./types";

const TEXT = {
  register: "Register your courses",
  registerDetail: (left: number) => `Portal closes in ${gistSpan(left)}. Open School, then Portal`,
  missed: "You never register this semester",
  missedDetail: `Late fine is ₦${REGISTRATION.lateFine.toLocaleString("en-NG")} and each paper loses ${REGISTRATION.testPenalty} marks till you register`,
  ballot: "Bed space ballot is open",
  ballotDetail: (end: number) => `Open School, then Hostel, and ballot before ${gistClock(end)}. Fee is ₦${BED_SPACE.fee.toLocaleString("en-NG")}`,
  ballotSoon: (start: number) => `Bed ballot opens by ${gistClock(start)}`,
  ballotSoonDetail: "Open School, then Portal, when e open",
  lateBallot: "Late bed space ballot is open",
  semester: (name: string, phase: string) => `${name}: ${phase}`,
  semesterDetail: (detail: string, left: number) => `${detail}. ${gistSpan(left)} left`,
  dark: (zone: string) => `No light for ${zone}`,
  darkSoon: (zone: string) => `Light fit go for ${zone}`,
  dry: "No water for tap",
};

function adminGist(t: GameTime, me: GistMe): GistItem[] {
  const record = me.admin;
  if (!record) return [];
  const week = adminWeek(t);
  const weekStart = week * WEEK_MINUTES;
  const out: GistItem[] = [];
  if (!isRegistered(record, week)) {
    if (registrationOpen(t.total)) out.push({ id: `portal:${week}`, kind: "portal", title: TEXT.register, detail: TEXT.registerDetail(registrationClosesIn(t.total)), start: weekStart, end: weekStart + REGISTRATION.closeMinute, live: true, act: true, priority: portalRush(t.total) ? GIST_PRIORITY.act : GIST_PRIORITY.mine + 5 });
    else out.push({ id: `portal:late:${week}`, kind: "portal", title: TEXT.missed, detail: TEXT.missedDetail, start: weekStart + REGISTRATION.closeMinute, end: weekStart + WEEK_MINUTES, live: true, act: true, priority: GIST_PRIORITY.mine + 5 });
  }
  if (!holdsBed(record, week)) {
    const window = nextBallotWindow(adminWeekMinute(t.total));
    const start = weekStart + (window?.start ?? WEEK_MINUTES);
    const end = weekStart + (window?.end ?? WEEK_MINUTES);
    if (ballotOpenFor(record, t.total)) out.push({ id: `hostel:${week}`, kind: "hostel", title: window?.late ? TEXT.lateBallot : TEXT.ballot, detail: TEXT.ballotDetail(end), start, end, live: true, act: true, priority: GIST_PRIORITY.act });
    else if (window && !(record.ballot.week === week && record.ballot.tried) && start > t.total && start - t.total <= GIST_SOON_MINUTES) out.push({ id: `hostel:${week}`, kind: "hostel", title: TEXT.ballotSoon(start), detail: TEXT.ballotSoonDetail, start, end, live: false, act: false, priority: GIST_PRIORITY.soon + soonness(start, t.total) });
  }
  return out;
}

function conditionsGist(t: GameTime, me: GistMe): GistItem[] {
  const place = me.place ?? -1;
  if (place < 0 && !me.at) return [];
  const zone = place >= 0 ? powerZoneOfPlace(place) : powerZoneAt(me.at?.x ?? 0, me.at?.y ?? 0);
  const out: GistItem[] = [];
  const outage = outageAt(zone.index, t.total);
  const next = outage ? undefined : nextOutage(zone.index, t.total);
  if (outage) out.push({ id: `light:${zone.id}:${outage.start}`, kind: "light", title: TEXT.dark(zone.name), detail: zoneLight(zone, t.total).text, start: outage.start, end: outage.end, live: true, act: false, priority: GIST_PRIORITY.today });
  else if (next && next.start - t.total <= GIST_SOON_MINUTES) out.push({ id: `light:${zone.id}:${next.start}`, kind: "light", title: TEXT.darkSoon(zone.name), detail: zoneLight(zone, t.total).text, start: next.start, end: next.end, live: false, act: false, priority: GIST_PRIORITY.note });
  const now = conditionsNow(t, place, me.at);
  const dayStart = t.dayIndex * 1440;
  if (now.dry) out.push({ id: `water:${zone.id}:${t.dayIndex}`, kind: "water", title: TEXT.dry, detail: now.waterText, start: dayStart + DRY_TAPS.from, end: dayStart + DRY_TAPS.to, live: true, act: false, priority: GIST_PRIORITY.today });
  return out;
}

function semesterGist(t: GameTime): GistItem[] {
  const view = semesterView(t);
  const start = view.semester * WEEK_MINUTES + view.phase.start;
  return [{ id: `semester:${view.semester}:${view.phase.id}`, kind: "calendar", title: TEXT.semester(view.name, view.phase.title), detail: TEXT.semesterDetail(view.phase.detail, view.endsIn), start, end: start + view.phase.end - view.phase.start, live: true, act: false, priority: GIST_PRIORITY.note }];
}

export function lifeGist(t: GameTime, me: GistMe): GistItem[] {
  return [...semesterGist(t), ...adminGist(t, me), ...conditionsGist(t, me)];
}

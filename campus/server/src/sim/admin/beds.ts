import {
  ACT_RATES,
  BED_SPACE,
  BED_TEXT,
  INTERIORS,
  PLACES,
  PORTER_RAID,
  SPOTS,
  adminWeek,
  ballotOpenFor,
  ballotPosition,
  bedHall,
  bedHallNamed,
  doorPoint,
  holdsBed,
  isBlocked,
  raidOn,
  restAdjust,
  sleeperIn,
  type BedHall,
  type GameTime,
} from "@campuslife/shared";
import { drawSecret } from "../secret";
import { ADMIN_NOTICE, type AdminHost, type AdminStudent, type BedStore } from "./types";

const NOT_ASLEEP = -1;
const SLEEP_RATE = ACT_RATES.sleep.energy ?? 0;
const KEPT_WEEKS = 2;

export class BedDesk {
  private held = new Map<string, Set<string>>();

  constructor(private host: AdminHost, private settled: (id: string, student: AdminStudent) => void = () => {}) {}

  holders(week: number, place: number): number {
    return this.held.get(`${week}:${place}`)?.size ?? 0;
  }

  joined(student: AdminStudent, week: number) {
    const bed = student.admin.bed;
    const hall = bed && bed.week === week ? bedHallNamed(bed.hall) : undefined;
    if (hall) this.hold(week, hall.place, student.profileId);
    else if (this.host.beds && student.profileId) this.recover(this.host.beds, student, week);
  }

  private recover(store: BedStore, student: AdminStudent, week: number) {
    void store
      .hallOf(week, student.profileId)
      .then((name) => {
        const held = name === undefined ? undefined : bedHallNamed(name);
        if (!held || holdsBed(student.admin, week)) return;
        student.admin.bed = { week, hall: held.name };
        this.hold(week, held.place, student.profileId);
      })
      .catch((err: unknown) => console.error("[admin] bed lookup failed", err));
  }

  ballot(id: string, student: AdminStudent, place: number, now: GameTime): boolean | Promise<boolean> {
    const record = student.admin;
    const week = adminWeek(now);
    const hall = bedHall(place);
    if (!hall) return false;
    if (holdsBed(record, week) && record.bed) return this.say(id, BED_TEXT.holding(record.bed.hall));
    if (!ballotOpenFor(record, now.total)) return this.say(id, record.ballot.week === week && record.ballot.tried ? BED_TEXT.tried : BED_TEXT.closed);
    if (student.cash < BED_SPACE.fee) return this.say(id, BED_TEXT.cash);
    record.ballot = { week, from: record.ballot.week === week ? record.ballot.from : now.total, tried: true };
    const position = ballotPosition(week, place, student.profileId, drawSecret());
    const drawn = position <= hall.beds;
    const free = drawn && this.holders(week, place) < hall.beds;
    if (free && this.host.beds && student.profileId) return this.claim(this.host.beds, id, student, hall, week, position).then(() => true);
    else this.award(id, student, hall, week, position, free, drawn);
    return true;
  }

  private award(id: string, student: AdminStudent, hall: BedHall, week: number, position: number, won: boolean, drawn = true) {
    if (won) {
      student.cash = Math.max(0, student.cash - BED_SPACE.fee);
      student.admin.bed = { week, hall: hall.name };
      this.hold(week, hall.place, student.profileId);
      this.host.notify(id, BED_TEXT.won(hall.name, position));
    } else this.host.notify(id, drawn ? BED_TEXT.exhausted : BED_TEXT.lost(position, hall.beds));
  }

  private async claim(store: BedStore, id: string, student: AdminStudent, hall: BedHall, week: number, position: number) {
    const won = await store.claim(week, hall.name, hall.beds, student.profileId);
    this.award(id, student, hall, week, position, won);
    this.settled(id, student);
  }

  sleep(id: string, student: AdminStudent, now: GameTime, dt: number, said: (key: string, text: string) => void): boolean {
    const place = student.act?.kind === "sleep" ? (SPOTS[student.act.spot]?.place ?? NOT_ASLEEP) : NOT_ASLEEP;
    if (place < 0 || INTERIORS[place]?.template.id !== "hostel") return false;
    const sleeper = sleeperIn(student.admin, adminWeek(now), place);
    student.energy += restAdjust(sleeper, SLEEP_RATE) * dt;
    if (sleeper === "owner") {
      said(`own:${now.dayIndex}`, ADMIN_NOTICE.ownBed);
      return false;
    }
    said(`squat:${now.dayIndex}`, ADMIN_NOTICE.squatting);
    if (student.admin.raided === now.dayIndex || !raidOn(now.dayIndex, place, now.minute)) return false;
    student.admin.raided = now.dayIndex;
    const fine = Math.max(0, Math.min(PORTER_RAID.fine, Math.floor(student.cash)));
    student.cash -= fine;
    this.host.evict(id, doorPoint(PLACES[place], isBlocked));
    this.host.notify(id, BED_TEXT.raid(PLACES[place].name, fine));
    return true;
  }

  private say(id: string, text: string): boolean {
    this.host.notify(id, text);
    return false;
  }

  private hold(week: number, place: number, key: string) {
    const slot = `${week}:${place}`;
    const set = this.held.get(slot) ?? new Set<string>();
    set.add(key);
    this.held.set(slot, set);
    for (const old of this.held.keys()) if (Number(old.split(":")[0]) < week - KEPT_WEEKS) this.held.delete(old);
  }
}

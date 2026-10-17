import { INTERIORS } from "../interiors";
import { MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, type Point } from "../map";
import { coursesFor, levelYear, type Course } from "./courses";
import { LECTURE_DAYS } from "../semester";
import { pickFrom, randomFor, shuffled } from "./seed";

export const CLASS_START_HOURS = [8, 10, 12, 14];
export const CLASS_MINUTES = 90;
export const SLOTS_PER_DAY = CLASS_START_HOURS.length;
const MINUTES_PER_HOUR = 60;
export const WEEK_SLOTS = LECTURE_DAYS.length * SLOTS_PER_DAY;
export const slotWeekday = (index: number) => LECTURE_DAYS[Math.floor(index / SLOTS_PER_DAY)];
export const slotIndexOf = (weekday: number, slot: number) => LECTURE_DAYS.indexOf(weekday) * SLOTS_PER_DAY + slot;

const EVENT_VENUES = /amphi|oduduwa/i;
const BIG_THEATRES = /1000 seater|^aud i|hslt|^booc$/i;
const CLASSROOM_BLOCKS = /^boo[abc]$/i;
const NOT_FOR_CLASSES = /senate|admin|museum|white house/i;

export interface ClassSlot {
  course: Course;
  weekday: number;
  slot: number;
  place: number;
}

export interface StudentTimetable {
  department: string;
  level: string;
  courses: Course[];
  slots: ClassSlot[];
}

const hasSeats = (place: number) => {
  const it = INTERIORS[place];
  return it !== undefined && it.template.spots.some((spot) => spot.kind === "study");
};

const onMap = (door: Point) => door.x >= 0 && door.y >= 0 && door.x <= MAP_WIDTH_PX && door.y <= MAP_HEIGHT_PX;

const usable = PLACES.map((p, i) => ({ p, i })).filter(({ p, i }) => hasSeats(i) && onMap(p.door) && !EVENT_VENUES.test(p.name));

export const GST_VENUES: readonly number[] = usable.filter(({ p, i }) => BIG_THEATRES.test(p.name) && INTERIORS[i]?.template.id === "lecture").map(({ i }) => i);

export const CLASS_VENUES: readonly number[] = usable
  .filter(({ p, i }) => {
    const id = INTERIORS[i]?.template.id;
    if (id === "lecture") return true;
    return id === "classroom" && (CLASSROOM_BLOCKS.test(p.name) || (p.kind === "academic" && !NOT_FOR_CLASSES.test(p.name)));
  })
  .map(({ i }) => i);

export const slotStart = (slot: number) => CLASS_START_HOURS[slot] * MINUTES_PER_HOUR;
export const venuePool = (course: Course) => (course.gst ? GST_VENUES : CLASS_VENUES);

const cache = new Map<string, StudentTimetable>();

function build(department: string, level: string): StudentTimetable {
  const year = levelYear(level);
  const courses = coursesFor(department, level);
  const slots: ClassSlot[] = [];
  const taken = new Set<number>();
  const place = (course: Course, index: number) => {
    taken.add(index);
    const rand = randomFor(`venue:${course.id}:${index}`);
    slots.push({ course, weekday: slotWeekday(index), slot: index % SLOTS_PER_DAY, place: pickFrom(venuePool(course), rand) });
  };
  const all = Array.from({ length: WEEK_SLOTS }, (_, i) => i);
  const gstOrder = shuffled(all, randomFor(`gst-slots:${year}`));
  courses.filter((c) => c.gst).forEach((course, k) => place(course, gstOrder[k]));
  const order = shuffled(all, randomFor(`slots:${department}:${year}`));
  for (const course of courses.filter((c) => !c.gst)) {
    const days = new Set<number>();
    for (let n = 0; n < course.units - 1; n++) {
      const free = order.filter((index) => !taken.has(index));
      const index = free.find((i) => !days.has(Math.floor(i / SLOTS_PER_DAY))) ?? free[0];
      if (index === undefined) break;
      days.add(Math.floor(index / SLOTS_PER_DAY));
      place(course, index);
    }
  }
  slots.sort((a, b) => a.weekday - b.weekday || a.slot - b.slot);
  return { department, level, courses, slots };
}

export function timetableFor(department: string, level: string): StudentTimetable {
  const key = `${department}|${level}`;
  let found = cache.get(key);
  if (!found) cache.set(key, (found = build(department, level)));
  return found;
}

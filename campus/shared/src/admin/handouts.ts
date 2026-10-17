import type { Course } from "../academics/courses";
import { randomFor } from "../academics/seed";
import type { AdminRecord } from "./record";

export type HandoutSource = "rep" | "copy";

export const HANDOUT = {
  repPrice: 500,
  copyPrice: 150,
  classStudy: 2,
  testMarks: 3,
  favourMarks: 2,
  loverChance: 0.3,
} as const;

export const HANDOUT_TEXT = {
  held: (code: string) => `You get the ${code} handout already.`,
  unknown: "That course no dey your list.",
  cash: (price: number) => `Handout is ₦${price}. Find money first.`,
  bought: (code: string, price: number, favour: boolean) => `📄 ${code} handout bought from the class rep for ₦${price}.${favour ? " The class rep wrote your name down." : ""}`,
  copied: (code: string, price: number) => `📄 ${code} handout photocopied for ₦${price}.`,
  helped: (code: string) => `📄 Your ${code} handout helped in class. +${HANDOUT.classStudy} study points.`,
};

export const handoutPrice = (source: HandoutSource) => (source === "rep" ? HANDOUT.repPrice : HANDOUT.copyPrice);

export function lovesHandouts(course: Course): boolean {
  return course.lecturer.temperament === "strict" || randomFor(`handout-lover:${course.id}`)() < HANDOUT.loverChance;
}

export const holdsHandout = (record: AdminRecord, week: number, code: string) => record.handouts.week === week && record.handouts.held.includes(code);

export type HandoutOutcome = { ok: true; price: number; favour: boolean } | { ok: false; text: string };

export function tryBuyHandout(record: AdminRecord, week: number, courses: readonly Course[], code: string, source: HandoutSource, cash: number): HandoutOutcome {
  const course = courses.find((c) => c.code === code);
  if (!course) return { ok: false, text: HANDOUT_TEXT.unknown };
  if (holdsHandout(record, week, code)) return { ok: false, text: HANDOUT_TEXT.held(code) };
  const price = handoutPrice(source);
  if (cash < price) return { ok: false, text: HANDOUT_TEXT.cash(price) };
  return { ok: true, price, favour: source === "rep" && lovesHandouts(course) };
}

export function addHandout(record: AdminRecord, week: number, code: string, source: HandoutSource) {
  if (record.handouts.week !== week) record.handouts = { week, held: [], rep: [], credited: [] };
  if (!record.handouts.held.includes(code)) record.handouts.held.push(code);
  if (source === "rep" && !record.handouts.rep.includes(code)) record.handouts.rep.push(code);
}

export function handoutClassStudy(record: AdminRecord, week: number, code: string, session: number): number {
  if (!holdsHandout(record, week, code) || record.handouts.credited.includes(session)) return 0;
  record.handouts.credited.push(session);
  return HANDOUT.classStudy;
}

export function handoutTestMarks(record: AdminRecord, week: number, course: Course): number {
  if (!holdsHandout(record, week, course.code)) return 0;
  const favour = record.handouts.rep.includes(course.code) && lovesHandouts(course);
  return HANDOUT.testMarks + (favour ? HANDOUT.favourMarks : 0);
}

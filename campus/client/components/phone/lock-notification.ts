import type { CampusView, OrdersView } from "@campus/game/CampusView";
import type { AppId } from "./apps";
import { ORDER_STATUS, hhmm } from "./format";

export type Timetable = ReturnType<CampusView["getTimetable"]>;
type ClassItem = Timetable["lectures"][number];

export interface LockNotification {
  app: AppId;
  title: string;
  body: string;
}

const CLASS_BODY: Record<ClassItem["state"], (item: ClassItem) => string> = {
  on: (item) => `On now at ${item.venue}`,
  late: (item) => `Lecturer never show. Wait at ${item.venue}`,
  shifted: (item) => `Shifted to ${hhmm(item.start)} at ${item.venue}`,
  holding: (item) => `${hhmm(item.start)} at ${item.venue}`,
  cancelled: () => "Class cancelled",
  done: () => "Class is over",
};
const sheetTitle = (item: ClassItem) => `${item.code}: sheet is going round`;
const sheetBody = (item: ClassItem) => `Sit down at ${item.venue} now`;

export function classNotification(timetable: Timetable): LockNotification | null {
  const sheet = timetable.lectures.find((item) => item.sheet);
  if (sheet) return { app: "school", title: sheetTitle(sheet), body: sheetBody(sheet) };
  const next = timetable.lectures.find((item) => item.state !== "done" && item.state !== "cancelled");
  if (!next) return null;
  return { app: "school", title: next.course, body: CLASS_BODY[next.state](next) };
}

export function lockNotification(orders: OrdersView | null, timetable: Timetable): LockNotification | null {
  if (timetable.lectures.some((item) => item.sheet)) return classNotification(timetable);
  if (orders?.mine) return { app: "chop", title: orders.mine.label, body: ORDER_STATUS[orders.mine.status] };
  if (orders && orders.packs > 0) {
    return { app: "chop", title: "Your food is here", body: `${orders.packs} food ${orders.packs === 1 ? "pack" : "packs"} to eat` };
  }
  return classNotification(timetable);
}

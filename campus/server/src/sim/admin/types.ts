import type { AdminPayload, AdminRecord, AttendanceBook, GameTime, Point } from "@campuslife/shared";

export interface AdminStudent {
  x: number;
  y: number;
  cash: number;
  energy: number;
  study: number;
  weekStudy: number;
  department: string;
  level: string;
  attendance: AttendanceBook;
  admin: AdminRecord;
  profileId: string;
  ride: number;
  driving: number;
  act?: { spot: number; kind: string };
}

export interface BedStore {
  claim(week: number, hall: string, beds: number, accountId: string): Promise<boolean>;
  hallOf(week: number, accountId: string): Promise<string | undefined>;
  release?(accountId: string): Promise<void>;
}

export interface AdminHost {
  notify(id: string, text: string): void;
  send(id: string, payload: AdminPayload): void;
  earn(id: string, amount: number): number;
  changed(id: string): void;
  evict(id: string, to: Point): void;
  now?: () => GameTime;
  beds?: BedStore;
}

export const ADMIN_NOTICE = {
  regOpen: "📋 Course registration is open till Tuesday 18:00. Lectures start Wednesday. Open School, then Portal.",
  regRush: "⏰ Registration closes 18:00 today. Portal dey slow, a business centre fit run am for you.",
  regMissed: (fine: number, marks: number) => `📋 Course adviser: you missed registration. Late fine is ₦${fine.toLocaleString("en-NG")}, and each test loses ${marks} marks till you register.`,
  registered: (late: boolean, cost: number) => `✅ Courses registered for this semester.${late ? " Late fine paid." : ""}${cost > 0 ? ` You paid ₦${cost.toLocaleString("en-NG")}.` : ""}`,
  centreRan: (cost: number) => `✅ Business centre don run am. Courses registered. You paid ₦${cost.toLocaleString("en-NG")}.`,
  needCentre: "Go to a business centre kiosk first.",
  ballotOpen: "🛏️ Bed space ballot is open on the portal. Pick a hall before e close.",
  ownBed: "🛏️ Your own bed space. You rest better here.",
  squatting: "😴 You dey squat here. Rest is slower, and porter fit come.",
};

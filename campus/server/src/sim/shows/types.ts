import type { GameTime } from "@campuslife/shared";

export interface Fan {
  cash: number;
  fun: number;
  energy: number;
  food?: number;
  department?: string;
  level?: string;
}

export interface Admission {
  refuse?: string;
  text?: string;
}

export interface ShowTick {
  notices: string[];
  leave: boolean;
}

export type Now = GameTime;

export const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
export const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

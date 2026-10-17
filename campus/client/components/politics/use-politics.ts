"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  SUG_SCOPE,
  ballotFor,
  postsOf,
  raceKey,
  type Aspirant,
  type ElectionCandidate,
  type GameTime,
  type PoliticsStatus,
  type UnionBody,
  type UnionPost,
  type UnionWorld,
} from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import type { PoliticsSend } from "@campus/game/politics";

const CLOCK_POLL_MS = 1000;

export interface RaceView {
  post: UnionPost;
  scope: string;
  race: string;
  candidates: ElectionCandidate[];
}

export interface Politics {
  status: PoliticsStatus | null;
  world: UnionWorld | null;
  time: GameTime;
  send: (action: PoliticsSend) => void;
}

export function usePolitics(view: CampusView): Politics {
  const link = view.politics.link;
  const status = useSyncExternalStore(link.subscribe, link.snapshot, () => null);
  const world = useSyncExternalStore(link.subscribe, link.worldSnapshot, () => null);
  const [time, setTime] = useState<GameTime>(view.politics.time);
  useEffect(() => {
    link.refresh();
    const timer = window.setInterval(() => {
      const next = view.politics.time;
      setTime((current) => (current.total === next.total ? current : next));
    }, CLOCK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [view, link]);
  return { status, world, time, send: (action) => link.send(action) };
}

export function scopeOf(status: PoliticsStatus | null, body: UnionBody): string {
  if (body === "sug") return SUG_SCOPE;
  return (body === "faculty" ? status?.faculty : status?.faculty && status.department) || "";
}

export function racesOf(status: PoliticsStatus | null, cycle: number, body: UnionBody): RaceView[] {
  const scope = scopeOf(status, body);
  if (!scope) return [];
  return postsOf(body).map((post) => ({ post, scope, race: raceKey(post, scope), candidates: ballotFor(cycle, post, scope, status?.players ?? []) }));
}

export function aspirantOf(view: CampusView, status: PoliticsStatus | null): Aspirant {
  const academics = view.getAcademics();
  return {
    cgpa: academics.cgpa,
    exams: academics.exams,
    malpractice: academics.malpractice,
    rusticated: academics.rusticatedFor > 0,
    level: status?.level ?? "",
    cash: view.getWallet().cash,
  };
}

export const naira = (amount: number) => `₦${Math.floor(amount).toLocaleString("en-NG")}`;

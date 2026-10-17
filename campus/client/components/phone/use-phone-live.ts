"use client";

import { useEffect, useState } from "react";
import { findPhone, PHONES, type Phone } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import type { Timetable } from "./lock-notification";

const POLL_MS = 500;

export interface PhoneLive {
  phone: Phone;
  cash: number;
  debt: number;
  food: number;
  energy: number;
  fun: number;
  timetable: Timetable;
}

function read(view: CampusView): PhoneLive {
  const wallet = view.getWallet();
  return { phone: findPhone(view.getPhone()) ?? PHONES[0], cash: wallet.cash, debt: wallet.debt, ...view.getVitals(), timetable: view.getTimetable() };
}

const keyOf = (live: PhoneLive) => `${live.phone.id}|${live.cash}|${live.debt}|${live.food}|${live.energy}|${live.fun}|${live.timetable.today}|${live.timetable.minute}`;

export function usePhoneLive(view: CampusView): PhoneLive {
  const [live, setLive] = useState<PhoneLive>(() => read(view));
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = read(view);
      setLive((current) => (keyOf(current) === keyOf(next) ? current : next));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [view]);
  return live;
}

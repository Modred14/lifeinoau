"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { GameTime, SocialAction, SocialStatus } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";

const CLOCK_POLL_MS = 1000;

export interface Social {
  status: SocialStatus | null;
  time: GameTime;
  send: (action: SocialAction) => void;
}

export function useSocial(view: CampusView): Social {
  const link = view.social.link;
  const status = useSyncExternalStore(link.subscribe, link.snapshot, () => null);
  const [time, setTime] = useState<GameTime>(view.social.time);
  useEffect(() => {
    link.refresh();
    const timer = window.setInterval(() => {
      const next = view.social.time;
      setTime((current) => (current.total === next.total ? current : next));
    }, CLOCK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [view, link]);
  return { status, time, send: (action) => link.send(action) };
}

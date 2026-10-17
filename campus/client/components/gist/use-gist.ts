"use client";

import { useEffect, useState } from "react";
import type { GistItem } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import { GIST_COPY, GIST_REFRESH_MS, WELCOME_DELAY_MS, WELCOME_JOINS } from "./gist-copy";
import { countJoin, hasSeen, markSeen } from "./gist-memory";

const NO_ITEMS: GistItem[] = [];
const actKey = (item: GistItem) => `act:${item.kind}`;
const joins = new WeakMap<CampusView, number>();

export function useGist(view: CampusView): GistItem[] {
  const [items, setItems] = useState<GistItem[]>(NO_ITEMS);

  useEffect(() => {
    const read = () => setItems((before) => {
      const next = view.getGist();
      return next === before ? before : next;
    });
    read();
    const id = window.setInterval(read, GIST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [view]);

  useEffect(() => {
    if (!joins.has(view)) joins.set(view, countJoin());
    if ((joins.get(view) ?? Infinity) > WELCOME_JOINS) return;
    const id = window.setTimeout(() => view.onNotice?.(GIST_COPY.welcome), WELCOME_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [view]);

  useEffect(() => {
    const fresh = items.find((item) => item.act && !hasSeen(actKey(item)));
    if (!fresh) return;
    markSeen(actKey(fresh));
    view.onNotice?.(GIST_COPY.fresh(fresh.title));
  }, [items, view]);

  return items;
}

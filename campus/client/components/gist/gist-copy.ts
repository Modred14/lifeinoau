import type { GistItem } from "@campuslife/shared";
import { gistClock } from "@campuslife/shared";

export const GIST_COPY = {
  name: "Campus gist",
  open: (count: number) => `Open Campus gist. ${count} ${count === 1 ? "thing" : "things"} happening`,
  empty: "Campus is quiet",
  emptyNote: "Nothing dey happen right now. Check back in a bit.",
  go: "Go",
  goTo: (title: string) => `Go to ${title}`,
  live: "On now",
  act: "Your move",
  starts: (total: number) => `Starts ${gistClock(total)}`,
  welcome: "📣 Check Campus gist to see wetin dey happen.",
  fresh: (title: string) => `📣 New for you: ${title}. Open Campus gist.`,
  foot: "Gist updates as the campus clock moves.",
} as const;

export const GIST_REFRESH_MS = 2000;
export const WELCOME_JOINS = 3;
export const WELCOME_DELAY_MS = 4500;

export function gistWhen(item: GistItem): string {
  if (item.act) return GIST_COPY.act;
  return item.live ? GIST_COPY.live : GIST_COPY.starts(item.start);
}

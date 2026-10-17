import type { GameTime } from "./clock";
import { classGist } from "./gist/classes";
import { lifeGist } from "./gist/life";
import { politicsGist } from "./gist/politics";
import { foodGist, socialGist } from "./gist/social";
import { GIST_LIMIT, type GistItem, type GistMe } from "./gist/types";

export { GIST_KIND_LABEL, GIST_LIMIT, GIST_PRIORITY, GIST_SOON_MINUTES, gistClock, gistSpan } from "./gist/types";
export type { GistItem, GistKind, GistMe } from "./gist/types";
export { myClassesOn, myTimetable } from "./gist/classes";
export { BOYCOTT_TEXT, STATUS_MARK, applyCampusStates, boycottAt, concessionFare, fareWithFactor, lightReliefs, orderRefusal, statusMarks, vendorOpen, withStatus } from "./gist/glue";

export function campusGist(t: GameTime, me: GistMe): GistItem[] {
  const seen = new Set<string>();
  return [...classGist(t, me), ...politicsGist(t, me), ...lifeGist(t, me), ...socialGist(t, me), ...foodGist(t)]
    .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
    .sort((a, b) => b.priority - a.priority || a.start - b.start || a.id.localeCompare(b.id))
    .slice(0, GIST_LIMIT);
}

export function gistActions(items: readonly GistItem[]): GistItem[] {
  return items.filter((item) => item.act);
}

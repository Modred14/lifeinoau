import {
  applyCampusStates,
  campusGist,
  concessionFare,
  showAt,
  type AdminRecord,
  type AttendanceBook,
  type CongressSitting,
  type GameTime,
  type GistItem,
  type Point,
  type PoliticsStatus,
  type UnionState,
  type UnionWorld,
} from "@campuslife/shared";
import { hasSeen, markSeen } from "../components/gist/gist-memory";

interface CampusFeed {
  admin?: AdminRecord;
  states: readonly UnionState[];
  called: CongressSitting | null;
  version: number;
}

const NO_STATES: readonly UnionState[] = [];
const feed: CampusFeed = { states: NO_STATES, called: null, version: 0 };

export const campusFeed = (): Readonly<CampusFeed> => feed;

export function noteAdmin(record: AdminRecord | undefined) {
  feed.admin = record;
  feed.version++;
}

export function noteUnion(world: UnionWorld | null) {
  feed.states = world?.states ?? NO_STATES;
  feed.called = world?.called ?? null;
  feed.version++;
  applyCampusStates(feed.states);
}

export const fareNow = (fare: number, total: number): number => concessionFare(fare, feed.states, total);

export interface GistSource {
  department: string;
  level: string;
  book: AttendanceBook;
  at?: Point;
  place: number;
  status: PoliticsStatus | null;
}

const AREA_PX = 400;
let cache: { key: string; items: GistItem[] } | undefined;

export function gistView(source: GistSource, t: GameTime): GistItem[] {
  const voted = (source.status?.voted.length ?? 0) > 0;
  const contesting = !!source.status?.mine;
  const area = source.at ? `${Math.round(source.at.x / AREA_PX)}:${Math.round(source.at.y / AREA_PX)}` : "";
  const key = `${t.total}|${feed.version}|${source.place}|${area}|${source.department}|${source.level}|${voted}|${contesting}|${Object.keys(source.book).length}`;
  if (cache?.key === key) return cache.items;
  const items = campusGist(t, { department: source.department, level: source.level, at: source.at, place: source.place, book: source.book, admin: feed.admin, states: feed.states, called: feed.called, voted, contesting });
  cache = { key, items };
  return items;
}

interface PromptLike {
  id: string;
  icon: string;
  label: string;
  detail?: string;
  disabled?: boolean;
}

interface Offer<P extends PromptLike> {
  d: number;
  p: P;
  run: () => void;
}

const SPOTLIGHT_BIAS = 60;
const SPOTLIGHT_SHOWN_MS = 20_000;
const SPOTLIGHT_TAG = "New for you";
const SHOW_HINT = (title: string) => `Show dey on inside: ${title}`;
const DOOR_PREFIX = "enter-";
const FAMILIES: readonly [prefix: string, family: string][] = [
  ["pol-vote", "vote"],
  ["pol-form", "form"],
  ["pol-attend", "debate"],
  ["pol-congress", "congress"],
  ["pol-march", "march"],
  ["pol-join", "gathering"],
  ["pol-relief", "relief"],
  ["admin-centre-register", "register"],
  ["watch-", "touchline"],
  ["gyrate-", "gyration"],
  ["games-", "games"],
  ["sign-", "signout"],
  ["predict-", "predict"],
];

const firstShown = new Map<string, number>();
const seenKey = (family: string) => `prompt:${family}`;

function lit<P extends PromptLike>(offer: Offer<P>, family: string, detail: string | undefined): Offer<P> {
  const key = seenKey(family);
  if (hasSeen(key)) return offer;
  const now = performance.now();
  const first = firstShown.get(family) ?? now;
  firstShown.set(family, first);
  if (now - first > SPOTLIGHT_SHOWN_MS) {
    markSeen(key);
    return offer;
  }
  return {
    d: offer.d - SPOTLIGHT_BIAS,
    p: { ...offer.p, id: `${offer.p.id}-new`, detail: detail ? `${SPOTLIGHT_TAG} · ${detail}` : SPOTLIGHT_TAG },
    run: () => {
      markSeen(key);
      offer.run();
    },
  };
}

export function spotlight<P extends PromptLike>(offer: Offer<P>): Offer<P> {
  if (offer.p.disabled) return offer;
  const family = FAMILIES.find(([prefix]) => offer.p.id.startsWith(prefix))?.[1];
  return family ? lit(offer, family, offer.p.detail) : offer;
}

export function spotlightDoor<P extends PromptLike>(offer: Offer<P>, place: number, t: GameTime): Offer<P> {
  if (!offer.p.id.startsWith(DOOR_PREFIX)) return offer;
  const show = showAt(place, t);
  return show ? lit(offer, "show", SHOW_HINT(show.title)) : offer;
}

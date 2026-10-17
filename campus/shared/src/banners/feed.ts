import type { BannerTone } from "../banner-art";
import type { GameTime } from "../clock";
import { ADVERTS, birthdays } from "./art-adverts";
import { NOTICES, facultyWeek } from "./art-notices";
import { FAITH, SPORT, fixtures } from "./art-social";
import { campaignBanners } from "../politics/banners";
import { showBanners } from "../shows/whats-on";
import type { ArtEntry } from "./art";
import { hash3, textSeed } from "./seed";
import { BANNER_KINDS, BANNER_SIZES, FACE_SHAPES, type BannerKind, type BannerSpot, type BannerZone, type FaceShape, type PlacedArt, type ToneTable } from "./types";

export type BannerSource = (t: GameTime) => readonly PlacedArt[];

const live = (list: readonly ArtEntry[]): BannerSource => (t) => list.filter((a) => !a.days || a.days.includes(t.weekday));

let rentedBanners: BannerSource = () => [];
export function setRentedBannerSource(source: BannerSource) {
  rentedBanners = source;
}

export const SOURCES: { name: string; feed: BannerSource }[] = [
  { name: "notices", feed: live(NOTICES) },
  { name: "faculty-week", feed: facultyWeek },
  { name: "adverts", feed: live(ADVERTS) },
  { name: "birthdays", feed: birthdays },
  { name: "faith", feed: live(FAITH) },
  { name: "sport", feed: live(SPORT) },
  { name: "fixtures", feed: fixtures },
  { name: "campaign", feed: campaignBanners },
  { name: "rented-campaign", feed: (t) => rentedBanners(t) },
  { name: "shows", feed: showBanners },
];

export const FACE_BUDGET: Record<FaceShape, number> = { wide: 42, strip: 12, poster: 64, big: 2 };
export const TAKEOVER: Partial<Record<BannerTone, Record<BannerKind, number>>> = {
  campaign: { board: 0.8, flex: 0.55, cross: 0.4, aframe: 0.25, billboard: 0.5, flags: 0 },
};
const TAKEOVER_POOL_SHARE = 0.6;
const NEAR_FIT = { here: 8, away: 0.4 };
const TONE_FIT: Record<BannerZone, ToneTable> = {
  gate: { campaign: 1, show: 1.5, notice: 1, advert: 2, faith: 1, sport: 1 },
  union: { campaign: 2, show: 2, notice: 1, advert: 1.3, faith: 1, sport: 1.2 },
  hostel: { campaign: 1.5, show: 1.2, notice: 1.6, advert: 1, faith: 1.2, sport: 1 },
  faculty: { campaign: 1.2, show: 0.8, notice: 2, advert: 1, faith: 0.8, sport: 0.6 },
  faith: { campaign: 0.2, show: 0.2, notice: 0.6, advert: 0.4, faith: 6, sport: 0.3 },
  sport: { campaign: 0.8, show: 1, notice: 0.6, advert: 0.8, faith: 0.4, sport: 6 },
  commerce: { campaign: 0.8, show: 1.2, notice: 0.6, advert: 2.5, faith: 0.8, sport: 0.8 },
  road: { campaign: 1, show: 1, notice: 1, advert: 1, faith: 1, sport: 1 },
};

const allows = (art: PlacedArt, kind: BannerKind) => !art.kinds || art.kinds.includes(kind);
const takeoverTones = Object.keys(TAKEOVER) as BannerTone[];

export function bannerFeed(t: GameTime): PlacedArt[] {
  const seen = new Set<string>();
  const out: PlacedArt[] = [];
  for (const source of SOURCES)
    for (const art of source.feed(t)) {
      if (seen.has(art.id)) continue;
      seen.add(art.id);
      out.push(art);
    }
  return out;
}

export const feedSignature = (feed: readonly PlacedArt[]) => feed.map((a) => `${a.id}:${a.title}:${a.lines.join("/")}`).join("|");

export function facePools(feed: readonly PlacedArt[], t: GameTime): Record<FaceShape, PlacedArt[]> {
  const pools = {} as Record<FaceShape, PlacedArt[]>;
  for (const shape of FACE_SHAPES) {
    const kinds = BANNER_KINDS.filter((k) => BANNER_SIZES[k].shape === shape);
    const eligible = feed.filter((a) => kinds.some((k) => allows(a, k)));
    const budget = FACE_BUDGET[shape];
    if (eligible.length <= budget) {
      pools[shape] = eligible;
      continue;
    }
    const rank = (a: PlacedArt) => hash3(textSeed(a.id), t.dayIndex, 5) ** (1 / Math.max(0.05, a.weight));
    const ranked = [...eligible].sort((a, b) => rank(b) - rank(a) || (a.id < b.id ? -1 : 1));
    const front = ranked.filter((a) => takeoverTones.includes(a.tone)).slice(0, Math.floor(budget * TAKEOVER_POOL_SHARE));
    const rest = ranked.filter((a) => !front.includes(a) && !takeoverTones.includes(a.tone));
    pools[shape] = [...front, ...rest.slice(0, budget - front.length)];
  }
  return pools;
}

function fit(art: PlacedArt, spot: BannerSpot): number {
  if (art.zones && !art.zones.includes(spot.zone) && art.near !== spot.place) return 0;
  const near = art.near === undefined ? 1 : art.near === spot.place ? NEAR_FIT.here : NEAR_FIT.away;
  return Math.max(0, art.weight) * TONE_FIT[spot.zone][art.tone] * near;
}

function weighted(list: readonly PlacedArt[], spot: BannerSpot, roll: number): PlacedArt {
  let weights = list.map((a) => fit(a, spot));
  let total = weights.reduce((n, w) => n + w, 0);
  if (total <= 0) {
    weights = list.map(() => 1);
    total = list.length;
  }
  let at = roll * total;
  for (let i = 0; i < list.length; i++) {
    at -= weights[i];
    if (at < 0) return list[i];
  }
  return list[list.length - 1];
}

function assignSpot(spot: BannerSpot, pools: Record<FaceShape, PlacedArt[]>, t: GameTime): PlacedArt[] {
  const shape = BANNER_SIZES[spot.kind].shape;
  if (!shape) return [];
  const pool = pools[shape].filter((a) => allows(a, spot.kind));
  const chosen: PlacedArt[] = [];
  for (let slot = 0; slot < spot.slots && pool.length; slot++) {
    const fresh = pool.filter((a) => !chosen.includes(a));
    let list = fresh.length ? fresh : pool;
    for (const tone of takeoverTones) {
      const tonal = list.filter((a) => a.tone === tone);
      if (!tonal.length) continue;
      const others = list.filter((a) => a.tone !== tone);
      const share = TAKEOVER[tone]?.[spot.kind] ?? 0;
      list = hash3(spot.id * 31 + slot, t.dayIndex, 7) < share || !others.length ? tonal : others;
      break;
    }
    chosen.push(weighted(list, spot, hash3(spot.id * 31 + slot, t.dayIndex, 9)));
  }
  return chosen;
}

export function assignBanners(spots: readonly BannerSpot[], feed: readonly PlacedArt[], t: GameTime): PlacedArt[][] {
  const pools = facePools(feed, t);
  return spots.map((s) => assignSpot(s, pools, t));
}

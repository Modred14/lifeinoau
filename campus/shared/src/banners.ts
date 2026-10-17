import type { GameTime } from "./clock";
import { PX_PER_METER } from "./map";
import { assignBanners, bannerFeed } from "./banners/feed";
import { BANNER_SPOTS } from "./banners/plan";
import type { BannerSpot } from "./banners/types";

export { BANNER_KINDS, BANNER_SIZES, BANNER_ZONES, CROSS_RULES as BANNER_CROSS_RULES, FACE_SHAPES as BANNER_FACE_SHAPES, FLAG_COLORS as BANNER_FLAG_COLORS } from "./banners/types";
export type { BannerKind, BannerSize, BannerSpot, BannerZone, FaceShape as BannerFace, PlacedArt } from "./banners/types";
export { KEEP as BANNER_KEEP, SPACING as BANNER_SPACING, bannerFootprint } from "./banners/ground";
export { BANNER_SPOTS, KIND_GAP as BANNER_KIND_GAP, MAX_SPOTS as MAX_BANNER_SPOTS, planBanners } from "./banners/plan";
export { FACE_BUDGET as BANNER_FACE_BUDGET, SOURCES as BANNER_SOURCES, TAKEOVER as BANNER_TAKEOVER, assignBanners, bannerFeed, facePools as bannerFacePools, feedSignature as bannerFeedSignature } from "./banners/feed";
export type { BannerSource } from "./banners/feed";

export const BOARD_READ_DISTANCE = 3.2 * PX_PER_METER;
export const BOARD_PROMPT_BIAS = 1.5 * PX_PER_METER;
const BOARD_TOAST = { icon: "📌", join: " · ", titles: 5, empty: "Nothing on the board today" };
const BOARDS = BANNER_SPOTS.filter((s) => s.kind === "board");

export function noticeBoardNear(x: number, y: number, reach = BOARD_READ_DISTANCE): { spot: BannerSpot; distance: number } | null {
  let best: { spot: BannerSpot; distance: number } | null = null;
  for (const spot of BOARDS) {
    const distance = Math.hypot(spot.x - x, spot.y - y);
    if (distance < reach && (!best || distance < best.distance)) best = { spot, distance };
  }
  return best;
}

export function boardNotices(spot: BannerSpot, t: GameTime): string[] {
  const posters = assignBanners([spot], bannerFeed(t), t)[0] ?? [];
  return [...new Set(posters.map((a) => a.title))];
}

export function readNoticeBoard(spot: BannerSpot, t: GameTime): string {
  const titles = boardNotices(spot, t).slice(0, BOARD_TOAST.titles);
  return `${BOARD_TOAST.icon} ${titles.length ? titles.join(BOARD_TOAST.join) : BOARD_TOAST.empty}`;
}

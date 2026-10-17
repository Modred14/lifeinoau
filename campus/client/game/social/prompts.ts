import {
  FORECOURT_LABEL,
  GROUND_IDS,
  GYRATION_LABEL,
  INTERIORS,
  PREDICT,
  PX_PER_METER,
  SIGN_SHIRT,
  SOCIAL_SITES,
  SPOTS,
  TOUCHLINE_LABEL,
  USE_DISTANCE,
  VIEWING_PLACES,
  currentPitchMatch,
  liveEvent,
  matchState,
  nextPredictable,
  pitchTitle,
  viewingArea,
  type GameTime,
} from "@campuslife/shared";
import type { SocialLink } from "./link";

export interface SocialPrompt {
  d: number;
  p: { id: string; icon: string; label: string; detail?: string };
  run: () => void;
}

const PRIORITY = 20;
const BOARD_Y = 0.2;
const TEXT = {
  watch: "Watch match",
  gyrate: "Join gyration",
  gyrateDetail: "Kegites gyration · dance",
  games: "Play games",
  gamesDetail: "Union Week · free jollof",
  sign: "Sign shirt",
  signDetail: "FYB sign-out day",
  predict: "Predict and win",
  predictOpen: "Free card. Set your score in Events, Sport.",
  predictDone: "Your card is in. Wait for full time.",
  boardHint: "📋 Open Events on your phone, go to Sport and send your score while you stand at this board.",
};
const ICON = { watch: "⚽", gyrate: "🥁", games: "🎲", sign: "✍️", predict: "📋" };

export function socialPrompts(link: SocialLink, x: number, y: number, inside: number, t: GameTime, taken: ReadonlySet<number>, use: (spot: number) => void, say: (text: string) => void): SocialPrompt[] {
  const out: SocialPrompt[] = [];
  const add = (d: number, id: string, icon: string, label: string, detail: string | undefined, run: () => void) => out.push({ d: d - PRIORITY, p: { id, icon, label, detail }, run });
  if (inside >= 0) {
    const it = INTERIORS[inside];
    if (!it || !VIEWING_PLACES.includes(inside)) return out;
    const board = viewingArea(it.template.w);
    const d = Math.hypot(x - (it.ox + board.boardX * PX_PER_METER), y - (it.oy + BOARD_Y * PX_PER_METER));
    if (d <= PREDICT.boardReach * PX_PER_METER && nextPredictable(t)) add(d, `predict-${link.status?.predict?.key ?? "open"}`, ICON.predict, TEXT.predict, link.status?.predict ? TEXT.predictDone : TEXT.predictOpen, () => say(TEXT.boardHint));
    return out;
  }
  const nearest = (spots: readonly number[]): { i: number; d: number } | undefined => {
    let best: { i: number; d: number } | undefined;
    for (const i of spots) {
      if (taken.has(i)) continue;
      const d = Math.hypot(SPOTS[i].sx - x, SPOTS[i].sy - y);
      if (d <= USE_DISTANCE && (!best || d < best.d)) best = { i, d };
    }
    return best;
  };
  for (const ground of GROUND_IDS) {
    const seat = nearest(SOCIAL_SITES.touchline[ground]);
    const match = seat ? currentPitchMatch(ground, t) : undefined;
    if (seat && match && matchState(match, t.total).phase !== "full") add(seat.d, `watch-${seat.i}`, ICON.watch, TEXT.watch, `${pitchTitle(match, t.total)} · ${TOUCHLINE_LABEL}`, () => use(seat.i));
  }
  const ring = SOCIAL_SITES.gyration;
  if (ring && liveEvent("gyration", t)) {
    const spot = nearest(ring.spots);
    if (spot) add(spot.d, `gyrate-${spot.i}`, ICON.gyrate, TEXT.gyrate, `${TEXT.gyrateDetail} · ${GYRATION_LABEL}`, () => use(spot.i));
  }
  const forecourt = SOCIAL_SITES.forecourt;
  if (forecourt && liveEvent("games", t)) {
    const spot = nearest(forecourt.spots);
    if (spot) add(spot.d, `games-${spot.i}`, ICON.games, TEXT.games, `${TEXT.gamesDetail} · ${FORECOURT_LABEL}`, () => use(spot.i));
  }
  if (liveEvent("signout", t)) {
    const signed = new Set(link.status?.signed ?? []);
    SOCIAL_SITES.finalists.forEach((f, i) => {
      const d = Math.hypot(f.x - x, f.y - y);
      if (d <= SIGN_SHIRT.reach && !signed.has(i)) add(d, `sign-${i}`, ICON.sign, TEXT.sign, TEXT.signDetail, () => link.send({ a: "sign", i }));
    });
  }
  return out;
}

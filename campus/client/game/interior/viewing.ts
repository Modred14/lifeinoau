import * as THREE from "three";
import {
  DAYS,
  SEATS,
  VIEWING,
  VIEWING_SEAT_LABEL,
  currentMatch,
  gameTime,
  matchState,
  matchesFor,
  viewingArea,
  type FootballMatch,
  type Interior,
  type MatchState,
  type Prop,
} from "@campuslife/shared";
import { disposeLabel, makeLabel } from "../labels";
import { Crowd, type CrowdSeat, type CrowdStander } from "./crowd";
import type { Kit } from "./kit";
import { FRAME, SCREEN, STEEL } from "./palette";
import type { VenueHooks, VenueLife } from "./stage";

const SCREEN_BASE = 0.95;
const SCREEN_H = 2.2;
const PITCH_GREEN = 0x1f8a3a;
const IDLE_BLUE = 0x12305a;
const LINE_WHITE = 0xf2f2ee;
const BALL = 0xffffff;
const SIDE = 6;
const REFRESH_SECONDS = 0.5;
const CROWD_SHARE: Record<FootballMatch["tier"], number> = { normal: 0.45, derby: 0.8, final: 0.95 };
const BACK_STANDERS = 8;
const LABEL = { score: 0.024, board: 0.018 };
const BOARD_BACKGROUND = "rgba(28,58,46,0.95)";
const SCORE_BACKGROUND = "rgba(12,16,24,0.92)";
const TEXT = {
  idle: "TV room. No match now.",
  none: "No match today. TV room is free.",
  today: "TODAY",
  next: "Next",
  half: "HT",
  full: "FT",
  gate: "Gate",
};

const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

export function projectorScreen(kit: Kit, p: Prop) {
  kit.box(FRAME, p.w + 0.16, SCREEN_H + 0.16, 0.04, p.x, SCREEN_BASE - 0.08, p.y);
  kit.box(SCREEN, p.w, SCREEN_H, 0.03, p.x, SCREEN_BASE, p.y + 0.03);
  kit.box(STEEL, 0.35, 0.18, 0.4, p.x, SCREEN_BASE + SCREEN_H + 0.1, p.y + 3.2);
  kit.box(STEEL, 0.04, 0.3, 0.04, p.x, SCREEN_BASE + SCREEN_H + 0.28, p.y + 3.2);
}

function pitchLines(w: number, h: number): THREE.BufferGeometry {
  const pts: number[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => pts.push(ax, ay, 0, bx, by, 0);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    line(x0, y0, x1, y0);
    line(x1, y0, x1, y1);
    line(x1, y1, x0, y1);
    line(x0, y1, x0, y0);
  };
  const hw = w / 2 - 0.12;
  const hh = h / 2 - 0.12;
  rect(-hw, -hh, hw, hh);
  line(0, -hh, 0, hh);
  rect(-hw, -hh * 0.55, -hw + w * 0.14, hh * 0.55);
  rect(hw - w * 0.14, -hh * 0.55, hw, hh * 0.55);
  const r = hh * 0.3;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const b = ((i + 1) / 16) * Math.PI * 2;
    line(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r, Math.sin(b) * r);
  }
  return new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
}

class Broadcast {
  private surface: THREE.MeshBasicMaterial;
  private lines: THREE.LineSegments;
  private dots: THREE.Points;
  private positions: THREE.BufferAttribute;
  private colors: THREE.BufferAttribute;
  private root = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private time = 0;
  private live = false;

  constructor(group: THREE.Group, private w: number, x: number, z: number) {
    this.root.position.set(x, SCREEN_BASE + SCREEN_H / 2, z);
    this.surface = new THREE.MeshBasicMaterial({ color: IDLE_BLUE });
    const plane = new THREE.PlaneGeometry(w - 0.08, SCREEN_H - 0.08);
    this.root.add(new THREE.Mesh(plane, this.surface));
    const lineMaterial = new THREE.LineBasicMaterial({ color: LINE_WHITE });
    const lineGeometry = pitchLines(w, SCREEN_H);
    this.lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    this.lines.position.z = 0.01;
    const dotGeometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array((SIDE * 2 + 1) * 3), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array((SIDE * 2 + 1) * 3), 3);
    dotGeometry.setAttribute("position", this.positions);
    dotGeometry.setAttribute("color", this.colors);
    const dotMaterial = new THREE.PointsMaterial({ size: 0.16, vertexColors: true });
    this.dots = new THREE.Points(dotGeometry, dotMaterial);
    this.dots.position.z = 0.02;
    this.dots.frustumCulled = false;
    this.root.add(this.lines, this.dots);
    this.disposables.push(this.surface, plane, lineMaterial, lineGeometry, dotGeometry, dotMaterial);
    group.add(this.root);
    this.show(undefined, false);
  }

  show(match: FootballMatch | undefined, playing: boolean) {
    this.live = playing;
    this.surface.color.set(match ? PITCH_GREEN : IDLE_BLUE);
    this.lines.visible = this.dots.visible = !!match;
    if (!match) return;
    const tint = new THREE.Color();
    for (let i = 0; i <= SIDE * 2; i++) {
      tint.set(i === SIDE * 2 ? BALL : i < SIDE ? match.home.color : match.away.color);
      this.colors.setXYZ(i, tint.r, tint.g, tint.b);
    }
    this.colors.needsUpdate = true;
    this.step(0);
  }

  step(dt: number) {
    if (!this.dots.visible) return;
    if (this.live) this.time += dt;
    const hw = this.w / 2 - 0.3;
    const hh = SCREEN_H / 2 - 0.25;
    const t = this.time;
    const bx = Math.sin(t * 0.43) * hw * 0.85;
    const by = Math.sin(t * 0.71 + 1.3) * hh * 0.8;
    for (let i = 0; i < SIDE * 2; i++) {
      const home = i < SIDE;
      const k = i % SIDE;
      const lane = ((k % 3) - 1) * hh * 0.6;
      const depth = (home ? -1 : 1) * hw * (k < 3 ? 0.55 : 0.15);
      const pull = k < 3 ? 0.18 : 0.4;
      this.positions.setXYZ(i, depth + bx * pull + Math.sin(t * 0.9 + i * 1.7) * 0.12, lane + by * pull + Math.cos(t * 0.8 + i * 2.3) * 0.1, 0);
    }
    this.positions.setXYZ(SIDE * 2, bx, by, 0);
    this.positions.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent();
    this.disposables.forEach((item) => item.dispose());
  }
}

export class ViewingLife implements VenueLife {
  private broadcast: Broadcast;
  private crowd: Crowd;
  private score?: THREE.Sprite;
  private board?: THREE.Sprite;
  private key = "";
  private boardKey = "";
  private wait = REFRESH_SECONDS;
  private area: ReturnType<typeof viewingArea>;

  constructor(it: Interior, private group: THREE.Group, private hooks: VenueHooks) {
    const t = it.template;
    this.area = viewingArea(t.w);
    this.broadcast = new Broadcast(group, this.area.screenW, this.area.mid, this.area.screenY + 0.08);
    const seats: CrowdSeat[] = [];
    t.spots.forEach((s, i) => {
      if (s.label === VIEWING_SEAT_LABEL && s.seat) seats.push({ x: s.x, y: s.y, floor: s.floor ?? 0, face: s.face, seatH: SEATS[s.seat].h, spot: it.spotStart + i });
    });
    const backY = VIEWING.firstRow + VIEWING.rows * VIEWING.pitch + 0.4;
    const standers: CrowdStander[] = Array.from({ length: BACK_STANDERS }, (_, i) => ({ x: this.area.mid - 3 + i * 0.85, y: backY + (i % 2) * 0.5, floor: 0, face: -Math.PI / 2 }));
    this.crowd = new Crowd(group, seats, standers, it.place * 7919 + 17);
  }

  private label(old: THREE.Sprite | undefined, text: string, height: number, background: string, x: number, y: number, z: number): THREE.Sprite {
    if (old) disposeLabel(old);
    const sprite = makeLabel(text, { screenHeight: height, background });
    sprite.position.set(x, y, z);
    this.group.add(sprite);
    return sprite;
  }

  private scoreText(match: FootballMatch | undefined, state: MatchState | undefined, dayIndex: number): string {
    if (match && state) {
      const when = state.phase === "soon" ? hhmm(match.kickoff) : state.phase === "half" ? TEXT.half : state.phase === "full" ? TEXT.full : `${state.minute}'`;
      return `${match.home.code} ${state.home} : ${state.away} ${match.away.code} · ${when}`;
    }
    for (let d = 0; d < 7; d++) {
      const next = matchesFor(dayIndex + d).find((m) => d > 0 || m.startTotal > Math.floor(this.hooks.minutes()));
      if (next) return `${TEXT.next}: ${next.home.code} v ${next.away.code}, ${DAYS[(((dayIndex + d) % 7) + 7) % 7].slice(0, 3)} ${hhmm(next.kickoff)}`;
    }
    return TEXT.idle;
  }

  private refresh() {
    const t = gameTime(Math.floor(this.hooks.minutes()));
    const match = currentMatch(t);
    const state = match ? matchState(match, t.total) : undefined;
    const playing = state?.phase === "first" || state?.phase === "second";
    const key = match && state ? `${match.key}:${state.phase}:${state.minute}:${state.home}:${state.away}` : `idle:${t.dayIndex}:${Math.floor(t.minute / 30)}`;
    if (key !== this.key) {
      this.key = key;
      this.broadcast.show(match, playing);
      this.score = this.label(this.score, this.scoreText(match, state, t.dayIndex), LABEL.score, SCORE_BACKGROUND, this.area.mid, SCREEN_BASE + SCREEN_H + 0.45, this.area.screenY + 0.1);
    }
    const boardKey = String(t.dayIndex);
    if (boardKey !== this.boardKey) {
      this.boardKey = boardKey;
      const today = matchesFor(t.dayIndex);
      const text = today.length ? `${TEXT.today}: ${today.map((m) => `${m.home.code} v ${m.away.code} ${hhmm(m.kickoff)}`).join(" · ")} · ${TEXT.gate} ${naira(Math.max(...today.map((m) => m.fee)))}` : TEXT.none;
      this.board = this.label(this.board, text, LABEL.board, BOARD_BACKGROUND, this.area.boardX, 2.5, 0.3);
    }
    const share = match && state && state.phase !== "full" ? CROWD_SHARE[match.tier] * (state.phase === "soon" ? 0.5 : 1) : 0;
    this.crowd.set(share, this.hooks.taken(), match && match.tier !== "normal" && playing ? 1 : 0, playing);
  }

  update(dt: number) {
    this.wait += dt;
    if (this.wait >= REFRESH_SECONDS) {
      this.wait = 0;
      this.refresh();
    }
    this.broadcast.step(dt);
    this.crowd.update(dt);
  }

  dispose() {
    if (this.score) disposeLabel(this.score);
    if (this.board) disposeLabel(this.board);
    this.broadcast.dispose();
    this.crowd.dispose();
  }
}

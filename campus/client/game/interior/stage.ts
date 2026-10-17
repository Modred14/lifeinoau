import * as THREE from "three";
import { DAYS, SEATS, SHOW_KINDS, gameTime, nextShows, showAt, type Interior, type Prop, type Show, type ShowKind, type Template } from "@campuslife/shared";
import { Character } from "../characters";
import { disposeLabel, makeLabel } from "../labels";
import { backdrop, lightingTruss, speakerStack, stageDeck, terraceBench, trussHeight, wing } from "./amphitheatre";
import { curtain, parapet, seatRow } from "./auditorium";
import { Crowd, type CrowdSeat, type CrowdStander } from "./crowd";
import type { Kit } from "./kit";
import { ViewingLife, projectorScreen } from "./viewing";

export interface VenueHooks {
  minutes(): number;
  taken(): ReadonlySet<number>;
}

export interface VenueLife {
  update(dt: number): void;
  dispose(): void;
}

export function venueProp(kit: Kit, t: Template, p: Prop): boolean {
  switch (p.type) {
    case "terrace":
      terraceBench(kit, p);
      return true;
    case "stage":
      stageDeck(kit, p);
      return true;
    case "speaker":
      speakerStack(kit, p);
      return true;
    case "truss":
      lightingTruss(kit, p);
      return true;
    case "backdrop":
      backdrop(kit, p);
      return true;
    case "wing":
      wing(kit, t, p);
      return true;
    case "seatrow":
      seatRow(kit, p);
      return true;
    case "curtain":
      curtain(kit, p);
      return true;
    case "parapet":
      parapet(kit, p);
      return true;
    case "projector":
      projectorScreen(kit, p);
      return true;
    default:
      return false;
  }
}

const PERFORMER_LOOKS = [
  "m|casual|casual|casual|casual|3|0|5|1|0",
  "f|owambe|owambe|owambe|owambe|1|0|9|9|0",
  "m|corporate|corporate|corporate|corporate|0|0|3|0|0",
  "f|casual|casual|casual|casual|2|0|12|4|0",
];
const CAST: Record<ShowKind, { count: number; pose: "dance" | "busy" }> = {
  concert: { count: 4, pose: "dance" },
  comedy: { count: 1, pose: "busy" },
  play: { count: 3, pose: "busy" },
  gospel: { count: 4, pose: "dance" },
  movie: { count: 0, pose: "busy" },
  dinner: { count: 2, pose: "busy" },
  carnival: { count: 4, pose: "dance" },
  freshers: { count: 3, pose: "dance" },
  talent: { count: 2, pose: "dance" },
  pageant: { count: 4, pose: "busy" },
  lecture: { count: 1, pose: "busy" },
  quiz: { count: 3, pose: "busy" },
};
const LIGHT_COLORS = [0xff2d95, 0x2dd4ff, 0xffd166, 0x7c3aed, 0x22c55e];
const LIGHTS = 5;
const BEAM_RADIUS = 1.3;
const BEAM_OPACITY = 0.16;
const SWING = 0.38;
const REFRESH_SECONDS = 0.5;
const CROWD_BASE = 0.3;
const CROWD_SPREAD = 0.45;
const FREE_CROWD_BONUS = 0.1;
const TITLE_HEIGHT = 0.03;
const NEXT_HEIGHT = 0.02;
const LIVE_BACKGROUND = "rgba(120,20,60,0.94)";
const NEXT_BACKGROUND = "rgba(16,30,25,0.9)";
const STANDER_OFFSETS: [number, number][] = [[0.9, 0.75], [-0.6, 0.9], [0.25, -0.85]];
const hhmm = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

class StageLife implements VenueLife {
  private crowd: Crowd;
  private cast: Character[] = [];
  private beams: THREE.Mesh[] = [];
  private beamGeometry: THREE.ConeGeometry;
  private beamMaterials: THREE.MeshBasicMaterial[];
  private title?: THREE.Sprite;
  private key = "";
  private wait = REFRESH_SECONDS;
  private time = 0;
  private stage: Prop;
  private trussY: number;
  private trussZ: number;

  constructor(private it: Interior, private group: THREE.Group, private hooks: VenueHooks) {
    const t = it.template;
    this.stage = t.props.find((p) => p.type === "stage") ?? { type: "stage", x: t.w / 2, y: 3, w: 10, d: 5 };
    const truss = t.props.find((p) => p.type === "truss");
    this.trussY = truss ? trussHeight(truss) - 0.75 : (this.stage.floor ?? 0) + 3.6;
    this.trussZ = truss?.y ?? this.stage.y;
    const seats: CrowdSeat[] = [];
    const standers: CrowdStander[] = [];
    t.spots.forEach((s, i) => {
      if (s.kind === "sit" && s.seat) seats.push({ x: s.x, y: s.y, floor: s.floor ?? 0, face: s.face, seatH: SEATS[s.seat].h, spot: it.spotStart + i });
      if (s.kind === "dance") for (const [dx, dy] of STANDER_OFFSETS) standers.push({ x: s.x + dx, y: s.y + dy, floor: s.floor ?? 0, face: s.face });
    });
    this.crowd = new Crowd(group, seats, standers, it.place * 7919 + 3);
    this.beamGeometry = new THREE.ConeGeometry(BEAM_RADIUS, 1, 14, 1, true).translate(0, -0.5, 0);
    this.beamMaterials = LIGHT_COLORS.map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: BEAM_OPACITY, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    for (let i = 0; i < LIGHTS; i++) {
      const beam = new THREE.Mesh(this.beamGeometry, this.beamMaterials[i % this.beamMaterials.length]);
      beam.position.set(this.stage.x - this.stage.w / 2 + (this.stage.w / LIGHTS) * (i + 0.5), this.trussY, this.trussZ);
      beam.scale.y = this.trussY - (this.stage.floor ?? 0);
      beam.visible = false;
      beam.renderOrder = 5;
      group.add(beam);
      this.beams.push(beam);
    }
  }

  private setTitle(text: string, live: boolean) {
    if (this.title) disposeLabel(this.title);
    this.title = makeLabel(text, { screenHeight: live ? TITLE_HEIGHT : NEXT_HEIGHT, background: live ? LIVE_BACKGROUND : NEXT_BACKGROUND });
    this.title.position.set(this.stage.x, (this.stage.floor ?? 0) + 4.4, this.stage.y - this.stage.d / 2 + 0.5);
    this.group.add(this.title);
  }

  private clearCast() {
    this.cast.forEach((c) => {
      c.root.removeFromParent();
      c.dispose();
    });
    this.cast = [];
  }

  private stageShow(show: Show) {
    this.clearCast();
    const { count, pose } = CAST[show.kind];
    const seed = seedOf(show.key);
    for (let i = 0; i < count; i++) {
      const char = new Character(PERFORMER_LOOKS[(seed + i) % PERFORMER_LOOKS.length]);
      const spread = count > 1 ? (i / (count - 1) - 0.5) * Math.min(this.stage.w * 0.5, count * 1.8) : 0;
      char.root.position.set(this.stage.x + spread, 0, this.stage.y + this.stage.d * 0.18 + (i % 2) * 0.7);
      char.root.rotation.y = 0;
      char.setPose(pose);
      this.group.add(char.root);
      this.cast.push(char);
    }
    this.setTitle(`${SHOW_KINDS[show.kind].emoji} ${show.title} · ${show.act}`, true);
  }

  private refresh() {
    const t = gameTime(Math.floor(this.hooks.minutes()));
    const show = showAt(this.it.place, t);
    const key = show ? show.key : `quiet:${t.dayIndex}:${Math.floor(t.minute / 30)}`;
    if (key !== this.key) {
      this.key = key;
      if (show) this.stageShow(show);
      else {
        this.clearCast();
        const next = nextShows(t, 12).find((s) => s.place === this.it.place);
        if (next) this.setTitle(`Next: ${next.title}, ${DAYS[((next.dayIndex % 7) + 7) % 7].slice(0, 3)} ${hhmm(next.start)}`, false);
      }
      for (const beam of this.beams) beam.visible = !!show;
    }
    if (!show) return this.crowd.set(0, this.hooks.taken(), 0, false);
    const share = CROWD_BASE + ((seedOf(show.key) % 100) / 100) * CROWD_SPREAD + (show.fee ? 0 : FREE_CROWD_BONUS);
    this.crowd.set(share, this.hooks.taken(), show.dance ? 1 : 0, show.dance);
  }

  update(dt: number) {
    this.wait += dt;
    this.time += dt;
    if (this.wait >= REFRESH_SECONDS) {
      this.wait = 0;
      this.refresh();
    }
    for (const c of this.cast) c.update(dt, 0);
    this.beams.forEach((beam, i) => {
      if (!beam.visible) return;
      beam.rotation.x = 0.25 + Math.sin(this.time * 0.9 + i * 1.3) * SWING;
      beam.rotation.z = Math.sin(this.time * 0.7 + i * 2.1) * SWING;
    });
    this.crowd.update(dt);
  }

  dispose() {
    this.clearCast();
    if (this.title) disposeLabel(this.title);
    this.beams.forEach((beam) => beam.removeFromParent());
    this.beamGeometry.dispose();
    this.beamMaterials.forEach((m) => m.dispose());
    this.crowd.dispose();
  }
}

export function createVenueLife(it: Interior, group: THREE.Group, hooks: VenueHooks): VenueLife | undefined {
  const id = it.template.id;
  if (id === "amphitheatre" || id === "auditorium") return new StageLife(it, group, hooks);
  if (id === "hostel") return new ViewingLife(it, group, hooks);
  return undefined;
}

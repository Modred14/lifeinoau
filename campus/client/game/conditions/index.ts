import type * as THREE from "three";
import {
  CONDITION_SITES,
  GENERATOR_PLACES,
  Msg,
  PLACES,
  PX_PER_METER,
  ServerMsg,
  campusLight,
  conditionsNow,
  darkIndoors,
  daylight,
  gameMinutesAt,
  gameTime,
  generatorRunning,
  isJackingTime,
  isReadingRoom,
  nightIndex,
  npcReaders,
  parseConditionsPayload,
  placeLight,
  type ConditionSite,
  type ConditionsNow,
  type ConditionsPayload,
  type GameTime,
  type Point,
  type ZoneLight,
} from "@campuslife/shared";
import type { Interior } from "@campuslife/shared/interiors";
import { generatorLevel } from "../ambience/generator";
import { Character } from "../characters";
import { toWorld } from "../coords";
import { NightReaders } from "../interior/night-readers";
import type { CampusRoom } from "../network";
import { DarkRoom } from "./dark-room";
import { conditionsPrompts, type ConditionsPrompt } from "./prompts";
import { buildSiteProps, siteYaw, type SiteProps } from "./props";
import { buildSiteQueues, type SiteQueues } from "./queue";

export interface ConditionsView {
  now: ConditionsNow;
  zones: ZoneLight[];
  me: ConditionsPayload;
}

const WELL: ConditionsPayload = { illness: "", unwashed: false, nights: 0, rest: 0 };
const SLOW_EVERY_FRAMES = 12;
const ATTENDANT_DISTANCE_M = 70;
const ATTENDANT_BACK_M: Partial<Record<ConditionSite["kind"], number>> = { clinic: 0.75, chemist: 0.3 };
const ATTENDANT_LOOK: Partial<Record<ConditionSite["kind"], string>> = {
  clinic: "f|corporate|corporate|corporate|corporate|0|0|3|0|0",
  chemist: "m|casual|casual|casual|casual|3|0|5|1|0",
};
const DIM = { night: 0.04, day: 0.6 };

export class ConditionsLayer {
  me: ConditionsPayload = WELL;
  hum = 0;
  private props: SiteProps;
  private queues: SiteQueues;
  private readers = new NightReaders();
  private darkRoom = new DarkRoom();
  private attendants = new Map<number, Character>();
  private unsubscribe: () => void;
  private time: GameTime = gameTime(gameMinutesAt(Date.now()));
  private inside = -1;
  private at: Point = { x: 0, y: 0 };
  private frameN = 0;

  constructor(private scene: THREE.Scene, private room: CampusRoom, shadows: boolean) {
    this.props = buildSiteProps(shadows);
    this.queues = buildSiteQueues();
    scene.add(this.props.group, this.queues.group);
    this.unsubscribe = room.onMessage(ServerMsg.Conditions, (payload: unknown) => {
      this.me = parseConditionsPayload(payload) ?? this.me;
    });
    room.send(Msg.Conditions, { sync: true });
  }

  enterInterior(it: Interior, scene: THREE.Scene) {
    this.readers.enter(it, scene);
    this.darkRoom.enter(it, scene);
  }

  leaveInterior() {
    this.readers.leave();
    this.darkRoom.leave();
  }

  frame(dt: number, focus: THREE.Vector3, t: GameTime, at: Point | undefined, inside: number, taken: () => Iterable<number>) {
    this.time = t;
    this.inside = inside;
    if (at) this.at = { x: at.x, y: at.y };
    this.darkRoom.animate(dt);
    for (const attendant of this.attendants.values()) if (attendant.root.visible) attendant.update(dt, 0);
    if (this.frameN++ % SLOW_EVERY_FRAMES !== 0) return;
    const outdoors = inside < 0;
    this.props.group.visible = outdoors;
    this.queues.group.visible = outdoors;
    this.staff(outdoors);
    this.hum = this.generatorNear();
    if (outdoors) {
      this.props.update(focus);
      this.queues.update(t);
      return;
    }
    this.darkRoom.set(darkIndoors(inside, t));
    const reading = isReadingRoom(inside) && isJackingTime(t.minute) && placeLight(inside, t.total).lit;
    this.readers.refresh(reading ? `jack:${nightIndex(t)}` : "", reading ? npcReaders(inside, nightIndex(t)) : 0, taken());
  }

  indoorLight(): number {
    if (this.inside < 0 || placeLight(this.inside, this.time.total).lit) return 1;
    return DIM.night + (DIM.day - DIM.night) * daylight(this.time.minute);
  }

  prompts(x: number, y: number, inside: number, t: GameTime): ConditionsPrompt[] {
    return conditionsPrompts(this.me, x, y, inside, t, (site) => this.room.send(Msg.Conditions, { site }));
  }

  view(): ConditionsView {
    return { now: conditionsNow(this.time, this.inside, this.at), zones: campusLight(this.time.total), me: this.me };
  }

  dispose() {
    this.unsubscribe();
    this.leaveInterior();
    this.props.dispose();
    this.queues.dispose();
    for (const attendant of this.attendants.values()) attendant.dispose();
    this.attendants.clear();
  }

  private staff(outdoors: boolean) {
    for (const site of CONDITION_SITES) {
      const look = ATTENDANT_LOOK[site.kind];
      if (!look) continue;
      const near = outdoors && Math.hypot(site.x - this.at.x, site.y - this.at.y) / PX_PER_METER < ATTENDANT_DISTANCE_M;
      let attendant = this.attendants.get(site.id);
      if (!attendant && near) {
        attendant = new Character(look);
        const back = (ATTENDANT_BACK_M[site.kind] ?? 0) * PX_PER_METER;
        attendant.root.position.set(toWorld(site.x - Math.cos(site.face) * back), 0, toWorld(site.y - Math.sin(site.face) * back));
        attendant.root.rotation.y = siteYaw(site);
        this.scene.add(attendant.root);
        this.attendants.set(site.id, attendant);
      }
      if (attendant) attendant.root.visible = near;
    }
  }

  private generatorNear(): number {
    let best = 0;
    for (const place of GENERATOR_PLACES) {
      if (!generatorRunning(place, this.time.total)) continue;
      if (place === this.inside) return 1;
      if (this.inside >= 0) continue;
      const door = PLACES[place].door;
      best = Math.max(best, generatorLevel(Math.hypot(door.x - this.at.x, door.y - this.at.y) / PX_PER_METER));
    }
    return best;
  }
}

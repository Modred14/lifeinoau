import type * as THREE from "three";
import { STALLS, gameMinutesAt, gameTime, stallOpen, type GameTime } from "@campuslife/shared";
import type { CampusRoom } from "../network";
import { STALLS_GROUP, shutterStalls } from "../scenery/stalls";
import { buildPitches, type PitchLayer } from "../sport/pitch";
import { SocialLink } from "./link";
import { buildSocialProps, type SocialProps } from "./props";
import { socialPrompts, type SocialPrompt } from "./prompts";

export { SocialLink } from "./link";
export type { SocialPrompt } from "./prompts";

const SHUTTER_EVERY_MINUTES = 5;

export class SocialLayer {
  readonly link: SocialLink;
  time: GameTime = gameTime(gameMinutesAt(Date.now()));
  private props: SocialProps;
  private pitches: PitchLayer;
  private stalls?: THREE.Object3D;
  private shutterSlot = -1;

  constructor(private scene: THREE.Scene, room: CampusRoom) {
    this.link = new SocialLink(room);
    this.props = buildSocialProps();
    this.pitches = buildPitches();
    scene.add(this.props.group, this.pitches.group);
  }

  frame(focus: THREE.Vector3, minutes: number, outdoors: boolean) {
    const t = gameTime(Math.floor(minutes));
    this.time = t;
    this.props.group.visible = outdoors;
    this.pitches.group.visible = outdoors;
    if (!outdoors) return;
    this.props.update(focus, t, minutes);
    this.pitches.update(focus, t, minutes);
    const slot = Math.floor(t.total / SHUTTER_EVERY_MINUTES);
    if (slot === this.shutterSlot) return;
    this.shutterSlot = slot;
    this.stalls ??= this.scene.getObjectByName(STALLS_GROUP);
    if (this.stalls && this.stalls.children.length === STALLS.length) shutterStalls(this.stalls, (index) => !stallOpen(index, t));
  }

  prompts(x: number, y: number, inside: number, t: GameTime, taken: ReadonlySet<number>, use: (spot: number) => void, say: (text: string) => void): SocialPrompt[] {
    return socialPrompts(this.link, x, y, inside, t, taken, use, say);
  }

  dispose() {
    this.link.dispose();
    this.props.dispose();
    this.pitches.dispose();
  }
}

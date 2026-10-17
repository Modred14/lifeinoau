import type * as THREE from "three";
import { gameMinutesAt, gameTime, type GameTime } from "@campuslife/shared";
import type { CampusRoom } from "../network";
import { buildUnionCrowds, type UnionCrowds } from "./crowd";
import { PoliticsLink } from "./link";
import { buildPoliticsProps, type PoliticsProps } from "./props";
import { debateAlt, liveSittings, politicsPrompts, type PoliticsPrompt } from "./prompts";

export { officeTag, playerTag, retag } from "./tag";
export { PoliticsLink, type PoliticsPanel, type PoliticsSend } from "./link";

export class PoliticsLayer {
  readonly link: PoliticsLink;
  time: GameTime = gameTime(gameMinutesAt(Date.now()));
  private props: PoliticsProps;
  private crowds: UnionCrowds;

  constructor(scene: THREE.Scene, room: CampusRoom, shadows: boolean) {
    this.link = new PoliticsLink(room, () => this.time);
    this.props = buildPoliticsProps(shadows);
    this.crowds = buildUnionCrowds();
    scene.add(this.props.group, this.crowds.group);
  }

  frame(focus: THREE.Vector3, t: GameTime, outdoors: boolean) {
    this.time = t;
    this.props.group.visible = outdoors;
    this.crowds.group.visible = outdoors;
    if (!outdoors) return;
    this.props.update(focus, t);
    this.crowds.update(focus, t, this.link.world?.states ?? [], liveSittings(this.link, t));
  }

  prompts(x: number, y: number, inside: number, t: GameTime): PoliticsPrompt[] {
    return politicsPrompts(this.link, x, y, inside, t);
  }

  seatedAlt(place: number, t: GameTime) {
    return debateAlt(this.link, place, t);
  }

  dispose() {
    this.link.dispose();
    this.props.dispose();
    this.crowds.dispose();
  }
}

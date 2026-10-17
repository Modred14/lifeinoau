import type * as THREE from "three";
import { officeTitle, withStatus } from "@campuslife/shared";
import { makeLabel } from "../labels";

const TAG_HEIGHT = 0.026;
const LOCAL_TAG = { background: "rgba(250,204,21,0.95)", color: "#1c1917" };
const REMOTE_TAG = { background: "rgba(29,78,216,0.85)", color: "#ffffff" };

export function officeTag(name: string, office: number | undefined): string {
  const title = officeTitle(office ?? 0);
  return title ? `${name} · ${title}` : name;
}

export function playerTag(name: string, office: number | undefined, status: number | undefined): string {
  return withStatus(officeTag(name, office), status);
}

export function retag(tag: THREE.Sprite, text: string, isLocal: boolean) {
  const next = makeLabel(text, { screenHeight: TAG_HEIGHT, ...(isLocal ? LOCAL_TAG : REMOTE_TAG) });
  tag.material.map?.dispose();
  tag.material.dispose();
  tag.material = next.material;
  tag.scale.copy(next.scale);
}

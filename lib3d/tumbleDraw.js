// lib3d/tumbleDraw.js
// Puts a character where lib3d/impact.js says a struck person is: rotated about their centre of mass (so they lie ON the ground, not in it) and thrown through the air.
// The only three.js part of the hit physics. `root` is the character's Object3D (feet at its origin); `ground` is the height of the ground under it (the walkers stand at 0.1).
import * as THREE from "three";
import { tumblePose } from "./impact.js";

const UP = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), qa = new THREE.Quaternion(), qy = new THREE.Quaternion(), pose = {};

/** Draws a struck person (tumble state `tb`) with the character `root`. */
export function drawTumble(root, tb, ground = 0.1) {
  tumblePose(tb, pose);
  root.position.set(pose.x, ground + pose.y, pose.z);
  qy.setFromAxisAngle(UP, pose.yaw); axis.set(pose.ax, 0, pose.az); qa.setFromAxisAngle(axis, pose.tilt);
  root.quaternion.copy(qa).multiply(qy);
}
/** The person is on their feet again: upright, facing `yaw`. (Setting only rotation.y would keep the old tilt in the other two angles.) */
export function endTumble(root, yaw) { root.rotation.set(0, yaw, 0); }

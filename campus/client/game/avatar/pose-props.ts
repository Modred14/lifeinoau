import * as THREE from "three";
import { dishFor, type Dish } from "../interior/dishes";
import { makeDrink, makeHeld, makeNotebook, makePen, makePlate, makeSpoon } from "../interior/food-props";
import type { ActivityPose } from "./activity-pose";
import type { PoseDetail } from "./pose-detail";

export class PoseProps {
  readonly group = new THREE.Group();
  private plate?: THREE.Mesh;
  private inHand?: THREE.Mesh;
  private offHand?: THREE.Mesh;
  private carried: boolean;
  private dish?: Dish;

  constructor(detail: PoseDetail, seated: boolean) {
    this.group.name = "pose-props";
    this.carried = !seated;
    const surface = detail.surface;
    if (detail.variant === "write" && surface) {
      const book = makeNotebook();
      book.position.set(-0.03, surface.h, surface.near + 0.15);
      book.rotation.y = 0.12;
      this.inHand = makePen();
      this.inHand.rotation.x = 0.5;
      this.group.add(book, this.inHand);
      return;
    }
    if (detail.variant !== "eat") return;
    const dish = (this.dish = dishFor(detail.dish));
    if (dish.plate && (seated || !dish.held)) this.plate = makePlate(dish);
    if (dish.held) this.inHand = makeHeld(dish.held);
    else if (dish.spoon) this.inHand = makeSpoon();
    if (dish.drink) {
      const drink = makeDrink(dish.drink.kind, dish.drink.color);
      if (seated && surface) {
        drink.position.set(0.25, surface.h, surface.near + 0.3);
        this.group.add(drink);
      } else if (!this.plate) this.offHand = drink;
    }
    for (const prop of [this.plate, this.inHand, this.offHand]) if (prop) this.group.add(prop);
  }

  update(pose: ActivityPose) {
    this.plate?.position.copy(pose.plate);
    if (this.inHand) {
      this.inHand.position.copy(pose.rightHand);
      if (this.dish?.held) {
        this.inHand.position.y += 0.04;
        this.inHand.rotation.x = -0.5 * pose.lift;
      } else if (this.dish) this.inHand.rotation.x = -0.3 - 0.6 * pose.lift;
    }
    if (this.offHand) {
      this.offHand.position.copy(pose.leftHand);
      this.offHand.position.y -= this.carried ? 0.03 : 0;
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

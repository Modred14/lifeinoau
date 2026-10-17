import {
  CLOTH_COLORS,
  HAIR_COLORS,
  decodeLook,
  encodeLook,
  type BodyType,
  type Look,
  type OutfitDef,
  type Slot,
} from "@campuslife/shared/avatar";
import type { StudioThumbnailRequest } from "@campus/game/studio-thumbnails";
import type { GameIconName } from "../GameIcon";

export type WardrobeTab = "body" | "hair" | "outfits" | "top" | "bottom" | "shoes";

export const WARDROBE_TABS: { id: WardrobeTab; label: string; icon: GameIconName }[] = [
  { id: "body", label: "Body", icon: "person" },
  { id: "hair", label: "Hair", icon: "hair" },
  { id: "outfits", label: "Outfits", icon: "wardrobe" },
  { id: "top", label: "Tops", icon: "shirt" },
  { id: "bottom", label: "Bottoms", icon: "pants" },
  { id: "shoes", label: "Shoes", icon: "shoes" },
];

export const COLOR_NAMES = ["White", "Black", "Grey", "Navy", "Blue", "Sky blue", "Green", "Lime", "Yellow", "Orange", "Red", "Burgundy", "Pink", "Purple", "Brown", "Beige"];
export const HAIR_NAMES = ["Black", "Dark brown", "Brown", "Burgundy", "Golden", "Silver", "Purple", "Pink"];
export const SKIN_NAMES = ["Deep ebony", "Deep brown", "Dark brown", "Warm brown", "Medium brown", "Golden brown", "Light brown", "Light"];

const PART_CONFIG = {
  hair: { slot: "head", title: "Hairstyle", color: "hair", colors: HAIR_COLORS, names: HAIR_NAMES },
  top: { slot: "top", title: "Pick a top", color: "topColor", colors: CLOTH_COLORS, names: COLOR_NAMES },
  bottom: { slot: "bottom", title: "Pick your bottoms", color: "bottomColor", colors: CLOTH_COLORS, names: COLOR_NAMES },
  shoes: { slot: "shoes", title: "Pick your shoes", color: "shoesColor", colors: CLOTH_COLORS, names: COLOR_NAMES },
} as const;

export function partConfig(tab: WardrobeTab) {
  return tab === "body" || tab === "outfits" ? undefined : PART_CONFIG[tab];
}

export const partImage = (body: BodyType, slot: Slot, id: string) => `/campus/wardrobe/parts/${body}-${slot}-${id}.webp`;
export const outfitImage = (body: BodyType, id: string) => `/campus/wardrobe/parts/${body}-outfit-${id}.webp`;

export function wardrobeThumbnailRequests(look: Look, tab: WardrobeTab, options: readonly OutfitDef[]): StudioThumbnailRequest[] {
  if (tab === "body") {
    return (["m", "f"] as const).map((body) => ({
      key: `body-${body}`,
      look: encodeLook(decodeLook(encodeLook({ ...look, body }))),
      slot: "full",
    }));
  }
  const part = partConfig(tab);
  if (!part || part.slot === "shoes") return [];
  return options.map((option) => ({
    key: `${look.body}-${part.slot}-${option.id}`,
    look: encodeLook({ ...look, [part.slot]: option.id }),
    slot: part.slot,
  }));
}

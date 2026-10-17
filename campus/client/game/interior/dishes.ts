export interface Mound {
  color: number;
  x: number;
  z: number;
  r: number;
  h: number;
}

export interface Held {
  color: number;
  wrap?: number;
  size: [number, number, number];
}

export type DrinkKind = "bottle" | "cup" | "sachet" | "can";

export interface Dish {
  id: string;
  plate: Mound[] | null;
  bowl?: boolean;
  held: Held | null;
  spoon: boolean;
  drink: { kind: DrinkKind; color: number } | null;
}

const WATER = { kind: "sachet", color: 0xdfeefa } as const;
const SOFT_DRINK = { kind: "bottle", color: 0xb5651d } as const;

const DISHES: [RegExp, Dish][] = [
  [/amala|semo|pounded|eba/i, {
    id: "amala",
    plate: [{ color: 0x4a3526, x: -0.035, z: 0.01, r: 0.062, h: 0.05 }, { color: 0x4f7a2a, x: 0.045, z: -0.02, r: 0.05, h: 0.016 }, { color: 0xa5261a, x: 0.04, z: 0.045, r: 0.04, h: 0.018 }],
    held: null, spoon: false, drink: WATER,
  }],
  [/jollof/i, {
    id: "jollof",
    plate: [{ color: 0xc8541e, x: -0.025, z: 0, r: 0.075, h: 0.04 }, { color: 0x9a5a22, x: 0.055, z: -0.03, r: 0.036, h: 0.035 }, { color: 0xd9952b, x: 0.05, z: 0.045, r: 0.03, h: 0.014 }],
    held: null, spoon: true, drink: SOFT_DRINK,
  }],
  [/noodle/i, {
    id: "noodles", bowl: true,
    plate: [{ color: 0xe2b23c, x: 0, z: 0, r: 0.075, h: 0.035 }, { color: 0xf6f1e4, x: 0.03, z: -0.02, r: 0.032, h: 0.03 }, { color: 0xe9a21a, x: 0.03, z: -0.02, r: 0.014, h: 0.038 }],
    held: null, spoon: true, drink: null,
  }],
  [/rice|beans|mama put/i, {
    id: "rice-beans",
    plate: [{ color: 0xf1ecdc, x: -0.03, z: -0.02, r: 0.065, h: 0.038 }, { color: 0x7a4a2a, x: 0.045, z: -0.03, r: 0.045, h: 0.025 }, { color: 0xa5261a, x: 0, z: 0.05, r: 0.04, h: 0.016 }, { color: 0xd9952b, x: 0.06, z: 0.04, r: 0.028, h: 0.014 }],
    held: null, spoon: true, drink: WATER,
  }],
  [/shawarma/i, { id: "shawarma", plate: null, held: { color: 0xe6d3a8, wrap: 0xf4f4f0, size: [0.05, 0.17, 0.05] }, spoon: false, drink: SOFT_DRINK }],
  [/zobo|puff/i, { id: "zobo", plate: [{ color: 0xc98a3a, x: -0.03, z: 0, r: 0.03, h: 0.045 }, { color: 0xc98a3a, x: 0.035, z: 0.02, r: 0.03, h: 0.045 }, { color: 0xb97a30, x: 0.01, z: -0.045, r: 0.03, h: 0.045 }], held: { color: 0xc98a3a, size: [0.05, 0.05, 0.05] }, spoon: false, drink: { kind: "cup", color: 0x6a1026 } }],
  [/suya/i, { id: "suya", plate: null, held: { color: 0x7a3b1c, wrap: 0xd8d2c4, size: [0.03, 0.2, 0.03] }, spoon: false, drink: null }],
  [/boli/i, { id: "boli", plate: null, held: { color: 0xc98f2b, wrap: 0xd8d2c4, size: [0.045, 0.17, 0.045] }, spoon: false, drink: null }],
  [/gala|pure water/i, { id: "gala", plate: null, held: { color: 0xb9813f, wrap: 0xc62828, size: [0.04, 0.15, 0.04] }, spoon: false, drink: WATER }],
  [/biscuit|vending/i, { id: "biscuit", plate: null, held: { color: 0xd9b36c, wrap: 0x1565c0, size: [0.05, 0.1, 0.02] }, spoon: false, drink: { kind: "can", color: 0xc62828 } }],
];

const DEFAULT_DISH: Dish = DISHES[3][1];

export function dishFor(label: string | undefined): Dish {
  if (!label) return DEFAULT_DISH;
  for (const [pattern, dish] of DISHES) if (pattern.test(label)) return dish;
  return DEFAULT_DISH;
}

import type { Background } from "./backgrounds";

export type PhonePlatform = "ios" | "android";
export type PhoneTier = "budget" | "mid" | "upper" | "flagship";
export type PhoneCutout = "teardrop" | "punch" | "notch" | "pill";
export type PhoneFinish = "plastic" | "glass" | "metal";

export interface PhoneFrame {
  body: string;
  edge: string;
  finish: PhoneFinish;
  aspect: number;
  radius: number;
  bezel: number;
  chin: number;
  cutout: PhoneCutout;
  wallpaper: [string, string, string];
  accent: string;
}

export interface Phone {
  id: string;
  name: string;
  platform: PhonePlatform;
  tier: PhoneTier;
  price: number;
  spec: string;
  frame: PhoneFrame;
  image?: string;
  wallpaper?: string;
}

export const PHONE_ID_MAX_LENGTH = 16;
export const PHONE_CARRIER = "CampusNet";
export const PHONE_PURCHASE_TIMEOUT_MS = 4000;

export const PHONE_PLATFORM_LABEL: Record<PhonePlatform, string> = { ios: "iPhone", android: "Android" };
export const PHONE_TIER_LABEL: Record<PhoneTier, string> = { budget: "Budget", mid: "Mid-range", upper: "Upper mid-range", flagship: "Flagship" };

export const PHONES: readonly Phone[] = [
  {
    id: "zuma-a1",
    name: "TECNO POP 8",
    platform: "android",
    tier: "budget",
    price: 2500,
    spec: "6.6-inch screen, centre camera, an affordable first phone.",
    frame: { body: "#2f3a4a", edge: "#55627a", finish: "plastic", aspect: 0.5, radius: 0.085, bezel: 0.034, chin: 0.075, cutout: "punch", wallpaper: ["#274060", "#3d7ea6", "#9fd3c7"], accent: "#3d7ea6" },
  },
  {
    id: "zuma-note-12",
    image: "/phone/products/redmi-12.webp",
    name: "Redmi 12",
    platform: "android",
    tier: "mid",
    price: 4500,
    spec: "Punch-hole camera, big battery, slimmer chin.",
    frame: { body: "#1f2d2a", edge: "#4c7a6d", finish: "plastic", aspect: 0.475, radius: 0.1, bezel: 0.026, chin: 0.045, cutout: "punch", wallpaper: ["#12372a", "#436850", "#adbc9f"], accent: "#3f7d5c" },
  },
  {
    id: "zuma-note-pro",
    name: "Samsung Galaxy A35",
    platform: "android",
    tier: "upper",
    price: 8000,
    spec: "Glass back, bright screen, thin even bezels.",
    frame: { body: "#3a2c4f", edge: "#8f7bb5", finish: "glass", aspect: 0.465, radius: 0.115, bezel: 0.02, chin: 0.026, cutout: "punch", wallpaper: ["#2b1b4a", "#6a4c93", "#e0aaff"], accent: "#6a4c93" },
  },
  {
    id: "vanta-s-ultra",
    image: "/phone/products/galaxy-s24-ultra.webp",
    name: "Samsung Galaxy S24 Ultra",
    platform: "android",
    tier: "flagship",
    price: 58000,
    spec: "Metal frame, squared corners, edge-to-edge screen.",
    frame: { body: "#3b3d42", edge: "#b9bcc4", finish: "metal", aspect: 0.47, radius: 0.06, bezel: 0.013, chin: 0.013, cutout: "punch", wallpaper: ["#0b132b", "#3a506b", "#f2b880"], accent: "#3a506b" },
  },
  {
    id: "iphone-12", name: "iPhone 12", platform: "ios", tier: "mid", price: 8500,
    spec: "6.1-inch OLED, wide notch, dual cameras. Blue.",
    image: "/phone/products/iphone-12.webp", wallpaper: "/phone/wallpapers/ios-blue.webp",
    frame: { body: "#163653", edge: "#7eabc3", finish: "metal", aspect: 0.4875, radius: 0.15, bezel: 0.032, chin: 0.032, cutout: "notch", wallpaper: ["#09243a", "#217aa4", "#b1dbed"], accent: "#0a84ff" },
  },
  {
    id: "onyx-13",
    image: "/phone/products/iphone-13.webp",
    wallpaper: "/phone/wallpapers/ios-blue.webp",
    name: "iPhone 13",
    platform: "ios",
    tier: "mid",
    price: 11000,
    spec: "6.1-inch OLED, notch, dual cameras. Midnight.",
    frame: { body: "#23262d", edge: "#7d8491", finish: "metal", aspect: 0.4875, radius: 0.15, bezel: 0.03, chin: 0.03, cutout: "notch", wallpaper: ["#1d3557", "#457b9d", "#f1c6a8"], accent: "#0a84ff" },
  },
  {
    id: "iphone-14", name: "iPhone 14", platform: "ios", tier: "upper", price: 16500,
    spec: "6.1-inch OLED, notch, dual cameras. Purple.",
    image: "/phone/products/iphone-14.webp", wallpaper: "/phone/wallpapers/ios-blue.webp",
    frame: { body: "#888399", edge: "#d4cde7", finish: "metal", aspect: 0.4875, radius: 0.15, bezel: 0.028, chin: 0.028, cutout: "notch", wallpaper: ["#251843", "#7762a8", "#cbb4ed"], accent: "#0a84ff" },
  },
  {
    id: "iphone-15", name: "iPhone 15", platform: "ios", tier: "upper", price: 24000,
    spec: "6.1-inch OLED, Dynamic Island, USB-C. Blue.",
    image: "/phone/products/iphone-15.webp", wallpaper: "/phone/wallpapers/ios-ultramarine.webp",
    frame: { body: "#92afb7", edge: "#c9d9dc", finish: "metal", aspect: 0.461, radius: 0.16, bezel: 0.024, chin: 0.024, cutout: "pill", wallpaper: ["#102544", "#4777aa", "#b9d9ee"], accent: "#0a84ff" },
  },
  {
    id: "onyx-16",
    image: "/phone/products/iphone-16.webp",
    wallpaper: "/phone/wallpapers/ios-ultramarine.webp",
    name: "iPhone 16",
    platform: "ios",
    tier: "upper",
    price: 32000,
    spec: "6.1-inch OLED, Dynamic Island, USB-C. Ultramarine.",
    frame: { body: "#34506b", edge: "#a9c1d9", finish: "metal", aspect: 0.4725, radius: 0.165, bezel: 0.022, chin: 0.022, cutout: "pill", wallpaper: ["#14213d", "#5e60ce", "#ffb4a2"], accent: "#0a84ff" },
  },
  {
    id: "onyx-17-pro-max",
    image: "/phone/products/iphone-17-pro-max.webp",
    wallpaper: "/phone/wallpapers/ios-orange.webp",
    name: "iPhone 17 Pro Max",
    platform: "ios",
    tier: "flagship",
    price: 60000,
    spec: "6.9-inch OLED, Dynamic Island, aluminium. Cosmic Orange.",
    frame: { body: "#bf6939", edge: "#efb181", finish: "metal", aspect: 0.46, radius: 0.16, bezel: 0.014, chin: 0.014, cutout: "pill", wallpaper: ["#1b1b1e", "#7f5539", "#e6ccb2"], accent: "#0a84ff" },
  },
];

export const STARTING_PHONE: Record<Background, string> = { nepo: "onyx-16", regular: "zuma-note-12", hustler: "zuma-a1" };

export function findPhone(id: unknown): Phone | undefined {
  if (typeof id !== "string" || id.length === 0 || id.length > PHONE_ID_MAX_LENGTH) return undefined;
  return PHONES.find((phone) => phone.id === id);
}

export function startingPhone(background: Background): Phone {
  return findPhone(STARTING_PHONE[background]) ?? PHONES[0];
}

export function sanitizePhoneId(value: unknown, background: Background): string {
  return (findPhone(value) ?? startingPhone(background)).id;
}

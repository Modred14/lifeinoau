import type { IconType } from "react-icons";
import { PiFlagBannerFill, PiForkKnifeFill, PiGraduationCapFill, PiMapTrifoldFill, PiStorefrontFill, PiWalletFill, PiTicketFill, PiGlobeFill, PiChatCircleFill, PiMusicNotesFill, PiPlayFill, PiCameraFill, PiGearFill, PiShoppingBagFill } from "react-icons/pi";

export type AppId = "errands" | "union" | "chop" | "school" | "wallet" | "store" | "maps" | "events" | "chowdeck" | "glovo" | "facebook" | "twitter" | "instagram" | "whatsapp" | "youtube" | "spotify" | "browser" | "settings";

export interface PhoneApp {
  id: AppId;
  label: string;
  icon: IconType;
  image?: string;
  website?: string;
  tint: [string, string];
  dock: boolean;
}

export const PHONE_APPS: readonly PhoneApp[] = [
  { id: "errands", label: "Errands", icon: PiShoppingBagFill, tint: ["#f08c2e", "#c2410c"], dock: false },
  { id: "school", label: "School", icon: PiGraduationCapFill, tint: ["#5b7cfa", "#3f51d8"], dock: false },
  { id: "wallet", label: "Wallet", icon: PiWalletFill, tint: ["#20252c", "#090b0e"], dock: false },
  { id: "store", label: "Stores", icon: PiStorefrontFill, tint: ["#a56bf5", "#7341c9"], dock: false },
  { id: "events", label: "Events", icon: PiTicketFill, tint: ["#f0569a", "#c2255c"], dock: false },
  { id: "chowdeck", label: "Chowdeck", icon: PiForkKnifeFill, image: "/campus/phone/apps/chowdeck.webp", website: "https://chowdeck.com/", tint: ["#008d5f", "#008d5f"], dock: false },
  { id: "glovo", label: "Glovo", icon: PiForkKnifeFill, image: "/campus/phone/apps/glovo.webp", website: "https://glovoapp.com/", tint: ["#ffc244", "#ffc244"], dock: false },
  { id: "facebook", label: "Facebook", icon: PiGlobeFill, image: "/campus/phone/apps/facebook.webp", website: "https://www.facebook.com/", tint: ["#0866ff", "#0866ff"], dock: false },
  { id: "twitter", label: "X / Twitter", icon: PiGlobeFill, image: "/campus/phone/apps/x.webp", website: "https://x.com/", tint: ["#000000", "#000000"], dock: false },
  { id: "instagram", label: "Instagram", icon: PiCameraFill, image: "/campus/phone/apps/instagram.webp", website: "https://www.instagram.com/", tint: ["#ce3276", "#ef9046"], dock: false },
  { id: "youtube", label: "YouTube", icon: PiPlayFill, image: "/campus/phone/apps/youtube.webp", website: "https://www.youtube.com/", tint: ["#ffffff", "#ffffff"], dock: false },
  { id: "spotify", label: "Spotify", icon: PiMusicNotesFill, image: "/campus/phone/apps/spotify.webp", website: "https://open.spotify.com/", tint: ["#1ed760", "#1ed760"], dock: false },
  { id: "union", label: "Union", icon: PiFlagBannerFill, tint: ["#2f9e6b", "#14613f"], dock: false },
  { id: "settings", label: "Settings", icon: PiGearFill, tint: ["#9ca2aa", "#5d6570"], dock: false },
  { id: "whatsapp", label: "WhatsApp", icon: PiChatCircleFill, image: "/campus/phone/apps/whatsapp.webp", website: "https://web.whatsapp.com/", tint: ["#25d366", "#25d366"], dock: true },
  { id: "browser", label: "Browser", icon: PiGlobeFill, tint: ["#48b9ef", "#1168df"], dock: true },
  { id: "maps", label: "Maps", icon: PiMapTrifoldFill, tint: ["#35c2c1", "#1f8f9c"], dock: true },
  { id: "chop", label: "Chop", icon: PiForkKnifeFill, tint: ["#ff9f43", "#e8590c"], dock: true },
];

export function findApp(id: AppId): PhoneApp {
  return PHONE_APPS.find((app) => app.id === id) ?? PHONE_APPS[0];
}

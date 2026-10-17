import type { IconBaseProps } from "react-icons";
import {
  PiArrowRightDuotone, PiArrowUUpLeftDuotone, PiBankDuotone,
  PiBookOpenDuotone, PiBriefcaseDuotone, PiClockDuotone,
  PiCompassDuotone, PiConfettiDuotone, PiCrosshairDuotone,
  PiDeviceMobileDuotone, PiDiceFiveDuotone, PiDoorOpenDuotone,
  PiForkKnifeDuotone, PiGameControllerDuotone, PiGearSixDuotone,
  PiGraduationCapDuotone, PiHandWavingDuotone, PiHouseDuotone,
  PiLightningDuotone, PiMapPinDuotone, PiMapTrifoldDuotone,
  PiMoonStarsDuotone, PiPersonDuotone, PiPersonSimpleWalkDuotone,
  PiScooterDuotone, PiSparkleDuotone, PiSunHorizonDuotone,
  PiTShirtDuotone, PiUsersThreeDuotone, PiVanDuotone,
  PiWalletDuotone, PiWarningDuotone, PiXDuotone,
  PiSneakerDuotone, PiPantsDuotone, PiScissorsDuotone,
  PiCoatHangerDuotone, PiCheckBold, PiArrowClockwiseDuotone,
  PiArrowCounterClockwiseDuotone, PiLockDuotone, PiEyeDuotone,
  PiEyeSlashDuotone, PiKeyDuotone, PiCopyDuotone, PiSignOutDuotone,
  PiShoppingBagDuotone,
} from "react-icons/pi";

const ICONS = {
  arrow: PiArrowRightDuotone, back: PiArrowUUpLeftDuotone, bank: PiBankDuotone,
  book: PiBookOpenDuotone, work: PiBriefcaseDuotone, clock: PiClockDuotone,
  compass: PiCompassDuotone, fun: PiConfettiDuotone, locate: PiCrosshairDuotone,
  phone: PiDeviceMobileDuotone, dice: PiDiceFiveDuotone, door: PiDoorOpenDuotone,
  food: PiForkKnifeDuotone, game: PiGameControllerDuotone, settings: PiGearSixDuotone,
  school: PiGraduationCapDuotone, wave: PiHandWavingDuotone, home: PiHouseDuotone,
  energy: PiLightningDuotone, pin: PiMapPinDuotone, map: PiMapTrifoldDuotone,
  moon: PiMoonStarsDuotone, person: PiPersonDuotone, walk: PiPersonSimpleWalkDuotone,
  rider: PiScooterDuotone, sparkle: PiSparkleDuotone, sun: PiSunHorizonDuotone,
  shirt: PiTShirtDuotone, people: PiUsersThreeDuotone, bus: PiVanDuotone,
  wallet: PiWalletDuotone, warning: PiWarningDuotone, close: PiXDuotone,
  shoes: PiSneakerDuotone, pants: PiPantsDuotone, hair: PiScissorsDuotone,
  wardrobe: PiCoatHangerDuotone, check: PiCheckBold,
  turnRight: PiArrowClockwiseDuotone, turnLeft: PiArrowCounterClockwiseDuotone,
  lock: PiLockDuotone, eye: PiEyeDuotone, eyeOff: PiEyeSlashDuotone,
  key: PiKeyDuotone, copy: PiCopyDuotone, signOut: PiSignOutDuotone,
  bag: PiShoppingBagDuotone,
};

export type GameIconName = keyof typeof ICONS;

export function GameIcon({ name, ...props }: IconBaseProps & { name: GameIconName }) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" focusable="false" {...props} />;
}

const CONTEXT_ICONS: Record<string, GameIconName> = {
  "🚐": "bus", "🚌": "bus", "🚏": "bus", "🅿️": "bus", "🛑": "door",
  "🚪": "door", "🚶": "walk", "🧍": "person", "📝": "book", "📚": "book",
  "🤫": "warning", "📦": "food", "🛵": "rider", "🍲": "food", "🍱": "food",
  "💸": "wallet", "🏧": "wallet", "🏦": "bank", "🎒": "school", "🔥": "energy",
  "💼": "work", "🎉": "fun", "🛏️": "moon", "💤": "moon", "🪑": "person",
  "🙏": "sparkle", "📺": "game", "🎱": "game", "💃": "fun", "👨‍🍳": "food",
  "🍳": "food", "🧑🏾‍🏫": "book", "🧑‍🏫": "book", "🚗": "bus", "👨‍🏫": "book",
};

export function ContextIcon({ symbol }: { symbol: string }) {
  return <GameIcon name={CONTEXT_ICONS[symbol] ?? "sparkle"} />;
}

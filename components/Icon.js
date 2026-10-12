// components/Icon.js
"use client";
import { House, MapTrifold, DeviceMobile, Briefcase, ChatCircleText, TrendUp, Heart, GraduationCap, Trophy, Medal, Confetti, Wallet, Bell, ArrowClockwise, ArrowCounterClockwise,
  Plus, Minus, X, CaretLeft, Buildings, Books, FirstAidKit, Plant, Bed, UsersThree, Star, Door, MusicNotes, Storefront, Eye, EyeSlash, ListBullets, ArrowRight, Check, Crosshair,
  Lightning, Smiley, BookOpen, HeartStraight, Coins, Gift, Car, PersonSimpleWalk, Warning, DiceFive, FastForward, Moon, ChatsCircle, UserFocus, CaretRight, Lock, Phone, HandCoins, Siren, Timer,
  ShoppingBag, CookingPot, Couch, GameController, Package, Tag, ArrowsClockwise, Gear, SignOut, CellSignalFull, WifiHigh, BatteryFull, SmileyMeh, SmileySad, SmileyWink, CaretDown, CaretUp, Cube, Backpack, Bank, Handshake, Newspaper, Sparkle, ArrowsOutCardinal, Fan, Wrench } from "@phosphor-icons/react";

const ICONS = { home: House, map: MapTrifold, phone: DeviceMobile, jobs: Briefcase, chat: ChatCircleText, invest: TrendUp, love: Heart, courses: GraduationCap, forbes: Trophy, medal: Medal,
  party: Confetti, wallet: Wallet, bell: Bell, rotateRight: ArrowClockwise, rotateLeft: ArrowCounterClockwise, plus: Plus, minus: Minus, close: X, back: CaretLeft, hall: Buildings,
  library: Books, faculty: GraduationCap, hospital: FirstAidKit, farm: Plant, hostel: Bed, social: UsersThree, statue: Star, gate: Door, club: MusicNotes, town: Storefront,
  eye: Eye, eyeOff: EyeSlash, list: ListBullets, next: ArrowRight, check: Check, reset: Crosshair,
  energy: Lightning, happy: Smiley, study: BookOpen, health: HeartStraight, coins: Coins, gift: Gift, ride: Car, trek: PersonSimpleWalk, warn: Warning, dice: DiceFive, skip: FastForward,
  moon: Moon, talk: ChatsCircle, focus: UserFocus, caret: CaretRight, lock: Lock, call: Phone, hustle: HandCoins, siren: Siren, timer: Timer,
  bag: ShoppingBag, kitchen: CookingPot, sofa: Couch, game: GameController, box: Package, sell: Tag, spin: ArrowsClockwise, gear: Gear, logout: SignOut, signal: CellSignalFull, wifi: WifiHigh, battery: BatteryFull,
  meh: SmileyMeh, sad: SmileySad, wink: SmileyWink, down: CaretDown, up: CaretUp, cube: Cube, backpack: Backpack, bank: Bank, deal: Handshake, news: Newspaper, sparkle: Sparkle, move: ArrowsOutCardinal, fan: Fan, wrench: Wrench };
export const KIND_ICON = { hall: "hall", library: "library", faculty: "faculty", hospital: "hospital", farm: "farm", hostel: "hostel", social: "social", statue: "statue", gate: "gate", club: "club", town: "town" };

/** One consistent icon set (Phosphor, regular weight). Decorative by default; pass `label` when the icon stands alone. */
export function Icon({ name, size = 22, weight = "regular", label }) {
  const C = ICONS[name]; if (!C) return null;
  return <C size={size} weight={weight} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} focusable="false" />;
}
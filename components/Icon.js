// components/Icon.js
"use client";
import { House, MapTrifold, DeviceMobile, Briefcase, ChatCircleText, TrendUp, Heart, GraduationCap, Trophy, Medal, Confetti, Wallet, Bell, ArrowClockwise, ArrowCounterClockwise,
  Plus, Minus, X, CaretLeft, Buildings, Books, FirstAidKit, Plant, Bed, UsersThree, Star, Door, MusicNotes, Storefront, Eye, EyeSlash, ListBullets, ArrowRight, Check, Crosshair,
  Lightning, Smiley, BookOpen, HeartStraight, Coins, Gift, Car, PersonSimpleWalk, Warning, DiceFive, FastForward, Moon, ChatsCircle, UserFocus, CaretRight, Lock, Phone, HandCoins, Siren, Timer,
  ShoppingBag, CookingPot, Couch, GameController, Package, Tag, ArrowsClockwise, Gear, SignOut, CellSignalFull, WifiHigh, BatteryFull, SmileyMeh, SmileySad, SmileyWink, CaretDown, CaretUp, Cube, Backpack, Bank, Handshake, Newspaper, Sparkle, ArrowsOutCardinal, Fan, Wrench, Presentation, Image, UploadSimple, SpeakerHigh, SpeakerSlash, Bus, Taxi, SteeringWheel, MapPin, NavigationArrow, IdentificationBadge, DoorOpen, Megaphone, Users, ArrowLeft, SoccerBall, AirplaneTilt, Ticket, Receipt, ArrowUUpLeft, Trash, Clock, LockSimple, CheckCircle, XCircle, ShieldCheck, Repeat, DotsThreeVertical, MagnifyingGlass, PaperPlaneRight, Prohibit, Flag, UserCircle, ArrowDown, WarningCircle } from "@phosphor-icons/react";

/** A roulette wheel, drawn to match the Phosphor set (Phosphor has none). */
const Roulette = ({ size = 22, weight = "regular", ...p }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth={weight === "regular" ? 16 : 22} strokeLinecap="round" strokeLinejoin="round" {...p}>
    <circle cx="128" cy="128" r="104" /><circle cx="128" cy="128" r="62" /><circle cx="128" cy="128" r="14" fill="currentColor" />
    <path d="M128 24v38M128 194v38M24 128h38M194 128h38M54 54l27 27M175 175l27 27M202 54l-27 27M81 175l-27 27" />
  </svg>
);

const ICONS = { home: House, map: MapTrifold, phone: DeviceMobile, jobs: Briefcase, chat: ChatCircleText, invest: TrendUp, love: Heart, courses: GraduationCap, forbes: Trophy, medal: Medal,
  party: Confetti, wallet: Wallet, bell: Bell, rotateRight: ArrowClockwise, rotateLeft: ArrowCounterClockwise, plus: Plus, minus: Minus, close: X, back: CaretLeft, hall: Buildings,
  library: Books, faculty: GraduationCap, hospital: FirstAidKit, farm: Plant, hostel: Bed, social: UsersThree, statue: Star, gate: Door, club: MusicNotes, town: Storefront,
  eye: Eye, eyeOff: EyeSlash, list: ListBullets, next: ArrowRight, check: Check, reset: Crosshair,
  energy: Lightning, happy: Smiley, study: BookOpen, health: HeartStraight, coins: Coins, gift: Gift, ride: Car, trek: PersonSimpleWalk, warn: Warning, dice: DiceFive, skip: FastForward,
  moon: Moon, talk: ChatsCircle, focus: UserFocus, caret: CaretRight, lock: Lock, call: Phone, hustle: HandCoins, siren: Siren, timer: Timer,
  bag: ShoppingBag, kitchen: CookingPot, sofa: Couch, game: GameController, box: Package, sell: Tag, spin: ArrowsClockwise, gear: Gear, logout: SignOut, signal: CellSignalFull, wifi: WifiHigh, battery: BatteryFull,
  meh: SmileyMeh, sad: SmileySad, wink: SmileyWink, down: CaretDown, up: CaretUp, cube: Cube, backpack: Backpack, bank: Bank, deal: Handshake, news: Newspaper, sparkle: Sparkle, move: ArrowsOutCardinal, fan: Fan, wrench: Wrench, billboard: Presentation, image: Image, upload: UploadSimple, music: MusicNotes, sound: SpeakerHigh, mute: SpeakerSlash,
  bus: Bus, keke: Taxi, wheel: SteeringWheel, pin: MapPin, nav: NavigationArrow, driver: IdentificationBadge, door: DoorOpen, horn: Megaphone, users: Users, left: ArrowLeft, right: ArrowRight,
  ball: SoccerBall, plane: AirplaneTilt, ticket: Ticket, receipt: Receipt, undo: ArrowUUpLeft, trash: Trash, clock: Clock, lockS: LockSimple, win: CheckCircle, lose: XCircle, shield: ShieldCheck, repeat: Repeat, roulette: Roulette,
  more: DotsThreeVertical, search: MagnifyingGlass, send: PaperPlaneRight, block: Prohibit, flag: Flag, person: UserCircle, arrowDown: ArrowDown, alert: WarningCircle };
export const KIND_ICON = { hall: "hall", library: "library", faculty: "faculty", hospital: "hospital", farm: "farm", hostel: "hostel", social: "social", statue: "statue", gate: "gate", club: "club", town: "town" };

/** One consistent icon set (Phosphor, regular weight). Decorative by default; pass `label` when the icon stands alone. */
export function Icon({ name, size = 22, weight = "regular", label }) {
  const C = ICONS[name]; if (!C) return null;
  return <C size={size} weight={weight} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} focusable="false" />;
}
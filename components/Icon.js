// components/Icon.js
"use client";
import { House, MapTrifold, DeviceMobile, Briefcase, ChatCircleText, TrendUp, Heart, GraduationCap, Trophy, Medal, Confetti, Wallet, Bell, ArrowClockwise, ArrowCounterClockwise,
  Plus, Minus, X, CaretLeft, Buildings, Books, FirstAidKit, Plant, Bed, UsersThree, Star, Door, MusicNotes, Storefront, Eye, EyeSlash, ListBullets, ArrowRight, Check, Crosshair } from "@phosphor-icons/react";

const ICONS = { home: House, map: MapTrifold, phone: DeviceMobile, jobs: Briefcase, chat: ChatCircleText, invest: TrendUp, love: Heart, courses: GraduationCap, forbes: Trophy, medal: Medal,
  party: Confetti, wallet: Wallet, bell: Bell, rotateRight: ArrowClockwise, rotateLeft: ArrowCounterClockwise, plus: Plus, minus: Minus, close: X, back: CaretLeft, hall: Buildings,
  library: Books, faculty: GraduationCap, hospital: FirstAidKit, farm: Plant, hostel: Bed, social: UsersThree, statue: Star, gate: Door, club: MusicNotes, town: Storefront,
  eye: Eye, eyeOff: EyeSlash, list: ListBullets, next: ArrowRight, check: Check, reset: Crosshair };
export const KIND_ICON = { hall: "hall", library: "library", faculty: "faculty", hospital: "hospital", farm: "farm", hostel: "hostel", social: "social", statue: "statue", gate: "gate", club: "club", town: "town" };

/** One consistent icon set (Phosphor, regular weight). Decorative by default; pass `label` when the icon stands alone. */
export function Icon({ name, size = 22, weight = "regular", label }) {
  const C = ICONS[name]; if (!C) return null;
  return <C size={size} weight={weight} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} focusable="false" />;
}
import type { BannerArt } from "../banner-art";
import { setRentedBannerSource } from "../banners/feed";
import { ELECTION_TIMES, electionCycle, weekMinute } from "./calendar";
import { identityOf, safeLook, type CampaignLook } from "./identity";
import { parseRace } from "./posts";
import { RALLY_POINTS, SUB_PLACE } from "./sites";

const HALL_PRICE = 800;
const SUB_PRICE = 1200;
const INK = 0xffffff;
const ACCENT = 0xf2c230;
const SUB_AREA = "sub";
const SUB_NAME = "Student Union Building";
const FOOTER = "Paid for by the campaign";

export const RENTAL = {
  perArea: 3,
  perCandidate: 4,
  weight: 6,
} as const;

export interface RentalArea {
  id: string;
  name: string;
  place: number;
  price: number;
}

export const RENTAL_AREAS: readonly RentalArea[] = [
  { id: SUB_AREA, name: SUB_NAME, place: SUB_PLACE, price: SUB_PRICE },
  ...RALLY_POINTS.map((site) => ({ id: site.id, name: site.name, place: site.place, price: HALL_PRICE })),
];

export const findRentalArea = (id: unknown): RentalArea | undefined => (typeof id === "string" ? RENTAL_AREAS.find((a) => a.id === id) : undefined);

export interface RentedSpot {
  area: string;
  slot: number;
  candidacy: string;
  name: string;
  race: string;
  look: CampaignLook;
}

export type RentRefusal = "area" | "twice" | "limit" | "full";

export function rentRefusal(area: string, mine: readonly string[], takenInArea: number): RentRefusal | null {
  if (!findRentalArea(area)) return "area";
  if (mine.includes(area)) return "twice";
  if (mine.length >= RENTAL.perCandidate) return "limit";
  if (takenInArea >= RENTAL.perArea) return "full";
  return null;
}

export const rentalsOpen = (minuteOfWeek: number): boolean => minuteOfWeek >= ELECTION_TIMES.formsOpen && minuteOfWeek < ELECTION_TIMES.campaignClose;

export function rentedBanners(cycle: number, spots: readonly RentedSpot[]): BannerArt[] {
  return spots.flatMap((spot) => {
    const area = findRentalArea(spot.area);
    const post = parseRace(spot.race)?.post;
    if (!area || !post) return [];
    const identity = identityOf(spot.look);
    const art: BannerArt = {
      id: `pol-rent-${cycle}-${spot.area}-${spot.slot}`,
      tone: "campaign",
      title: `Vote "${identity.nick}"`,
      lines: [spot.name, `For ${post.title}`, identity.slogan],
      footer: FOOTER,
      color: identity.color,
      ink: INK,
      accent: ACCENT,
      weight: RENTAL.weight,
      near: area.place,
    };
    return [art];
  });
}

export function showRentedBanners(cycle: number, spots: readonly RentedSpot[]) {
  const art = rentedBanners(cycle, spots);
  setRentedBannerSource((t) => (electionCycle(t) === cycle && weekMinute(t) < ELECTION_TIMES.results ? art : []));
}

export function parseRentedSpots(payload: unknown): RentedSpot[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((raw: unknown) => {
    if (typeof raw !== "object" || raw === null) return [];
    const spot = raw as Partial<RentedSpot>;
    if (typeof spot.area !== "string" || typeof spot.slot !== "number" || typeof spot.candidacy !== "string" || typeof spot.name !== "string" || typeof spot.race !== "string") return [];
    return [{ area: spot.area, slot: spot.slot, candidacy: spot.candidacy, name: spot.name, race: spot.race, look: safeLook(spot.look) }];
  });
}

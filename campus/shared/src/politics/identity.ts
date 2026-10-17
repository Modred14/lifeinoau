export const CAMPAIGN_NICKS: readonly string[] = [
  "The People's Choice",
  "Comrade Fresh",
  "Solution",
  "Aluta Pikin",
  "Okay Deputy",
  "Mr Welfare",
  "Madam Due Process",
  "Voice of Angola",
  "Moz Mandate",
  "Awo Scholar",
  "The Listener",
  "Sure Plug",
  "Steady Hand",
  "Small Chops",
  "No Stories",
  "Baba Rally",
  "Sister Order",
  "Omo Ife",
  "The Minute Book",
  "Great Ife Pikin",
  "Capacity Plus",
  "Level Head",
  "Works Not Words",
  "First Among Equals",
];

export const CAMPAIGN_SLOGANS: readonly string[] = [
  "I will follow it up till e work.",
  "Your complaint is my agenda.",
  "Light and water first.",
  "Open books. Open door.",
  "The union belongs to congress.",
  "Fair fares. Short queues.",
  "Clean hostels, working taps.",
  "I go show up. I go report back.",
  "Less noise. More work.",
  "One campus. One voice.",
  "Welfare no be favour.",
  "Ask me where the money went.",
  "A union you can reach.",
  "Lectures, light and peace of mind.",
  "Service with sense.",
  "Greatest Ife deserves better.",
];

export interface CampaignColor {
  name: string;
  value: number;
}

export const CAMPAIGN_COLORS: readonly CampaignColor[] = [
  { name: "Union green", value: 0x1f7a4d },
  { name: "Senate blue", value: 0x1d4f91 },
  { name: "Brick red", value: 0xb5462f },
  { name: "Royal purple", value: 0x7341c9 },
  { name: "Harvest gold", value: 0xc98a12 },
  { name: "Teal", value: 0x0f766e },
  { name: "Rose", value: 0xbe185d },
  { name: "Charcoal", value: 0x374151 },
];

export interface CampaignLook {
  nick: number;
  slogan: number;
  color: number;
}

export interface CampaignIdentity {
  nick: string;
  slogan: string;
  color: number;
}

export const DEFAULT_CAMPAIGN_LOOK: CampaignLook = { nick: 0, slogan: 0, color: 0 };

const index = (value: unknown, size: number): number | null => (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < size ? value : null);

export function parseLook(nick: unknown, slogan: unknown, color: unknown): CampaignLook | null {
  if (nick === undefined && slogan === undefined && color === undefined) return { ...DEFAULT_CAMPAIGN_LOOK };
  const look = { nick: index(nick, CAMPAIGN_NICKS.length), slogan: index(slogan, CAMPAIGN_SLOGANS.length), color: index(color, CAMPAIGN_COLORS.length) };
  return look.nick === null || look.slogan === null || look.color === null ? null : { nick: look.nick, slogan: look.slogan, color: look.color };
}

export function safeLook(look: Partial<CampaignLook> | undefined): CampaignLook {
  return parseLook(look?.nick ?? 0, look?.slogan ?? 0, look?.color ?? 0) ?? { ...DEFAULT_CAMPAIGN_LOOK };
}

export function identityOf(look: Partial<CampaignLook> | undefined): CampaignIdentity {
  const safe = safeLook(look);
  return { nick: CAMPAIGN_NICKS[safe.nick], slogan: CAMPAIGN_SLOGANS[safe.slogan], color: CAMPAIGN_COLORS[safe.color].value };
}

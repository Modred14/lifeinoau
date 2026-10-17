import { CONDITION_SITES, CONDITION_SITE_REACH, HEALTH, chemistOpen, clinicOpen, type ConditionSite, type ConditionsPayload, type GameTime } from "@campuslife/shared";

export interface ConditionsPrompt {
  d: number;
  p: { id: string; icon: string; label: string; detail?: string; disabled?: boolean };
  run: () => void;
}

const PRIORITY = 20;
const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;
const hour = (minute: number) => `${String(minute / 60).padStart(2, "0")}:00`;

const TEXT = {
  fetch: "Fetch water",
  fetchDetail: "Baff and fresh up",
  fetching: "Fetching water",
  clinic: "See the nurse",
  clinicDetail: "Free. Take a number and wait",
  clinicShut: `Opens ${hour(HEALTH.clinicOpens)} to ${hour(HEALTH.clinicCloses)}`,
  waiting: (number: number | undefined) => (number ? `Waiting. You be number ${number}` : "Waiting"),
  left: (minutes: number) => (minutes > 1 ? `About ${minutes} minutes left. Stay close` : "Almost your turn"),
  chemist: "Buy drugs",
  chemistShut: `Opens ${hour(HEALTH.chemistOpens)} to ${hour(HEALTH.chemistCloses)}`,
  counting: "The chemist dey count your drugs",
};
const ICON = { fetch: "🪣", clinic: "🏥", chemist: "💊", wait: "⏳" };

function sitePrompt(site: ConditionSite, me: ConditionsPayload, t: GameTime): ConditionsPrompt["p"] | undefined {
  const task = me.task && me.task.site === site.id ? me.task : undefined;
  if (task) {
    const minutes = Math.max(0, Math.round(task.ends - t.total));
    if (task.kind === "clinic") return { id: `cond-wait-${site.id}-${minutes}`, icon: ICON.wait, label: TEXT.waiting(task.number), detail: TEXT.left(minutes), disabled: true };
    return { id: `cond-busy-${site.id}`, icon: ICON.wait, label: task.kind === "fetch" ? TEXT.fetching : TEXT.counting, disabled: true };
  }
  if (site.kind === "standpipe") return me.unwashed ? { id: `cond-fetch-${site.id}`, icon: ICON.fetch, label: TEXT.fetch, detail: TEXT.fetchDetail } : undefined;
  if (site.kind === "clinic") {
    if (!me.illness) return undefined;
    const open = clinicOpen(t);
    return { id: `cond-clinic-${site.id}-${open}`, icon: ICON.clinic, label: TEXT.clinic, detail: open ? TEXT.clinicDetail : TEXT.clinicShut, disabled: !open };
  }
  if (!me.illness) return undefined;
  const open = chemistOpen(t);
  return { id: `cond-chemist-${site.id}-${open}`, icon: ICON.chemist, label: TEXT.chemist, detail: open ? naira(HEALTH.chemistPrice) : TEXT.chemistShut, disabled: !open };
}

export function conditionsPrompts(me: ConditionsPayload, x: number, y: number, inside: number, t: GameTime, act: (site: number) => void): ConditionsPrompt[] {
  if (inside >= 0) return [];
  const out: ConditionsPrompt[] = [];
  for (const site of CONDITION_SITES) {
    const d = Math.hypot(site.stand.x - x, site.stand.y - y);
    if (d > CONDITION_SITE_REACH) continue;
    const p = sitePrompt(site, me, t);
    if (p) out.push({ d: d - PRIORITY, p, run: () => act(site.id) });
  }
  return out;
}

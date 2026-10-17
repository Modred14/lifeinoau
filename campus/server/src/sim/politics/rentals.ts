import { RENTAL, electionCycle, findRentalArea, rentRefusal, rentalsOpen, weekMinute, type GameTime, type RentRefusal } from "@campuslife/shared";
import { naira, type PoliticsCore } from "./core";
import type { PoliticsPlayer } from "./types";
import { refreshWorld } from "./world";

const TEXT = {
  closed: "Banner spots are rented from Monday 8 am till campaigns close on Thursday 6 pm.",
  noForm: "Only candidates can rent banner spots. Pick a form at the SUB on Monday.",
  gone: "Another camp just took the last spot there.",
};
const REFUSAL: Record<RentRefusal, string> = {
  area: "SUIEC does not rent banner spots there.",
  twice: "Your banner is already up there. One spot per area for each camp.",
  limit: `SUIEC allows ${RENTAL.perCandidate} rented spots for each camp.`,
  full: "All the banner spots there are taken. First come, first served.",
};

export async function rentSpot(core: PoliticsCore, id: string, p: PoliticsPlayer, areaId: string, t: GameTime) {
  const area = findRentalArea(areaId);
  if (!area) return core.notice(id, REFUSAL.area);
  if (!rentalsOpen(weekMinute(t))) return core.notice(id, TEXT.closed);
  const cycle = electionCycle(t);
  const [mine, rows] = await Promise.all([core.store.candidacyOf(p.profileId, cycle), core.store.rentals(cycle)]);
  if (!mine) return core.notice(id, TEXT.noForm);
  const refusal = rentRefusal(area.id, rows.filter((r) => r.candidacyId === mine.id).map((r) => r.area), rows.filter((r) => r.area === area.id).length);
  if (refusal) return core.notice(id, REFUSAL[refusal]);
  if (p.cash < area.price) return core.notice(id, `A banner spot at ${area.name} costs ${naira(area.price)}. You no get reach.`);
  p.cash -= area.price;
  core.host.changed(id);
  let slot = -1;
  try {
    slot = await core.store.rent({ cycle, area: area.id, candidacyId: mine.id }, RENTAL.perArea);
  } finally {
    if (slot < 0) core.refund(p.profileId, area.price);
  }
  if (slot < 0) return core.notice(id, TEXT.gone);
  core.notice(id, `🪧 Your banner is going up at ${area.name} for ${naira(area.price)}. It stays till the polls.`);
  await refreshWorld(core, t);
}

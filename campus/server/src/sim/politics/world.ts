import { ServerMsg, WEEK_MINUTES, applyCampusStates, electionCycle, type GameTime, type RentedSpot, type UnionWorld } from "@campuslife/shared";
import type { PoliticsCore } from "./core";

const STATE_KEEP_MINUTES = WEEK_MINUTES;

export function worldOf(core: PoliticsCore, t: GameTime): UnionWorld {
  return { cycle: electionCycle(t), rentals: core.rented, states: core.states, called: core.called() };
}

export function sendWorld(core: PoliticsCore, id: string, t: GameTime) {
  core.host.send(id, ServerMsg.Union, worldOf(core, t));
}

export async function loadRentals(core: PoliticsCore, cycle: number): Promise<RentedSpot[]> {
  const rows = await core.store.rentals(cycle);
  if (rows.length === 0) return [];
  const owners = new Map((await core.store.candidaciesOf(cycle)).map((c) => [c.id, c]));
  return rows.flatMap((row) => {
    const owner = owners.get(row.candidacyId);
    return owner ? [{ area: row.area, slot: row.slot, candidacy: owner.id, name: owner.name, race: owner.race, look: owner.look ?? { nick: 0, slogan: 0, color: 0 } }] : [];
  });
}

export async function refreshWorld(core: PoliticsCore, t: GameTime) {
  const cycle = electionCycle(t);
  const [states, rented, impeached, reruns] = await Promise.all([core.store.states(t.total - STATE_KEEP_MINUTES), loadRentals(core, cycle), core.store.impeachments(core.officesCycle >= 0 ? core.officesCycle : cycle), core.store.reruns(cycle)]);
  core.states = states;
  applyCampusStates(states);
  core.rented = rented;
  core.impeached = impeached;
  for (const race of reruns) {
    const key = `${cycle}:${race}`;
    if (core.reruns.has(key)) continue;
    core.reruns.add(key);
    core.forgetRace(cycle, race);
  }
  const world = worldOf(core, t);
  const stamp = JSON.stringify(world);
  if (stamp === core.worldStamp) return;
  core.worldStamp = stamp;
  core.everyone(ServerMsg.Union, world);
}

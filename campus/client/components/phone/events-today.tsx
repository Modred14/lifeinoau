import { useMemo } from "react";
import { DAYS, gameTime, whatsOn, type GameTime } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import { EventRows } from "./events-rows";

const REFRESH_MINUTES = 5;
const TEXT = {
  today: "Today",
  tomorrow: "Tomorrow",
  empty: "Nothing on for now. Check again later.",
  note: "Shows hold at the Amphi Theatre and Oduduwa Hall. TV matches show at every hall viewing centre. Faculty football is free at the touchline.",
};

export function EventsToday({ view, time, onClose }: { view: CampusView; time: GameTime; onClose: () => void }) {
  const slot = Math.floor(time.total / REFRESH_MINUTES);
  const items = useMemo(() => {
    const radar = view.getRadar();
    return whatsOn(gameTime(slot * REFRESH_MINUTES), radar.inside ? undefined : radar.me);
  }, [view, slot]);
  const groups = [
    { title: `${TEXT.today} · ${DAYS[time.weekday]}`, list: items.filter((item) => item.dayIndex === time.dayIndex) },
    { title: `${TEXT.tomorrow} · ${DAYS[(time.weekday + 1) % DAYS.length]}`, list: items.filter((item) => item.dayIndex === time.dayIndex + 1) },
  ];
  return (
    <>
      <p className="ph-note">{TEXT.note}</p>
      {groups.map((group) => (
        <section key={group.title}>
          <h3 className="ph-heading">{group.title}</h3>
          <EventRows view={view} items={group.list} total={time.total} empty={TEXT.empty} onClose={onClose} />
        </section>
      ))}
    </>
  );
}

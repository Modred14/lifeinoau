"use client";

import { useState } from "react";
import type { CampusView } from "@campus/game/CampusView";
import { useSocial } from "@campus/game/social/use-social";
import { EventsCalendar } from "./events-calendar";
import { EventsConditions } from "./events-conditions";
import { EventsSport } from "./events-sport";
import { EventsToday } from "./events-today";
import type { Timetable } from "./lock-notification";

type Tab = "today" | "sport" | "calendar";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "sport", label: "Sport" },
  { id: "calendar", label: "Calendar" },
];
const TABS_LABEL = "Events sections";

export function AppEvents({ view, onClose }: { view: CampusView; timetable: Timetable; onClose: () => void }) {
  const social = useSocial(view);
  const [tab, setTab] = useState<Tab>("today");
  return (
    <>
      <div className="ph-tabs" role="tablist" aria-label={TABS_LABEL}>
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={item.id === tab} className="ph-tab" onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {tab === "today" && <EventsToday view={view} time={social.time} onClose={onClose} />}
      {tab === "today" && <EventsConditions view={view} />}
      {tab === "sport" && <EventsSport view={view} social={social} onClose={onClose} />}
      {tab === "calendar" && <EventsCalendar view={view} social={social} onClose={onClose} />}
    </>
  );
}

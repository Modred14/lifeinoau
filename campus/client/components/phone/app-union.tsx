"use client";

import { useState } from "react";
import type { CampusView } from "@campus/game/CampusView";
import { usePolitics } from "@campus/components/politics/use-politics";
import { UnionMe } from "./union-me";
import { UnionRaces } from "./union-races";
import { UnionTabs } from "./union-tabs";
import { UnionWeek } from "./union-week";
import "./union.css";

type Tab = "week" | "races" | "me";
const TABS: readonly { id: Tab; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "races", label: "Candidates" },
  { id: "me", label: "My run" },
];
const OFFLINE = "SUIEC's register is not answering. You can still read the candidates and the calendar.";

export function AppUnion({ view, onClose }: { view: CampusView; onClose: () => void }) {
  const politics = usePolitics(view);
  const [tab, setTab] = useState<Tab>("week");
  return (
    <>
      <UnionTabs tabs={TABS} active={tab} label="Union sections" onPick={setTab} />
      {politics.status && !politics.status.ok && <p className="ph-note">{OFFLINE}</p>}
      {tab === "week" && <UnionWeek politics={politics} />}
      {tab === "races" && <UnionRaces politics={politics} />}
      {tab === "me" && <UnionMe view={view} politics={politics} onClose={onClose} />}
    </>
  );
}

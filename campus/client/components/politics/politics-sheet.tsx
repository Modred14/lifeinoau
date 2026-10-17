"use client";

import { pollUnit } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import type { PoliticsPanel } from "@campus/game/politics";
import { GameIcon } from "../GameIcon";
import { GamePanel } from "../GamePanel";
import { BallotSheet } from "./ballot-sheet";
import { FormSheet } from "./form-sheet";
import { usePolitics } from "./use-politics";

export default function PoliticsSheet({ view, panel, onClose }: { view: CampusView; panel: PoliticsPanel; onClose: () => void }) {
  const politics = usePolitics(view);
  const title = panel.kind === "form" ? "SUIEC nomination forms" : `Ballot: ${pollUnit(panel.unit).name}`;
  return (
    <GamePanel className="sheet jobs" label={title} onClose={onClose}>
      <div className="jobs-head">
        <h2>
          <GameIcon name="people" />
          {title}
        </h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <GameIcon name="close" />
        </button>
      </div>
      {panel.kind === "form" ? <FormSheet view={view} politics={politics} onClose={onClose} /> : <BallotSheet politics={politics} unit={panel.unit} />}
    </GamePanel>
  );
}

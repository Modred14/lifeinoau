"use client";

import { LEVELS, type SchoolType } from "@campuslife/shared/levels";

const LEVEL_LABEL = "Your level";

export function LevelPicker({ schoolType, level, onLevel }: { schoolType: SchoolType; level: string; onLevel: (level: string) => void }) {
  return (
    <fieldset className="level-pick">
      <legend>{LEVEL_LABEL}</legend>
      <div className="chips">
        {LEVELS[schoolType].map((l) => (
          <button key={l} type="button" className={l === level ? "chip active" : "chip"} aria-pressed={l === level} onClick={() => onLevel(l)}>
            {l}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

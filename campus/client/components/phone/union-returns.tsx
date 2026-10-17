import { electionCycle, unitReturns, type RaceResult, type UnitReturn } from "@campuslife/shared";
import type { Politics, RaceView } from "@campus/components/politics/use-politics";

const TOP = 3;

function Units({ units, name }: { units: readonly UnitReturn[]; name: (id: string) => string }) {
  return (
    <ul className="ph-list">
      {units.map((unit) => (
        <li key={unit.unit} className="ph-list-row">
          <span className="ph-list-text">
            <b>{unit.name} unit</b>
            <small>
              {[...unit.rows]
                .sort((a, b) => b.votes - a.votes)
                .slice(0, TOP)
                .map((row) => `${name(row.id)} ${row.votes.toLocaleString("en-NG")}`)
                .join(" · ")}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function UnionCount({ race, politics }: { race: RaceView; politics: Politics }) {
  const units = politics.status?.returns.find((r) => r.race === race.race)?.units;
  if (!units) return null;
  const labels = new Map(race.candidates.map((c) => [c.id, c.nick]));
  return units.length > 0 ? <Units units={units} name={(id) => labels.get(id) ?? id} /> : <p className="ph-note">Collation has started. The first unit is on the way.</p>;
}

export function UnionUnits({ result, politics }: { result: RaceResult; politics: Politics }) {
  const names = new Map(result.rows.map((row) => [row.id, row.name]));
  return (
    <details className="un-units">
      <summary>Unit by unit</summary>
      <Units units={unitReturns(electionCycle(politics.time), result)} name={(id) => names.get(id) ?? id} />
    </details>
  );
}

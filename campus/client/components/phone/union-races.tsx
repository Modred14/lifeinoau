import { useState } from "react";
import { ELECTION_TIMES, UNION_BODIES, UNION_BODY_INFO, candidateKey, electionCycle, weekMinute, type RaceResult, type UnionBody } from "@campuslife/shared";
import { racesOf, type Politics, type RaceView } from "@campus/components/politics/use-politics";
import { UnionCount, UnionUnits } from "./union-returns";
import { UnionTabs } from "./union-tabs";

const BODY_TABS = UNION_BODIES.map((id) => ({ id, label: UNION_BODY_INFO[id].short }));
const swatch = (color: number) => ({ background: `#${color.toString(16).padStart(6, "0")}` });

function ResultRows({ result }: { result: RaceResult }) {
  return (
    <ul className="ph-list">
      {result.rows.map((row) => (
        <li key={row.id} className="ph-list-row">
          <span className="ph-list-text">
            <b className={row.id === result.winner ? "un-win" : undefined}>{row.name}</b>
            <small>
              {row.id === result.winner ? (result.unopposed ? "Returned unopposed" : result.runoff ? "Won the run-off" : "Winner") : "Lost"}
              {row.real > 0 ? ` · ${row.real} student vote${row.real === 1 ? "" : "s"}` : ""}
            </small>
          </span>
          <span className="ph-time">{row.total.toLocaleString("en-NG")}</span>
        </li>
      ))}
    </ul>
  );
}

function CandidateRows({ race, politics, open }: { race: RaceView; politics: Politics; open: boolean }) {
  const { status, send } = politics;
  return (
    <ul className="ph-list">
      {race.candidates.map((c) => {
        const key = candidateKey(race.race, c.id);
        const count = status?.endorsements[key] ?? 0;
        const mine = status?.mine?.id === c.id;
        return (
          <li key={c.id} className="ph-list-row">
            <span className="un-swatch" style={swatch(c.color)} aria-hidden="true" />
            <span className={c.disqualified ? "ph-list-text un-out" : "ph-list-text"}>
              <b>{`"${c.nick}" ${c.name}${mine ? " (you)" : ""}`}</b>
              <small>{c.disqualified ? "Disqualified at screening" : `${c.slogan} ${c.from}.`}</small>
              {count > 0 && <small>{count} endorsement{count === 1 ? "" : "s"}</small>}
            </span>
            {status?.endorsed === key ? (
              <span className="ph-tag">Endorsed</span>
            ) : (
              open && !c.disqualified && !mine && !status?.endorsed && (
                <button type="button" className="ph-btn ph-btn-quiet" aria-label={`Endorse ${c.name} for ${race.post.title}`} onClick={() => send({ a: "endorse", post: race.post.id, c: c.id })}>
                  Endorse
                </button>
              )
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function UnionRaces({ politics }: { politics: Politics }) {
  const [body, setBody] = useState<UnionBody>("sug");
  const { status, time } = politics;
  const races = racesOf(status, electionCycle(time), body);
  const now = weekMinute(time);
  const open = !!status?.ok && now >= ELECTION_TIMES.formsOpen && now < ELECTION_TIMES.pollsOpen;
  const results = new Map((status?.results ?? []).map((r) => [r.race, r]));
  return (
    <>
      <UnionTabs tabs={BODY_TABS} active={body} label="Association" onPick={setBody} />
      {races.length === 0 && <p className="ph-note">Add your department when you start a life to follow your faculty and departmental races.</p>}
      {status?.endorsed === "" && open && races.length > 0 && <p className="ph-note">You can endorse one candidate this week. Choose well.</p>}
      {races.map((race) => {
        const result = results.get(race.race);
        return (
          <section key={race.race}>
            <h3 className="ph-heading">{race.post.role}</h3>
            {result ? <ResultRows result={result} /> : <CandidateRows race={race} politics={politics} open={open} />}
            {result ? <UnionUnits result={result} politics={politics} /> : <UnionCount race={race} politics={politics} />}
          </section>
        );
      })}
    </>
  );
}

"use client";

import { SUB_UNIT, UNION_BODIES, pollUnit, unitOfFaculty, type UnionBody } from "@campuslife/shared";
import { PiCheckCircleFill } from "react-icons/pi";
import { usePending } from "@campus/components/use-pending";
import { racesOf, type Politics } from "./use-politics";

const swatch = (color: number) => ({ background: `#${color.toString(16).padStart(6, "0")}` });

export function BallotSheet({ politics, unit }: { politics: Politics; unit: string }) {
  const { status, send } = politics;
  const [pending, act] = usePending(status);
  const home = status?.faculty ? unitOfFaculty(status.faculty) : "";
  const here = (body: UnionBody) => (body === "sug" ? unit === SUB_UNIT : home === unit);
  const races = UNION_BODIES.filter(here).flatMap((body) => racesOf(status, status?.cycle ?? 0, body));
  if (!status?.ok) return <p className="jobs-bg">The SUIEC register is loading. Give it a moment.</p>;
  if (races.length === 0) {
    return <p className="jobs-bg">{home ? `Your faculty and departmental ballots are at the ${pollUnit(home).name} polling unit. SUG ballots are at the Student Union Building.` : "Only SUG ballots are open to you, at the Student Union Building."}</p>;
  }
  return (
    <>
      <p className="jobs-bg">One student, one vote for each post. Thumbprint beside your candidate.</p>
      {races.map(({ post, race, candidates }) => {
        const voted = status.voted.includes(race);
        return (
          <section key={race}>
            <h3 className="jobs-bg">
              <b>{post.title}</b>
              {voted && (
                <>
                  {" "}
                  <PiCheckCircleFill aria-hidden="true" /> Voted
                </>
              )}
            </h3>
            <ul className="jobs-list">
              {candidates
                .filter((c) => !c.disqualified)
                .map((c) => (
                  <li key={c.id} className="job">
                    <span className="job-icon" aria-hidden style={swatch(c.color)} />
                    <div className="job-body">
                      <b>{`${c.name} "${c.nick}"`}</b>
                      <small>{c.slogan}</small>
                    </div>
                    <button className="btn job-go" disabled={voted || pending} aria-label={`Vote ${c.name} for ${post.title}`} onClick={() => act(() => send({ a: "vote", post: post.id, c: c.id }))}>
                      Vote
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

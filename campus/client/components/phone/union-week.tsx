import { ELECTION_CALENDAR, RALLY_POINTS, UNION_POSTS, electionCycle, electionPhase, newsStamp, newsUntil, parseRace, ralliesFor, weekClock, weekMinute } from "@campuslife/shared";
import type { Politics } from "@campus/components/politics/use-politics";
import { UnionCampus } from "./union-campus";

const NEWS_LIMIT = 12;
const RALLY_LIMIT = 4;

export function UnionWeek({ politics }: { politics: Politics }) {
  const { status, time, send } = politics;
  const cycle = electionCycle(time);
  const now = weekMinute(time);
  const phase = electionPhase(time);
  const rallies = ralliesFor(cycle).filter((r) => r.end > now).slice(0, RALLY_LIMIT);
  const order = new Map(UNION_POSTS.map((post, i) => [post.id, i]));
  const holders = [...(status?.holders ?? [])].sort((a, b) => (order.get(parseRace(a.race)?.post.id ?? "") ?? 0) - (order.get(parseRace(b.race)?.post.id ?? "") ?? 0));
  const verdicts = new Map((status?.impeachments ?? []).map((v) => [v.race, v]));
  return (
    <>
      <UnionCampus politics={politics} />
      <h3 className="ph-heading">Election week</h3>
      <ul className="ph-list">
        {ELECTION_CALENDAR.map((entry) => {
          const done = now >= entry.end;
          const live = entry.phase === phase || (now >= entry.start && !done);
          return (
            <li key={entry.title} className={done ? "ph-list-row ph-done" : live ? "ph-list-row ph-live" : "ph-list-row"}>
              <span className="ph-time">{weekClock(entry.start)}</span>
              <span className="ph-list-text">
                <b>{entry.title}</b>
                <small>
                  {entry.where}
                  {live && !done ? " · now" : ""}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      {rallies.length > 0 && (
        <>
          <h3 className="ph-heading">Rallies</h3>
          <ul className="ph-list">
            {rallies.map((rally) => (
              <li key={rally.start} className={now >= rally.start ? "ph-list-row ph-live" : "ph-list-row"}>
                <span className="ph-time">{weekClock(rally.start)}</span>
                <span className="ph-list-text">
                  <b>{RALLY_POINTS[rally.site]?.name}</b>
                  <small>Campaign here during the rally for double support</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3 className="ph-heading">In office now</h3>
      {holders.length > 0 ? (
        <ul className="ph-list">
          {holders.map((holder) => {
            const verdict = verdicts.get(holder.race);
            const signed = status?.signed.includes(holder.race);
            const count = status?.signatures[holder.race] ?? 0;
            return (
              <li key={holder.race} className={holder.mine ? "ph-list-row ph-live" : "ph-list-row"}>
                <span className="ph-list-text">
                  <b>{parseRace(holder.race)?.post.title}</b>
                  <small>
                    {holder.name}
                    {holder.mine ? " · you" : ""}
                  </small>
                  {verdict && <small>{verdict.removed ? `The SRC removed ${verdict.ousted}.` : "The SRC sat and cleared this officer."}</small>}
                  {!verdict && count > 0 && <small>{count} student{count === 1 ? " has" : "s have"} signed a petition.</small>}
                </span>
                {!verdict && !holder.mine && (
                  <button type="button" className="ph-btn ph-btn-quiet" disabled={signed || !status?.ok} aria-label={`Sign the petition against ${holder.name}`} onClick={() => send({ a: "sign", race: holder.race })}>
                    {signed ? "Signed" : "Sign petition"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ph-note">The list of executives is loading.</p>
      )}
      {holders.length > 0 && <p className="ph-note">Not happy with an officer? Sign a petition. Enough signatures and the SRC sits to remove or clear them.</p>}
      <h3 className="ph-heading">Campaign gist</h3>
      <ul className="un-news ph-card">
        {newsUntil(cycle, now)
          .slice(0, NEWS_LIMIT)
          .map((line) => (
            <li key={`${line.at}${line.text}`}>
              <time>{newsStamp(line)}</time>
              <span>{line.text}</span>
            </li>
          ))}
      </ul>
    </>
  );
}

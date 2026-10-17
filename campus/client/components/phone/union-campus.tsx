import { CONGRESS_VENUE, OUTCOME_LABEL, STATE_LABEL, activeStates, congressesFor, electionCycle, findConcession, findMotion, marchPlan, sittingPhase, voteOpensAt, weekClock, WEEK_MINUTES } from "@campuslife/shared";
import type { Politics } from "@campus/components/politics/use-politics";

const stamp = (total: number) => weekClock(((total % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES);

export function UnionCampus({ politics }: { politics: Politics }) {
  const { world, time } = politics;
  const states = activeStates(world?.states ?? [], time.total);
  const called = world?.called;
  const sittings = [...congressesFor(electionCycle(time)), ...(called ? [called] : [])].filter((s) => sittingPhase(s, time.total) !== "done");
  return (
    <>
      <h3 className="ph-heading">Campus now</h3>
      {states.length === 0 && <p className="ph-note">Campus is calm. No boycott, no protest.</p>}
      {states.map((state) => {
        const plan = state.kind === "protest" ? marchPlan(state) : undefined;
        return (
          <section key={state.id} className="ph-card ph-order">
            <b>{STATE_LABEL[state.kind]}</b>
            <small>
              Over {state.issue}. Till {stamp(state.until)}.
              {state.kind === "boycott" ? " Lectures are boycotted, so attendance is not counted against anyone." : ""}
              {plan ? ` The march forms at the Anglo-Moz car park at ${stamp(plan.forms)} and walks to the SUB and the Main Gate. Stay with the crowd to be counted.` : ""}
              {state.kind === "concession" ? ` ${findConcession(state.concession)?.line ?? ""}` : ""}
            </small>
          </section>
        );
      })}
      {sittings.length > 0 && (
        <>
          <h3 className="ph-heading">Congress</h3>
          <ul className="ph-list">
            {sittings.map((sitting) => {
              const motion = findMotion(sitting.motion);
              const live = sittingPhase(sitting, time.total) !== "before";
              return (
                <li key={sitting.id} className={live ? "ph-list-row ph-live" : "ph-list-row"}>
                  <span className="ph-time">{stamp(sitting.start)}</span>
                  <span className="ph-list-text">
                    <b>{motion.question}</b>
                    <small>
                      {CONGRESS_VENUE}. Vote at {stamp(voteOpensAt(sitting)).slice(4)} by standing on a side. Aye: {OUTCOME_LABEL[motion.aye].toLowerCase()}. Nay: {OUTCOME_LABEL[motion.nay].toLowerCase()}.
                      {live ? " · now" : ""}
                    </small>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

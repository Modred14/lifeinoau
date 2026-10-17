import { CELEBRATE, PETITION, parseRace, swornIn } from "@campuslife/shared";
import { naira, type Politics } from "@campus/components/politics/use-politics";

export function UnionOutcome({ politics }: { politics: Politics }) {
  const { status, time, send } = politics;
  const mine = status?.mine;
  const post = mine ? parseRace(mine.race)?.post : undefined;
  if (!status || !mine || !post || !status.outcome) return null;
  const won = status.outcome === "won";
  const celebrated = status.marks.includes(CELEBRATE.mark);
  const petitioned = status.marks.includes(PETITION.mark);
  const closed = swornIn(time);
  return (
    <>
      <h3 className="ph-heading">Result</h3>
      <section className="ph-card ph-order">
        <b>{won ? `You won ${post.title}` : `You lost the ${post.title} race`}</b>
        <small>{won ? "Swearing-in is on Saturday at 10 am. Your stipend lands after the oath." : closed ? "The new executives are sworn in. Try again next week." : `You can petition SUIEC once for ${naira(status.petitionFee)}. A re-run is rare.`}</small>
      </section>
      <div className="ph-sheet-actions">
        {won ? (
          <button type="button" className="ph-btn" disabled={celebrated} onClick={() => send({ a: "celebrate" })}>
            {celebrated ? "Celebrated" : "Celebrate"}
          </button>
        ) : (
          <button type="button" className="ph-btn ph-btn-quiet" disabled={petitioned || closed} onClick={() => send({ a: "petition" })}>
            {petitioned ? "SUIEC has ruled" : "Petition SUIEC"}
          </button>
        )}
      </div>
    </>
  );
}

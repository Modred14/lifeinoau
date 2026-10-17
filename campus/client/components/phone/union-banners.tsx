import { RENTAL, RENTAL_AREAS, rentalsOpen, weekMinute } from "@campuslife/shared";
import { naira, type Politics } from "@campus/components/politics/use-politics";
import { usePending } from "@campus/components/use-pending";

export function UnionBanners({ politics }: { politics: Politics }) {
  const { status, world, time, send } = politics;
  const mine = status?.mine;
  const [pending, act] = usePending(status);
  if (!mine) return null;
  const open = rentalsOpen(weekMinute(time));
  const full = mine.rented.length >= RENTAL.perCandidate;
  return (
    <>
      <h3 className="ph-heading">Banner spots</h3>
      <p className="ph-note">
        Rent a spot and your banner hangs there till the polls. {RENTAL.perArea} spots in each area, first come, first served. You have {mine.rented.length} of {RENTAL.perCandidate}.
      </p>
      <ul className="ph-list">
        {RENTAL_AREAS.map((area) => {
          const taken = (world?.rentals ?? []).filter((r) => r.area === area.id).length;
          const owned = mine.rented.includes(area.id);
          const left = RENTAL.perArea - taken;
          return (
            <li key={area.id} className="ph-list-row">
              <span className="ph-list-text">
                <b>{area.name}</b>
                <small>
                  {naira(area.price)} · {left > 0 ? `${left} spot${left === 1 ? "" : "s"} left` : "No spot left"}
                </small>
              </span>
              {owned ? (
                <span className="ph-tag">Yours</span>
              ) : (
                <button type="button" className="ph-btn" disabled={!open || full || left <= 0 || pending} aria-label={`Rent a banner spot at ${area.name} for ${naira(area.price)}`} onClick={() => act(() => send({ a: "rent", area: area.id }))}>
                  Rent
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

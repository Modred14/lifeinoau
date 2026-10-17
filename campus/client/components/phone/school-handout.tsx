import { PiFileTextFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import { usePending } from "@campus/components/use-pending";
import type { Admin } from "./school-portal";

const TEXT = {
  held: "Handout in hand. More study in class and marks in its test",
  rep: (price: number) => `Buy handout from class rep (₦${price})`,
  copy: (price: number) => `Photocopy here (₦${price})`,
  copyHint: (price: number) => `Photocopy is ₦${price} at any business centre kiosk.`,
  loved: "This lecturer likes students who buy the handout.",
};

export function CourseHandout({ view, admin, code }: { view: CampusView; admin: Admin; code: string }) {
  const handout = admin.handouts[code];
  const [pending, act] = usePending(admin);
  if (!handout) return null;
  if (handout.held) {
    return (
      <span className="ph-tag">
        <PiFileTextFill aria-hidden="true" /> {TEXT.held}
      </span>
    );
  }
  return (
    <>
      <button type="button" className="ph-btn ph-btn-quiet" disabled={pending} onClick={() => act(() => view.sendAdmin({ a: "handout", code }))}>
        {TEXT.rep(handout.repPrice)}
      </button>
      {admin.portal.nearCentre ? (
        <button type="button" className="ph-btn ph-btn-quiet" disabled={pending} onClick={() => act(() => view.sendAdmin({ a: "copy", code }))}>
          {TEXT.copy(handout.copyPrice)}
        </button>
      ) : (
        <small>{TEXT.copyHint(handout.copyPrice)}</small>
      )}
      {handout.loved && <small>{TEXT.loved}</small>}
    </>
  );
}

// components/DisciplineScreens.js
// What a player sees while a penalty is running. These replace the home room: a prisoner is IN Floor O, not at home, and a suspended or expelled
// player has nothing to do until it ends. Every figure counts down against the SERVER's clock (`now` comes from lib/serverClock.js), and the
// server enforces the same deadlines whatever this screen shows.
import { Icon } from "@/components/Icon";
import { naira } from "@/lib/client";
import { bailFor } from "@/lib/engine";
import { CUSTODY_NAME, RESTART_LEVEL, isExpelled, isSuspended } from "@/lib/discipline";

/** "1h 59m 03s", "12m 05s", "9s" */
export const countdown = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
const left = (until, now) => Math.max(0, +new Date(until) - now);
const openPhone = () => window.dispatchEvent(new Event("oau:phone"));

function Stat({ label, value }) {
  return (
    <div>
      <span className="mut">{label}</span>
      <b className="num">{value}</b>
    </div>
  );
}

/** Serving a sentence: held inside Floor O (N-QRS Custody) until it ends. Messaging stays open; bail ends it early. */
export function Custody({ st, now, busy, bail }) {
  const fz = st.floorZero, c = st.character, expelled = isExpelled(c, now), suspended = isSuspended(c, now);
  return (
    <div className="gh-end gh-bad" role="status" aria-live="polite">
      <span className="gh-endico"><Icon name="siren" size={34} /></span>
      <h1>{CUSTODY_NAME}</h1>
      <p className="mut">
        You are being held here and you serve your whole sentence inside. You cannot leave, travel or do anything else until it ends, but you can still message other players.
      </p>
      <div className="gh-endstats">
        <Stat label="Time left" value={countdown(left(fz.releaseAt, now))} />
        <Stat label="Bail" value={naira(bailFor(fz.releaseAt, now))} />
      </div>
      {expelled && <p className="mut">You have also been expelled. You can start again from {RESTART_LEVEL}L in {countdown(left(c.expelledUntil, now))}.</p>}
      {suspended && !expelled && <p className="mut">You are also suspended for another {countdown(left(c.suspendedUntil, now))}.</p>}
      <div className="gx-alert-acts" style={{ marginTop: 16, width: "100%", maxWidth: 360 }}>
        <button type="button" className="go" disabled={busy || expelled} onClick={bail} title={expelled ? "An expelled player cannot pay bail" : undefined}>
          Pay {naira(bailFor(fz.releaseAt, now))} to leave
        </button>
        <button type="button" onClick={openPhone}>
          <Icon name="chat" size={18} /> Messages
        </button>
      </div>
    </div>
  );
}

/** Suspended for up to 2 hours. */
export function Suspension({ c, now }) {
  return (
    <div className="gh-end gh-bad" role="status" aria-live="polite">
      <span className="gh-endico"><Icon name="warn" size={34} /></span>
      <h1>You are suspended</h1>
      <p className="mut">You cannot take actions until the suspension ends. You can still message other players.</p>
      <div className="gh-endstats"><Stat label="Back in" value={countdown(left(c.suspendedUntil, now))} /></div>
      <div className="gx-alert-acts" style={{ marginTop: 16, width: "100%", maxWidth: 360 }}>
        <button type="button" onClick={openPhone}><Icon name="chat" size={18} /> Messages</button>
      </div>
    </div>
  );
}

/** Expelled for up to 5 hours; afterwards the player starts again from 100L. */
export function Expulsion({ c, a, now }) {
  const ends = c.expelledUntil != null;
  return (
    <div className="gh-end gh-bad" role="status" aria-live="polite">
      <span className="gh-endico"><Icon name="warn" size={34} /></span>
      <h1>You have been expelled</h1>
      <p className="mut">
        When the expulsion ends you start again from {RESTART_LEVEL}L. Your money, home, relationships and messages stay as they are. Final CGPA so far: {a?.cgpa ?? "none"}.
      </p>
      {ends && <div className="gh-endstats"><Stat label={`Back at ${RESTART_LEVEL}L in`} value={countdown(left(c.expelledUntil, now))} /></div>}
      <div className="gx-alert-acts" style={{ marginTop: 16, width: "100%", maxWidth: 360 }}>
        <button type="button" onClick={openPhone}><Icon name="chat" size={18} /> Messages</button>
      </div>
    </div>
  );
}
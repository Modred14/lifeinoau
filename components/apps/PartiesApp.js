// components/apps/PartiesApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useEffect } from "react";
import { call, naira } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, run, cash, canAfford, useResource } from "@/lib/gameStore";
import Loader from "@/components/Loader";

export default function Parties() {
  const { d, store, router } = useResource("/api/parties");
  useEffect(() => {
    // attendance changes as others buy tickets: look again every 20 seconds, but only while the tab is on screen
    const t = setInterval(() => !document.hidden && store.refresh(), 20000);
    return () => clearInterval(t);
  }, [store]);

  // Buying a ticket shows at once (the card flips to "You're going", attendance goes up, your cash drops) and is undone if refused,
  // for example when the last ticket was sold a moment earlier. What happens on the night is random, so that part shows when the server answers.
  function go(venue) {
    const p = d.parties.find((x) => x.venue === venue);
    if (!canAfford(p.priceKobo)) return toast.error("You cannot afford the ticket.");
    return run({
      key: "party:" + venue,
      router,
      sensitive: true, // the last ticket may have just gone: "ticket bought" is only said once the server has confirmed it
      pending: `Buying your ticket to ${venue}…`,
      ok: `Ticket bought. You're going to ${venue}.`,
      request: () =>
        call("/api/parties", { venue, requestId: crypto.randomUUID() }),
      effects: [
        {
          store,
          patch: (x) => ({
            ...x,
            wentOut: true,
            parties: x.parties.map((q) =>
              q.venue === venue ? { ...q, going: true, attendees: q.attendees + 1 } : q,
            ),
          }),
        },
        { store: game, patch: cash(-BigInt(p.priceKobo)) },
      ],
      then: (r) =>
        toast.success(
          `${r.title}${r.note ? " " + r.note : ""}${BigInt(r.extraKobo) > 0n ? ` It cost you ${naira(r.extraKobo)} extra.` : ""}`,
        ),
    });
  }
  return (
    <>
      <div className="top">
        <h2>Parties</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      <p className="mut">
        Week {d?.week}. One night out per week. New lineups every week.
      </p>
      {!d && <Loader label="Loading parties" />}
      {d?.parties.map((p) => {
        const full = p.attendees >= p.capacity,
          pct = Math.min(100, Math.round((p.attendees / p.capacity) * 100));
        return (
          <div className="card" key={p.venue}>
            <div className="top">
              <h2>{p.venue}</h2>
              <span className="cash">{naira(p.priceKobo)}</span>
            </div>
            <p>
              {p.theme} · {p.headliner}
              <br />
              <span className="mut">{p.night}</span>
            </p>
            <div className="top">
              <span className="mut">
                {p.attendees} of {p.capacity} students attending
              </span>
              <span className="mut">{pct}%</span>
            </div>
            <div className="bar" aria-hidden="true">
              <i
                style={{
                  width: pct + "%",
                  background: full ? "var(--bad)" : "var(--ok)",
                }}
              />
            </div>
            <button
              className="go"
              style={{ width: "100%", marginTop: 10 }}
              disabled={d.wentOut || full}
              onClick={() => go(p.venue)}
            >
              {p.going
                ? "You're going"
                : full
                  ? "Sold out"
                  : d.wentOut
                    ? "You already went out this week"
                    : "Buy ticket and go"}
            </button>
          </div>
        );
      })}
    </>
  );
}
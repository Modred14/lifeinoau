// components/apps/PartiesApp.js: lives inside the phone (see components/Phone.js)
// Real events added by administrators. Each one is a card: the flyer, then name / price / host / date, then a Buy ticket button that opens the event's own ticket page.
"use client";
import { useEffect } from "react";
import { useResource } from "@/lib/gameStore";
import Loader from "@/components/Loader";

// A ticket price is shown exactly (₦2,500 or ₦2,500.50), never in the compact 2.50k form the rest of the game uses for balances.
const price = (kobo) => {
  const k = BigInt(kobo);
  if (k === 0n) return "Free";
  const w = (k / 100n).toLocaleString("en-NG"), c = k % 100n;
  return "₦" + w + (c ? "." + String(c).padStart(2, "0") : "");
};
const when = (iso) => new Date(iso).toLocaleString("en-NG", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function Parties() {
  const { d, store } = useResource("/api/parties");
  useEffect(() => {
    // new events appear as administrators add them: look again every minute, but only while the tab is on screen
    const t = setInterval(() => !document.hidden && store.refresh(), 60000);
    return () => clearInterval(t);
  }, [store]);

  return (
    <>
      <div className="top">
        <h2>Parties</h2>
        <a href="/home">
          <button>Back to game</button>
        </a>
      </div>
      <p className="mut">Upcoming parties and events. Go to as many as you like.</p>
      {!d && <Loader label="Loading parties" />}
      {d && d.events.length === 0 && <p className="mut">No events listed right now. Check back soon.</p>}
      {d?.events.map((e) => (
        <article className="card ev-card" key={e.id}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ev-flyer" src={e.flyer} alt={`${e.name} flyer`} loading="lazy" />
          <div className="ev-info">
            <b className="ev-name">{e.name}</b>
            <span className="cash ev-price">{price(e.priceKobo)}</span>
            <span className="mut ev-host">Hosted by {e.host}</span>
            <span className="mut ev-date">{when(e.date)}</span>
          </div>
          <a className="ev-buy" href={e.ticketUrl} target="_blank" rel="noopener noreferrer">
            <button className="go" style={{ width: "100%" }}>
              Buy ticket
            </button>
          </a>
        </article>
      ))}
    </>
  );
}

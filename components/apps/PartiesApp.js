// components/apps/PartiesApp.js: lives inside the phone (see components/Phone.js)
// Real events added by administrators. Each one is a ticket-style card: the flyer (with the date and a "Tonight / Tomorrow" tag on it),
// then the BIG event name, the host and the time, then a stub with the price and, for paid events only, a Get ticket button that opens the event's own ticket page (free events show "Free" and no button).
// A small copy icon on each flyer copies that event's own link (/home?event=<slug>). Opening such a link lands here: the phone opens on this app,
// scrolls to the event and lights it up for a moment (lib/eventLink.js carries the event from the address bar, through log in, to this screen).
"use client";
import { useEffect, useRef, useState } from "react";
import { useResource } from "@/lib/gameStore";
import { toast } from "@/lib/toast";
import { eventUrl, takeFocus } from "@/lib/eventLink";
import Loader from "@/components/Loader";
import LoadError from "../LoadError";
import { Icon } from "../Icon";
import "./parties-app.css";

// A ticket price is shown exactly (₦2,500 or ₦2,500.50), never in the compact 2.50k form the rest of the game uses for balances.
const price = (kobo) => {
  const k = BigInt(kobo);
  if (k === 0n) return "Free";
  const w = (k / 100n).toLocaleString("en-NG"), c = k % 100n;
  return "₦" + w + (c ? "." + String(c).padStart(2, "0") : "");
};

const DAY = 86_400_000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dayLine = (iso) => new Date(iso).toLocaleDateString("en-NG", { weekday: "long", day: "numeric", month: "short" });
const timeLine = (iso) => new Date(iso).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?([ap])m$/i, (_, x) => " " + x.toUpperCase() + "M");
const month = (iso) => new Date(iso).toLocaleDateString("en-NG", { month: "short" });
const dayNum = (iso) => new Date(iso).getDate();

/** The little tag on the flyer: how close the event is. Far-off events get no tag (the date tile already says it). */
function soon(iso, now) {
  const t = new Date(iso).getTime();
  if (t <= now) return { text: "Happening now", tone: "live" };
  const days = Math.round((startOfDay(t) - startOfDay(now)) / DAY);
  if (days === 0) return { text: new Date(t).getHours() >= 17 ? "Tonight" : "Today", tone: "hot" };
  if (days === 1) return { text: "Tomorrow", tone: "hot" };
  if (days < 8) return { text: `In ${days} days`, tone: "soon" };
  return null;
}

/** The flyer, with a tidy placeholder if the picture cannot be loaded. */
function Flyer({ src, name }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="pty-flyer pty-flyer-missing" role="img" aria-label={`${name} (flyer unavailable)`}>
        <Icon name="party" size={44} weight="fill" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="pty-flyer" src={src} alt={`${name} flyer`} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}

/** Copy text. The modern clipboard first; a hidden text box for older browsers and non-secure pages. Resolves true when it worked. */
async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* blocked or refused: try the older way below */ }
  try {
    const t = document.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.setAttribute("aria-hidden", "true");
    t.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch { return false; }
}

/** The little copy-link icon on the flyer. */
function CopyLink({ slug, name }) {
  const [done, setDone] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const base = window.location.origin, link = eventUrl(slug, base);
    if (await copyText(link)) {
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1800);
      toast.success("Event link copied", { id: "event-copied", duration: 2200 });
    } else toast.info(link, { id: "event-copied", duration: 9000 }); // could not reach the clipboard: show the link so it can be copied by hand
  };
  return (
    <button type="button" className="pty-copy" data-done={done || undefined} onClick={copy} aria-label={`Copy link to ${name}`}>
      <Icon name={done ? "check" : "copy"} size={17} weight={done ? "bold" : "regular"} />
    </button>
  );
}

function EventCard({ e, now, index, spot }) {
  const next = index === 0, tag = soon(e.date, now), free = BigInt(e.priceKobo) === 0n;
  return (
    <article className={"pty-card" + (next ? " pty-card-next" : "") + (spot ? " pty-card-spot" : "")} data-slug={e.slug} style={{ "--i": Math.min(index, 6) }} aria-labelledby={`pty-n-${e.id}`}>
      <div className="pty-media">
        <Flyer src={e.flyer} name={e.name} />
        {e.slug && <CopyLink slug={e.slug} name={e.name} />}
        <span className="pty-tile" aria-hidden="true">
          <small>{month(e.date)}</small>
          <b>{dayNum(e.date)}</b>
        </span>
        {tag && (
          <span className="pty-tag" data-tone={tag.tone}>
            {tag.tone === "live" && <i aria-hidden="true" />}
            {tag.text}
          </span>
        )}
      </div>

      <div className="pty-body">
        {next && <span className="pty-kicker">Next up</span>}
        <h3 className="pty-name" id={`pty-n-${e.id}`}>{e.name}</h3>
        <p className="pty-host">
          <span className="pty-host-av" aria-hidden="true">{[...e.host.trim()][0]?.toUpperCase() ?? "•"}</span>
          <span>Hosted by <b>{e.host}</b></span>
        </p>
        <p className="pty-when">
          <Icon name="clock" size={18} />
          <span>{dayLine(e.date)} <i aria-hidden="true">·</i> <b>{timeLine(e.date)}</b></span>
        </p>
      </div>

      <div className="pty-foot" data-free={free || undefined}>
        <div className="pty-price" data-free={free || undefined}>
          <small>{free ? "Entry" : "Ticket"}</small>
          <b>{price(e.priceKobo)}</b>
        </div>
        {/* a free event has nothing to buy, so it has no ticket button at all */}
        {!free && (
          <a className="pty-buy" href={e.ticketUrl} target="_blank" rel="noopener noreferrer" aria-label={`Get ticket for ${e.name} (opens in a new tab)`}>
            <Icon name="ticket" size={20} weight="fill" />
            Get ticket
            <Icon name="next" size={17} weight="bold" />
          </a>
        )}
      </div>
    </article>
  );
}

export default function Parties() {
  const { d, store, load, loadFailed } = useResource("/api/parties");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // new events appear as administrators add them: look again every minute, but only while the tab is on screen
    const t = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden) store.refresh();
    }, 60000);
    return () => clearInterval(t);
  }, [store]);

  // Sent here by a shared link? Take the request once (so closing and reopening the app never repeats it), make sure the list is fresh,
  // then scroll to that event and light it up. An event that is gone gets a clear message instead of a silent miss.
  const root = useRef(null), handled = useRef(false), alive = useRef(true);
  const [spot, setSpot] = useState(null), [target, setTarget] = useState(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (handled.current) return; // React may run this twice in development; the request is taken only once
    handled.current = true;
    const slug = takeFocus();
    if (!slug) return;
    store.refresh().then((r) => {
      if (!alive.current || r?.status === 401) return; // a 401 already sent the player to log in, with the event kept
      if (store.get()?.events?.some((x) => x.slug === slug)) setTarget(slug);
      else if (!r?.failed) toast.info("That event is no longer listed. It may have ended or been removed.", { id: "event-link", duration: 6000 });
    });
  }, [store]);
  useEffect(() => {
    if (!target || !d) return;
    const el = root.current?.querySelector(`[data-slug="${target}"]`);
    if (!el) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // two frames later, so the cards have their final size before the scroll starts
    requestAnimationFrame(() => requestAnimationFrame(() => el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "center" })));
    setSpot(target);
    setTarget(null);
  }, [target, d]);
  useEffect(() => {
    if (!spot) return;
    const t = setTimeout(() => setSpot(null), 3200);
    return () => clearTimeout(t);
  }, [spot]);

  if (loadFailed) return <LoadError title="Parties didn't load" message="Check your connection and try again." onRetry={load} />;
  if (!d) return <Loader label="Loading parties" />;

  const n = d.events.length;
  return (
    <div className="pty" ref={root}>
      <section className="pty-hero" aria-label="Summary">
        <div className="pty-hero-copy">
          <span className="pty-eyebrow">What&rsquo;s on</span>
          <h2>{n === 0 ? "Nothing planned yet" : `${n} ${n === 1 ? "event" : "events"} coming up`}</h2>
          <p>Go to as many as you like.</p>
        </div>
        <span className="pty-hero-ico" aria-hidden="true">
          <Icon name="party" size={34} weight="fill" />
        </span>
      </section>

      {n === 0 ? (
        <section className="pty-empty">
          <span className="pty-empty-ico" aria-hidden="true">
            <Icon name="party" size={40} weight="fill" />
          </span>
          <h3>No parties right now</h3>
          <p>New events show up here as soon as they&rsquo;re listed. Check back soon.</p>
        </section>
      ) : (
        d.events.map((e, i) => <EventCard key={e.id} e={e} now={now} index={i} spot={spot === e.slug} />)
      )}
    </div>
  );
}
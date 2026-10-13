// components/apps/MessagesApp.js: the Messages app. Inbox, chat, player profile and send-money, all inside the phone.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { askText } from "@/lib/confirm";
import { Icon } from "../Icon";

const initials = (n = "") => n.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
const HUES = ["#3b6fd4", "#1f8f6a", "#b5651d", "#8a4fb3", "#c2456a", "#2e8a9c", "#a0802a"];
const hue = (n = "") => HUES[[...n].reduce((s, ch) => s + ch.charCodeAt(0), 0) % HUES.length];
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), n = new Date(), mins = (n - d) / 60000;
  if (mins < 1) return "now";
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").toLowerCase();
  if (mins < 60 * 24 * 6) return d.toLocaleDateString("en-NG", { weekday: "short" });
  return d.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
};
const sameMinute = (a, b) => a && b && Math.abs(new Date(a) - new Date(b)) < 5 * 60000;

function Avatar({ name, size = 44 }) {
  return (
    <span className="ms-av" style={{ width: size, height: size, background: hue(name), fontSize: size * 0.36 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export default function MessagesApp({ onHome, onUnread }) {
  const router = useRouter();
  const [inbox, setInbox] = useState(null),
    [q, setQ] = useState(""),
    [found, setFound] = useState([]),
    [who, setWho] = useState(null),
    [thread, setThread] = useState(null),
    [prof, setProf] = useState(null),
    [text, setText] = useState(""),
    [sheet, setSheet] = useState(null), // "profile" | "pay"
    [amt, setAmt] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("all");
  const searchBox = useRef(null);
  const scroller = useRef(null),
    whoRef = useRef(null);
  whoRef.current = who;
  const fail = useCallback((r) => (r.status === 401 ? loggedOut(router) : notifyError(r, "Something went wrong. Please try again.")), [router]);

  const loadInbox = useCallback(async () => {
    const r = await call("/api/messages");
    if (r.failed) return fail(r);
    setInbox(r.conversations);
    onUnread?.(r.conversations.reduce((s, c) => s + c.unread, 0));
  }, [fail, onUnread]);
  useEffect(() => {
    loadInbox();
    const t = setInterval(() => !document.hidden && loadInbox(), 12000);
    return () => clearInterval(t);
  }, [loadInbox]);

  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(async () => {
      const r = await call("/api/players?q=" + encodeURIComponent(q));
      r.failed ? fail(r) : setFound(r.players);
    }, 280);
    return () => clearTimeout(t);
  }, [q, fail]);

  const loadThread = useCallback(async (name) => {
    const m = await call("/api/messages?with=" + encodeURIComponent(name));
    if (whoRef.current !== name) return;
    m.failed ? fail(m) : setThread(m.messages);
  }, [fail]);
  // while a chat is open, new messages arrive without a refresh
  useEffect(() => {
    if (!who) return;
    const t = setInterval(() => !document.hidden && loadThread(who), 6000);
    return () => clearInterval(t);
  }, [who, loadThread]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, who]);

  async function open(name) {
    setWho(name);
    setThread(null);
    setProf(null);
    setSheet(null);
    setQ("");
    const [p] = await Promise.all([call("/api/profile?name=" + encodeURIComponent(name)), loadThread(name)]);
    if (whoRef.current === name) p.failed ? fail(p) : setProf(p);
    loadInbox();
  }
  function close() {
    setWho(null);
    setThread(null);
    setProf(null);
    setSheet(null);
    loadInbox();
  }
  async function act(path, body, ok, after) {
    if (busy) return;
    setBusy(true);
    const r = await call(path, body);
    setBusy(false);
    if (r.failed) return fail(r);
    r.duplicate ? toast.info("Already done.") : toast.success(ok(r));
    after?.();
  }
  async function send(e) {
    e.preventDefault();
    const body = text.trim();
    if (!body || busy) return;
    setText("");
    setThread((t) => [...(t ?? []), { mine: true, body, at: new Date().toISOString(), pending: true }]);
    const r = await call("/api/messages", { to: who, body });
    if (r.failed) {
      setText(body);
      fail(r);
    }
    loadThread(who);
  }
  const fee = Number.isInteger(Number(amt)) && Number(amt) > 0 ? Math.floor(Number(amt) * 0.02) : 0;
  const pay = (e) => {
    e.preventDefault();
    act("/api/transfer", { to: who, amountNaira: Number(amt), memo: note, requestId: crypto.randomUUID() },
      (r) => `Sent ${naira(r.sentKobo)} (fee ${naira(r.feeKobo)}).`,
      () => { setAmt(""); setNote(""); setSheet(null); window.dispatchEvent(new Event("game:refresh")); });
  };
  async function report() {
    const reason = await askText({
      title: `Report ${who}`,
      message: "Tell us what happened so we can review it. Our team can read the chat between you.",
      label: "What happened?", placeholder: "Describe the problem", multiline: true, maxLength: 500, confirmLabel: "Send report", tone: "danger",
    });
    if (reason === null) return;
    act("/api/safety", { action: "report", name: who, reason }, () => "Report sent. Thank you.", () => setSheet(null));
  }

  /* ---------- chat ---------- */
  if (who)
    return (
      <div className="ms ms-chat">
        <header className="ms-bar">
          <button type="button" className="ms-back" onClick={close} aria-label="Back to messages"><Icon name="back" size={22} weight="bold" /></button>
          <button type="button" className="ms-who" onClick={() => setSheet("profile")} aria-label={`${who}, view profile`}>
            <Avatar name={who} size={34} />
            <span><b>{who}</b><small>{prof ? `${prof.level}L · ${prof.faculty}` : "Tap for profile"}</small></span>
          </button>
          <button type="button" className="ms-icon" onClick={() => setSheet("pay")} aria-label={`Send money to ${who}`}><Icon name="coins" size={22} /></button>
        </header>
        <div className="ms-thread" ref={scroller}>
          {thread === null ? (
            <p className="ms-empty">Loading…</p>
          ) : thread.length === 0 ? (
            <div className="ms-empty"><Avatar name={who} size={64} /><b>{who}</b><span>No messages yet. Say hi.</span></div>
          ) : (
            thread.map((m, i) => {
              const prev = thread[i - 1], next = thread[i + 1];
              const first = !prev || prev.mine !== m.mine || !sameMinute(prev.at, m.at), last = !next || next.mine !== m.mine || !sameMinute(m.at, next.at);
              return (
                <div key={i} className={"ms-row" + (m.mine ? " mine" : "")} data-first={first ? "1" : undefined} data-last={last ? "1" : undefined}>
                  {first && (!prev || !sameMinute(prev.at, m.at)) && <time className="ms-time">{when(m.at)}</time>}
                  <p className={"ms-bub" + (m.pending ? " pending" : "")}>{m.body}</p>
                </div>
              );
            })
          )}
        </div>
        <form className="ms-compose" onSubmit={send}>
          <input type="text" maxLength={500} placeholder="Message" aria-label={`Message ${who}`} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="send" />
          <button type="submit" className="ms-send" disabled={!text.trim()} aria-label="Send"><Icon name="next" size={20} weight="bold" /></button>
        </form>

        {sheet && (
          <div className="ph-sheet-scrim" onClick={() => setSheet(null)}>
            <div className="ph-sheet" role="dialog" aria-modal="true" aria-label={sheet === "pay" ? "Send money" : "Profile"} onClick={(e) => e.stopPropagation()}>
              <span className="ph-grab" aria-hidden="true" />
              {sheet === "profile" ? (
                prof ? (
                  <>
                    <div className="ms-prof">
                      <Avatar name={prof.name} size={72} />
                      <h3>{prof.name}</h3>
                      <p className="mut">{prof.faculty} · {prof.level}L · {prof.class}</p>
                      {prof.personalities?.length > 0 && <p className="ms-tags">{prof.personalities.map((p) => <span key={p}>{p}</span>)}</p>}
                    </div>
                    <dl className="ms-facts">
                      <div><dt>CGPA</dt><dd className="num">{prof.cgpa ?? "–"}</dd></div>
                      <div><dt>Net worth</dt><dd className="num">{naira(prof.netWorthKobo)}</dd></div>
                      <div><dt>Popularity</dt><dd className="num">{prof.popularity}</dd></div>
                    </dl>
                    {prof.graduated && <p className="ms-note">Graduated · {prof.classification}</p>}
                    {prof.achievements?.length > 0 && <p className="ms-tags">{prof.achievements.map((a) => <span key={a}>{a}</span>)}</p>}
                    <div className="ms-actions">
                      <button type="button" className="go" onClick={() => setSheet("pay")}>Send money</button>
                      <button type="button" disabled={busy} onClick={() => act("/api/safety", { action: "block", name: who }, () => "Blocked. You can no longer message or pay each other.", () => { setSheet(null); close(); })}>Block</button>
                      <button type="button" disabled={busy} onClick={report}>Report</button>
                    </div>
                  </>
                ) : <p className="ms-empty">Loading…</p>
              ) : (
                <form onSubmit={pay}>
                  <h3>Send money to {who}</h3>
                  <p className="mut">₦100 to ₦5,000,000 each, ₦10M a day. A 2% fee is added on top.</p>
                  <label>Amount<input type="text" inputMode="numeric" placeholder="₦ amount" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} autoFocus /></label>
                  <label>Note <span className="mut">(optional)</span><input type="text" maxLength={80} value={note} onChange={(e) => setNote(e.target.value)} /></label>
                  {Number(amt) > 0 && <p className="mut">You pay ₦{(Number(amt) + fee).toLocaleString("en-NG")} in total.</p>}
                  <button className="go" style={{ width: "100%" }} disabled={busy || Number(amt) < 100}>Send {amt ? "₦" + Number(amt).toLocaleString("en-NG") : "money"}</button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    );

  /* ---------- inbox ---------- */
  const searching = q.trim().length >= 2;
  const unreadTotal = (inbox ?? []).reduce((n, c) => n + c.unread, 0);
  const rows = (inbox ?? []).filter((c) => (filter === "unread" ? c.unread > 0 : filter === "read" ? c.unread === 0 : true));
  return (
    <div className="ms">
      <header className="ms-bar ms-bar--list">
        <button type="button" className="ms-back" onClick={onHome} aria-label="Back to home screen"><Icon name="back" size={24} weight="bold" /></button>
        <h2>Messages</h2>
        <button type="button" className="ms-icon ms-compose-btn" onClick={() => searchBox.current?.focus()} aria-label="Find a player to message"><Icon name="plus" size={22} weight="bold" /></button>
      </header>
      <div className="ms-search">
        <Icon name="talk" size={18} />
        <input ref={searchBox} type="search" placeholder="Find a player to message" aria-label="Search players" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!searching && (
        <div className="ms-chips" role="tablist" aria-label="Filter chats">
          {[["all", "All"], ["unread", unreadTotal ? `Unread · ${unreadTotal}` : "Unread"], ["read", "Read"]].map(([k, l]) => (
            <button type="button" role="tab" aria-selected={filter === k} key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      )}
      <div className="ms-list">
        {searching ? (
          found.length ? found.map((p) => (
            <button type="button" key={p.name} className="ms-conv" onClick={() => open(p.name)}>
              <Avatar name={p.name} />
              <span className="ms-c"><b>@{p.name}</b><small>{p.level}L · {p.faculty}</small></span>
            </button>
          )) : <p className="ms-empty">No player found.</p>
        ) : inbox === null ? (
          <p className="ms-empty">Loading…</p>
        ) : rows.length ? (
          rows.map((c) => (
            <button type="button" key={c.name} className="ms-conv" onClick={() => open(c.name)}>
              <Avatar name={c.name} />
              <span className="ms-c">
                <span className="ms-c1"><b>@{c.name}</b><time>{when(c.at)}</time></span>
                <span className="ms-c2"><small className={c.unread ? "unread" : ""}>{c.last}</small>{c.unread > 0 && <i className="ms-dot">{c.unread}</i>}</span>
              </span>
            </button>
          ))
        ) : (
          <div className="ms-empty"><span className="ms-emptyico"><Icon name="chat" size={30} weight="fill" /></span><b>{inbox.length ? "Nothing here" : "No conversations yet"}</b><span>{inbox.length ? "No chats match this filter." : "Search for a player above to say hi."}</span></div>
        )}
      </div>
    </div>
  );
}
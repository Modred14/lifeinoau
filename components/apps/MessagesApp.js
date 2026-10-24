// components/apps/MessagesApp.js: the Messages app. Inbox, chat, profile, send money, block and report, all inside the phone.
// Everything here reads one live copy of the chat (lib/chat.js). A message you send is on screen before anything is sent;
// its ticks then move on their own: clock, one grey tick (sent), two grey (delivered), two blue (read).
"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { call, naira as nairaOf, notifyError, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import {
  game,
  useGame,
  run,
  cash,
  canAfford,
  resourceStore,
  useStore,
} from "@/lib/gameStore";
import { createSerial } from "@/lib/optimistic";
import { chat, useChat } from "@/lib/chat";
import { KIND, parseMoney, naira as fmt } from "@/lib/chatShared";
import { Icon } from "../Icon";
import { Spinner } from "../Loader";
import PlayerAvatar from "../PlayerAvatar";
import "./messages-app.css";

const lc = (n = "") => String(n).toLowerCase();
const hm = (d) =>
  new Date(d)
    .toLocaleTimeString("en-NG", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s/g, "")
    .toLowerCase();
const sameDay = (a, b) =>
  new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (d) => {
  const x = new Date(d),
    n = new Date(),
    y = new Date(n - 86_400_000);
  if (sameDay(x, n)) return "Today";
  if (sameDay(x, y)) return "Yesterday";
  return x.toLocaleDateString(
    "en-NG",
    n - x < 6 * 86_400_000
      ? { weekday: "long" }
      : {
          day: "numeric",
          month: "short",
          year: n.getFullYear() === x.getFullYear() ? undefined : "numeric",
        },
  );
};
const listTime = (d) =>
  !d
    ? ""
    : sameDay(d, new Date())
      ? hm(d)
      : dayLabel(d) === "Yesterday"
        ? "Yesterday"
        : new Date() - new Date(d) < 6 * 86_400_000
          ? new Date(d).toLocaleDateString("en-NG", { weekday: "short" })
          : new Date(d).toLocaleDateString("en-NG", {
              day: "numeric",
              month: "short",
            });
const seenText = (d) =>
  !d
    ? ""
    : `last seen ${sameDay(d, new Date()) ? "today" : dayLabel(d) === "Yesterday" ? "yesterday" : dayLabel(d)} at ${hm(d)}`;
const isTouch = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches;
const PLAIN = { onMouseDown: (e) => e.preventDefault() }; // tapping a button must not close the keyboard

function Avatar({ name, size = 44, online }) {
  const dot = Math.max(10, Math.round(size * 0.27));
  return (
    <span className="ms-avwrap" style={{ width: size, height: size }}>
      <PlayerAvatar name={name} size={size} className="ms-av" />
      {online && (
        <i
          className="ms-online"
          style={{ width: dot, height: dot }}
          role="img"
          aria-label="online"
        />
      )}
    </span>
  );
}

/** The tick under your own message. state: sending | sent | delivered | read | failed */
function Ticks({ state }) {
  const label = {
    sending: "Sending",
    sent: "Sent",
    delivered: "Delivered",
    read: "Read",
    failed: "Not sent",
  }[state];
  return (
    <span className={"ms-tick " + state} role="img" aria-label={label}>
      {state === "sending" ? (
        <Icon name="clock" size={12} />
      ) : state === "failed" ? (
        <Icon name="alert" size={13} weight="fill" />
      ) : (
        <svg viewBox="0 0 18 11" width="17" height="11" aria-hidden="true">
          <path d="M1 5.8 4.4 9.2 10.8 1.6" />
          {(state === "delivered" || state === "read") && (
            <path className="second" d="M7.2 8.6 7.9 9.2 14.3 1.6" />
          )}
        </svg>
      )}
    </span>
  );
}



/** Show the banner when the browser is offline, or when reconnecting takes more than a moment (so quick reconnects never flash). */
function useLate(st) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (st.link !== "connecting") return setLate(false);
    const t = setTimeout(() => setLate(true), 2500);
    return () => clearTimeout(t);
  }, [st.link]);
  return st.offline ? "offline" : late ? "connecting" : null;
}
const Banner = ({ kind }) => (
  <p className="ms-banner" role="status">
    {kind === "offline"
      ? "You are offline. Messages you send will go out when you are back online."
      : "Connecting. Messages you send will go out when you are back online."}
  </p>
);

/* ============================== top level ============================== */
export default function MessagesApp({ onHome, initialWho = null }) {
  const [who, setWho] = useState(initialWho || null); // a name tag's "Message" opens straight into a chat with that player
  useEffect(() => {
    chat.setForeground(true);
    return () => chat.setForeground(false);
  }, []);
  return who ? (
    <ChatView key={who} who={who} onBack={() => setWho(null)} />
  ) : (
    <Inbox onHome={onHome} onOpen={setWho} />
  );
}

/* ============================== inbox ============================== */
function Inbox({ onHome, onOpen }) {
  const router = useRouter();
  const st = useChat();
  const [q, setQ] = useState(""),
    [found, setFound] = useState(null),
    [filter, setFilter] = useState("all"),
    [push, setPush] = useState({ supported: false, configured: false, enabled: false, busy: false, error: "" });
  const box = useRef(null),
    late = useLate(st);
  useEffect(() => {
    chat.watchInbox(true);
    return () => chat.watchInbox(false);
  }, []);
  useEffect(() => {
    const supported = window.isSecureContext && "serviceWorker" in navigator &&
      "PushManager" in window && "Notification" in window;
    setPush((p) => ({ ...p, supported }));
    (async () => {
      const registration = await navigator.serviceWorker?.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription();
      const path = "/api/messages/push" + (subscription ? "?endpoint=" + encodeURIComponent(subscription.endpoint) : "");
      const r = await call(path);
      if (r.failed) setPush((p) => ({ ...p, error: r.error || "Notification settings could not be loaded." }));
      else setPush((p) => ({ ...p, configured: !!r.configured, enabled: !!r.enabled }));
    })().catch((error) => setPush((p) => ({ ...p, error: error.message || "Notification settings could not be loaded." })));
  }, []);

  async function togglePush() {
    if (push.busy) return;
    setPush((p) => ({ ...p, busy: true, error: "" }));
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const ready = await navigator.serviceWorker.ready;
      const current = await (ready ?? registration).pushManager.getSubscription();
      if (push.enabled) {
        if (current) {
          const r = await call("/api/messages/push", { action: "remove", subscription: current.toJSON() });
          if (r.failed) throw new Error(r.error || "Notifications could not be turned off.");
          await current.unsubscribe();
        }
        setPush((p) => ({ ...p, enabled: false, busy: false }));
        return;
      }
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Allow notifications in your browser settings to enable message alerts.");
      }
      const config = await call("/api/messages/push");
      if (config.failed) throw new Error(config.error || "Notification settings could not be loaded.");
      if (!config.configured || !config.publicKey) throw new Error("Browser push notifications are not configured on this server.");
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
      const subscription = current ?? await (ready ?? registration).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const saved = await call("/api/messages/push", { subscription: subscription.toJSON() });
      if (saved.failed) {
        if (!current) await subscription.unsubscribe();
        throw new Error(saved.error || "This device could not be registered for message notifications.");
      }
      setPush((p) => ({ ...p, enabled: true, busy: false }));
    } catch (error) {
      setPush((p) => ({ ...p, busy: false, error: error.message || "Notifications could not be updated." }));
    }
  }

  useEffect(() => {
    if (q.trim().length < 2) return setFound(null);
    const ac = new AbortController();
    const t = setTimeout(async () => {
      const r = await call(
        "/api/players?q=" + encodeURIComponent(q),
        undefined,
        { signal: ac.signal },
      );
      if (ac.signal.aborted) return; // a newer search (or a cleared box) replaced this one: its answer is out of date
      r.failed
        ? r.status === 401
          ? loggedOut(router)
          : notifyError(r)
        : setFound(r.players);
    }, 250);
    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [q, router]);

  const inbox = st.inbox,
    unread = st.unread,
    live = st.link === "live";
  const rows = (inbox ?? []).filter((c) =>
    filter === "unread"
      ? c.unread > 0
      : filter === "online"
        ? st.presence[lc(c.name)]?.online
        : true,
  );
  const filters = [
    ["all", "All"],
    ["unread", unread ? `Unread ${unread}` : "Unread"],
    ...(live ? [["online", "Online"]] : []),
  ];

  return (
    <div className="ms">
      <header className="ms-bar ms-bar--list">
        <button
          type="button"
          className="ms-back"
          onClick={onHome}
          aria-label="Back to home screen"
        >
          <Icon name="back" size={24} weight="bold" />
        </button>
        <h2>Messages</h2>
        <button
          type="button"
          className="ms-icon ms-new"
          onClick={() => box.current?.focus()}
          aria-label="Find a player to message"
        >
          <Icon name="plus" size={22} weight="bold" />
        </button>
      </header>
      {late && <Banner kind={late} />}
      <section className="ms-push" aria-label="Browser message notifications">
        <div>
          <b>Browser notifications</b>
          <p>With browser/device support and permission, message alerts can arrive while Life in OAU is closed.</p>
          {push.error && <small role="alert">{push.error}</small>}
          {!push.configured && !push.error && <small>Push delivery is not configured on this server.</small>}
          {!push.supported && <small>This browser or device does not support push notifications in this context.</small>}
        </div>
        {push.supported && push.configured && (
          <button type="button" className="ms-push-toggle" disabled={push.busy} onClick={togglePush}>
            {push.busy ? "Please wait…" : push.enabled ? "Turn off" : "Enable"}
          </button>
        )}
      </section>
      <div className="ms-search">
        <Icon name="search" size={18} />
        <input
          ref={box}
          type="search"
          placeholder="Find a player to message"
          aria-label="Search players"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {found === null && (
        <div className="ms-chips" role="tablist" aria-label="Filter chats">
          {filters.map(([k, l]) => (
            <button
              type="button"
              role="tab"
              aria-selected={filter === k}
              key={k}
              className={filter === k ? "on" : ""}
              onClick={() => setFilter(k)}
            >
              {l}
            </button>
          ))}
        </div>
      )}
      <div className="ms-list">
        {found !== null ? (
          found.length ? (
            found.map((p) => (
              <button
                type="button"
                key={p.name}
                className="ms-conv"
                onClick={() => {
                  setQ("");
                  onOpen(p.name);
                }}
              >
                <Avatar
                  name={p.name}
                  online={st.presence[lc(p.name)]?.online}
                />
                <span className="ms-c">
                  <b>{p.name}</b>
                  <small>
                    {p.faculty}, {p.level}L
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="ms-empty">No player found with that name.</p>
          )
        ) : inbox === null ? (
          <Spinner />
        ) : rows.length ? (
          rows.map((c) => (
            <Row
              key={c.name}
              c={c}
              online={st.presence[lc(c.name)]?.online}
              typing={st.typing[lc(c.name)]}
              onOpen={() => onOpen(c.name)}
            />
          ))
        ) : (
          <div className="ms-empty">
            <span className="ms-emptyico">
              <Icon name="chat" size={30} weight="fill" />
            </span>
            <b>{inbox.length ? "Nothing here" : "No conversations yet"}</b>
            <span>
              {inbox.length
                ? "No chats match this filter."
                : "Search for a player above and say hi."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ c, online, typing, onOpen }) {
  const state = c.mine
    ? c.id <= c.peerRead
      ? "read"
      : c.id <= c.peerDel
        ? "delivered"
        : "sent"
    : null;
  const preview =
    c.kind === KIND.MONEY
      ? `${c.mine ? "You sent" : "Sent you"} ${c.last}`
      : c.last;
  return (
    <button
      type="button"
      className="ms-conv"
      onClick={onOpen}
      aria-label={`${c.name}${c.unread ? `, ${c.unread} unread` : ""}`}
    >
      <Avatar name={c.name} online={online} />
      <span className="ms-c">
        <span className="ms-c1">
          <b>{c.name}</b>
          <time className={c.unread ? "unread" : ""}>{listTime(c.at)}</time>
        </span>
        <span className="ms-c2">
          {typing ? (
            <small className="typing">typing…</small>
          ) : (
            <small className={c.unread ? "unread" : ""}>
              {state && <Ticks state={state} />}
              {c.kind === KIND.MONEY && (
                <Icon name="coins" size={14} weight="fill" />
              )}
              <span>{preview}</span>
            </small>
          )}
          {c.unread > 0 && (
            <i className="ms-dot" aria-hidden="true">
              {c.unread > 99 ? "99+" : c.unread}
            </i>
          )}
        </span>
      </span>
    </button>
  );
}

/* ============================== a chat ============================== */
function ChatView({ who, onBack }) {
  const router = useRouter();
  const st = useChat(),
    g = useGame(),
    late = useLate(st);
  const k = lc(who),
    t = st.threads[k],
    name = t?.name ?? who;
  const profStore = resourceStore(
      "/api/profile?name=" + encodeURIComponent(who),
    ),
    prof = useStore(profStore),
    [text, setText] = useState(""),
    [replying, setReplying] = useState(null),
    [actionMessage, setActionMessage] = useState(null),
    [deletingId, setDeletingId] = useState(null),
    [sheet, setSheet] = useState(null),
    [menu, setMenu] = useState(false),
    [below, setBelow] = useState(0),
    [dividerId, setDividerId] = useState(null),
    [reportDraft, setReportDraft] = useState({
      why: "",
      more: "",
      alsoBlock: true,
    });
  const [blockQ] = useState(createSerial),
    confirmedBlock = useRef(null);
  const [payDraft, setPayDraft] = useState({ amt: "", note: "" });
  const scroller = useRef(null),
    stick = useRef(true),
    prevH = useRef(0),
    prev = useRef({ len: 0, key: null, first: null }),
    field = useRef(null),
    typingOff = useRef(null),
    unreadOnOpen = useRef(0),
    divEl = useRef(null);
  const fail = useCallback(
    (r) => (r.status === 401 ? loggedOut(router) : notifyError(r)),
    [router],
  );

  useEffect(() => {
    unreadOnOpen.current = st.inbox?.find((c) => lc(c.name) === k)?.unread ?? 0;
    chat.openChat(who);
    profStore.refresh();
    return () => {
      chat.closeChat();
      clearTimeout(typingOff.current);
      chat.typing(who, false);
    };
  }, [who]); // eslint-disable-line react-hooks/exhaustive-deps

  // where the "unread" line goes: before the first message that was new when the chat was opened
  useEffect(() => {
    if (!t?.loaded || dividerId != null || !unreadOnOpen.current) return;
    const incoming = t.msgs.filter((m) => !m.mine && m.id != null),
      first = incoming[incoming.length - unreadOnOpen.current];
    if (first) setDividerId(first.id);
  }, [t?.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // scrolling: stay at the bottom unless the player scrolled up to read; keep their place when older messages are added on top
  const onScroll = () => {
    const e = scroller.current;
    if (!e) return;
    stick.current = e.scrollHeight - e.scrollTop - e.clientHeight < 90;
    if (stick.current) setBelow(0);
  };
  const toBottom = (smooth) => {
    const e = scroller.current;
    if (e)
      e.scrollTo({ top: e.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    setBelow(0);
  };
  useLayoutEffect(() => {
    const e = scroller.current;
    if (!e || !t) return;
    const last = t.msgs.at(-1),
      first = t.msgs[0],
      p = prev.current,
      key = last ? (last.id ?? last.cid) : null;
    if (
      prevH.current &&
      first &&
      p.first &&
      first !== p.first &&
      first.id < p.first.id
    ) {
      e.scrollTop += e.scrollHeight - prevH.current;
      prevH.current = 0;
    } else if (p.len === 0 && t.msgs.length) {
      divEl.current
        ? divEl.current.scrollIntoView({ block: "start" })
        : (e.scrollTop = e.scrollHeight);
    } else if (key !== p.key && t.msgs.length >= p.len) {
      if (last.mine || stick.current) toBottom(last.mine);
      else setBelow((n) => n + 1);
    }
    prev.current = { len: t.msgs.length, key, first };
  });

  // Escape closes the menu or sheet first, not the whole phone. The phone listens on `document` in the capture phase,
  // so this listens one step earlier (on `window`) and marks the key as handled, which the phone respects.
  useEffect(() => {
    if (!sheet && !menu && !actionMessage) return;
    const esc = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (sheet) setSheet(null);
        else if (actionMessage) setActionMessage(null);
        else setMenu(false);
      }
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  }, [sheet, menu, actionMessage]);

  const locateMessage = async (id) => {
    let current = chat.getState().threads[k];
    while (!current?.msgs.some((m) => m.id === id) && current?.hasMore) {
      const firstId = current.msgs.find((m) => m.id != null)?.id;
      const result = await chat.loadOlder(name);
      current = chat.getState().threads[k];
      if (!result || result.failed || result.ok === false || current.msgs.find((m) => m.id != null)?.id === firstId) break;
    }
    requestAnimationFrame(() => {
      const node = document.getElementById(`ms-message-${id}`);
      if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
      else toast.info("The original message is no longer in this conversation.");
    });
  };

  async function deleteSelected(mode) {
    const message = actionMessage;
    setActionMessage(null);
    if (!message?.id) return;
    if (mode === "everyone" && !(await confirmAction({
      title: "Delete for everyone?",
      message: "This message will be replaced with a deleted-message notice for both players.",
      confirmLabel: "Delete for everyone",
      tone: "danger",
    }))) return;
    setDeletingId(message.id);
    const r = await call("/api/messages/delete", { id: message.id, mode });
    setDeletingId(null);
    if (r.failed) return fail(r);
    chat.onDeleted({ id: message.id, mode, mine: r.mine, with: r.peerName });
  }

  // composer
  const grow = () => {
    const e = field.current;
    if (e) {
      e.style.height = "auto";
      e.style.height = Math.min(e.scrollHeight, 112) + "px";
    }
  };
  const onType = (e) => {
    setText(e.target.value);
    grow();
    chat.typing(who, true);
    clearTimeout(typingOff.current);
    typingOff.current = setTimeout(() => chat.typing(who, false), 2500);
  };
  const send = () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    requestAnimationFrame(grow);
    stick.current = true;
    chat.send(name, body, replying ? { replyToId: replying.id, reply: replying } : undefined);
    setReplying(null);
    field.current?.focus();
  };
  const onKey = (e) => {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !isTouch() &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault();
      send();
    }
  };

  // Block, unblock and report show at once. Their requests go out one after another (quick taps reach the server in order, the last tap wins),
  // and a refusal puts the button back to what the server last confirmed, unless a newer tap is already waiting. Success is announced after the server says so.
  const blockedNow = () => !!chat.getState().threads[k]?.blockedByMe;
  function setBlocked(want) {
    if (confirmedBlock.current == null) confirmedBlock.current = blockedNow();
    chat.patchThread(name, { blockedByMe: want });
    return blockQ.run(async () => {
      const r = await call("/api/safety", {
        action: want ? "block" : "unblock",
        name,
      });
      if (r.failed) {
        fail(r);
        if (blockQ.pending <= 1)
          chat.patchThread(name, { blockedByMe: confirmedBlock.current });
        return false;
      }
      confirmedBlock.current = want;
      toast.success(want ? `${name} is blocked.` : `${name} is unblocked.`);
      return true;
    });
  }
  async function block() {
    setMenu(false);
    if (
      !(await confirmAction({
        title: `Block ${name}?`,
        message:
          "You will not get their messages or money, and they cannot see when you are online. They are not told you blocked them.",
        confirmLabel: "Block",
        tone: "danger",
      }))
    )
      return;
    setSheet(null);
    setBlocked(true);
  }
  function unblock() {
    setMenu(false);
    setBlocked(false);
  }
  async function sendReport(reason, alsoBlock) {
    setSheet(null); // the sheet closes at once; if it fails it comes back with what was written
    if (alsoBlock) {
      if (confirmedBlock.current == null) confirmedBlock.current = blockedNow();
      chat.patchThread(name, { blockedByMe: true });
    }
    const r = await blockQ.run(() =>
      call("/api/safety", { action: "report", name, reason, alsoBlock }),
    );
    if (r.failed) {
      fail(r);
      if (alsoBlock && blockQ.pending === 0)
        chat.patchThread(name, { blockedByMe: confirmedBlock.current });
      setSheet("report");
      return;
    }
    if (alsoBlock) confirmedBlock.current = true;
    setReportDraft({ why: "", more: "", alsoBlock: true });
    toast.success("Report sent. Thank you.");
  }

  const presence = st.presence[k],
    typing = st.typing[k],
    blocked = !!t?.blockedByMe;
  const status = blocked
    ? ""
    : typing
      ? "typing…"
      : st.link !== "live"
        ? "Status unavailable"
        : presence?.online
          ? "online"
          : presence?.lastSeen
            ? seenText(presence.lastSeen)
            : "Checking status…";
  // the list on screen: day labels, the unread line, and which bubbles are the first / last of a run (they get the rounded corners)
  const items = useMemo(() => {
    const out = [];
    let prevM = null;
    for (const m of t?.msgs ?? []) {
      if (!prevM || !sameDay(prevM.at, m.at)) out.push({ day: m.at });
      if (dividerId != null && m.id === dividerId)
        out.push({ divider: unreadOnOpen.current });
      const joined =
        prevM &&
        out.at(-1)?.m === prevM &&
        prevM.mine === m.mine &&
        new Date(m.at) - new Date(prevM.at) < 4 * 60_000;
      out.push({ m, first: !joined });
      prevM = m;
    }
    out.forEach((x, i) => {
      if (x.m) x.last = !(out[i + 1]?.m && !out[i + 1].first);
    });
    return out;
  }, [t?.msgs, dividerId, t?.msgs?.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ms ms-chat">
      <header className="ms-bar">
        <button
          type="button"
          className="ms-back"
          onClick={onBack}
          aria-label="Back to messages"
        >
          <Icon name="back" size={22} weight="bold" />
        </button>
        <button
          type="button"
          className="ms-who"
          onClick={() => setSheet("profile")}
          aria-label={`${name}, view profile`}
        >
          <Avatar name={name} size={38} online={presence?.online && !blocked} />
          <span>
            <b>{name}</b>
            <small className={typing || presence?.online ? "live" : ""}>
              {status}
            </small>
          </span>
        </button>
        <button
          type="button"
          className="ms-icon"
          onClick={() => setSheet("pay")}
          aria-label={`Send money to ${name}`}
        >
          <Icon name="coins" size={22} />
        </button>
        <span className="ms-menuwrap">
          <button
            type="button"
            className="ms-icon"
            onClick={() => setMenu((v) => !v)}
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menu}
          >
            <Icon name="more" size={22} weight="bold" />
          </button>
          {menu && (
            <>
              <span className="ms-scrim" onClick={() => setMenu(false)} />
              <div className="ms-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  autoFocus
                  onClick={() => {
                    setMenu(false);
                    setSheet("profile");
                  }}
                >
                  <Icon name="person" size={19} />
                  View profile
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setSheet("pay");
                  }}
                >
                  <Icon name="coins" size={19} />
                  Send money
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setSheet("report");
                  }}
                >
                  <Icon name="flag" size={19} />
                  Report
                </button>
                {blocked ? (
                  <button type="button" role="menuitem" onClick={unblock}>
                    <Icon name="block" size={19} />
                    Unblock
                  </button>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    className="bad"
                    onClick={block}
                  >
                    <Icon name="block" size={19} />
                    Block
                  </button>
                )}
              </div>
            </>
          )}
        </span>
      </header>
      {late && <Banner kind={late} />}

      <div
        className="ms-thread"
        ref={scroller}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${name}`}
      >
        {!t || (!t.loaded && !t.msgs.length) ? (
          <Spinner />
        ) : (
          <>
            {t.hasMore && (
              <button
                type="button"
                className="ms-earlier"
                disabled={t.loadingOlder}
                onClick={() => {
                  prevH.current = scroller.current?.scrollHeight ?? 0;
                  chat.loadOlder(name);
                }}
              >
                {t.loadingOlder ? "Loading…" : "Load earlier messages"}
              </button>
            )}
            {!t.msgs.length && (
              <div className="ms-empty">
                <Avatar name={name} size={64} />
                <b>{name}</b>
                <span>No messages yet. Say hi.</span>
              </div>
            )}
            {items.map((x, i) =>
              x.day ? (
                <p key={"d" + i} className="ms-day">
                  {dayLabel(x.day)}
                </p>
              ) : x.divider != null ? (
                <p key={"u" + i} className="ms-unreadline" ref={divEl}>
                  {x.divider === 1
                    ? "1 unread message"
                    : `${x.divider} unread messages`}
                </p>
              ) : (
                <Bubble
                  key={x.m.cid ?? x.m.id}
                  m={x.m}
                  t={t}
                  who={name}
                  first={x.first}
                  last={x.last}
                  onRetry={() => chat.retry(name, x.m.cid)}
                  onDiscard={() => chat.discard(name, x.m.cid)}
                  onActions={() => x.m.id != null && setActionMessage(x.m)}
                  onLocate={locateMessage}
                />
              ),
            )}
          </>
        )}
      </div>
      {below > 0 && (
        <button
          type="button"
          className="ms-jump"
          onClick={() => toBottom(true)}
          aria-label={`${below} new messages, jump to latest`}
        >
          <Icon name="arrowDown" size={16} weight="bold" />
          <span>{below}</span>
        </button>
      )}

      {blocked ? (
        <div className="ms-blocked">
          <span>You blocked {name}.</span>
          <button type="button" onClick={unblock}>
            Unblock
          </button>
        </div>
      ) : (
        <>
        {replying && (
          <div className="ms-replying">
            <button type="button" className="ms-reply-preview" onClick={() => locateMessage(replying.id)}>
              <b>Replying to {replying.mine ? "yourself" : replying.from || name}</b>
              <span>{messagePreview(replying)}</span>
            </button>
            <button type="button" className="ms-icon ms-close" aria-label="Cancel reply" onClick={() => setReplying(null)}>
              <Icon name="close" size={18} weight="bold" />
            </button>
          </div>
        )}
        <div className="ms-compose">
          <textarea
            ref={field}
            rows={1}
            maxLength={500}
            placeholder="Message"
            aria-label={`Message ${name}`}
            value={text}
            onChange={onType}
            onKeyDown={onKey}
            enterKeyHint="send"
          />
          {text.trim() ? (
            <button
              type="button"
              className="ms-send"
              {...PLAIN}
              onClick={send}
              aria-label="Send"
              data-sound="none"
            >
              <Icon name="send" size={20} weight="fill" />
            </button>
          ) : (
            <button
              type="button"
              className="ms-pay"
              {...PLAIN}
              onClick={() => setSheet("pay")}
              aria-label={`Send money to ${name}`}
            >
              <Icon name="coins" size={21} weight="fill" />
            </button>
          )}
        </div>
        </>
      )}

      {actionMessage && (
        <div className="ms-action-scrim" onClick={() => setActionMessage(null)}>
          <section className="ms-action-menu" role="dialog" aria-modal="true" aria-label="Message actions" onClick={(e) => e.stopPropagation()}>
            <div className="ms-action-preview">
              <b>{actionMessage.mine ? "You" : name}</b>
              <span>{messagePreview(actionMessage)}</span>
            </div>
            {!actionMessage.deleted && (
              <button type="button" onClick={() => { setReplying({ ...actionMessage, from: actionMessage.mine ? "You" : name }); setActionMessage(null); field.current?.focus(); }}>
                <Icon name="undo" size={19} /> Reply
              </button>
            )}
            {actionMessage.id != null && (
              <button type="button" disabled={deletingId === actionMessage.id} onClick={() => deleteSelected("me")}>
                <Icon name="trash" size={19} /> Delete for me
              </button>
            )}
            {actionMessage.mine && !actionMessage.deleted && (
              <button type="button" className="bad" disabled={deletingId === actionMessage.id} onClick={() => deleteSelected("everyone")}>
                <Icon name="trash" size={19} /> Delete for everyone
              </button>
            )}
            <button type="button" className="ms-action-cancel" onClick={() => setActionMessage(null)}>Cancel</button>
          </section>
        </div>
      )}

      {sheet && (
        <div className="ph-sheet-scrim" onClick={() => setSheet(null)}>
          <div
            className="ph-sheet ms-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={
              { pay: "Send money", report: "Report", profile: "Profile" }[sheet]
            }
            onClick={(e) => e.stopPropagation()}
          >
            <span className="ph-grab" aria-hidden="true" />
            {sheet === "profile" && (
              <Profile
                prof={prof}
                blocked={blocked}
                onPay={() => setSheet("pay")}
                onReport={() => setSheet("report")}
                onBlock={block}
                onUnblock={() => {
                  unblock();
                  setSheet(null);
                }}
              />
            )}
            {sheet === "pay" && (
              <Pay
                name={name}
                g={g}
                draft={payDraft}
                setDraft={setPayDraft}
                close={() => setSheet(null)}
                onSent={() => {
                  stick.current = true;
                }}
                router={router}
                reopen={() => setSheet("pay")}
              />
            )}
            {sheet === "report" && (
              <Report
                name={name}
                draft={reportDraft}
                setDraft={setReportDraft}
                onSubmit={sendReport}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- one message ---------- */
function messagePreview(message) {
  if (!message || message.unavailable) return "Original message unavailable";
  if (message.deleted) return "This message was deleted";
  if (message.kind === KIND.MONEY) {
    const money = parseMoney(message.body);
    return `Sent ${fmt(money.naira)}${money.note ? ` · ${money.note}` : ""}`;
  }
  return message.body || "Message";
}

function QuotePreview({ reply, onLocate }) {
  if (!reply) return null;
  return (
    <button
      type="button"
      className={"ms-quote" + (reply.unavailable ? " unavailable" : "")}
      disabled={reply.unavailable}
      onClick={() => onLocate(reply.id)}
      aria-label={reply.unavailable ? "Original message unavailable" : `Find message from ${reply.mine ? "you" : reply.from}`}
    >
      <b>{reply.mine ? "You" : reply.from || "Message"}</b>
      <span>{messagePreview(reply)}</span>
    </button>
  );
}

function Bubble({ m, t, who, first, last, onRetry, onDiscard, onActions, onLocate }) {
  const state = m.mine ? chat.tickOf(m, t) : null;
  const money = !m.deleted && m.kind === KIND.MONEY ? parseMoney(m.body) : null;
  const cls =
    "ms-row" +
    (m.mine ? " mine" : "") +
    (first ? " first" : "") +
    (last ? " last" : "");
  if (money) {
    return (
      <div className={cls} id={m.id != null ? `ms-message-${m.id}` : undefined}>
        <article
          className="ms-money"
          aria-label={`${m.mine ? "You sent" : who + " sent you"} ${fmt(money.naira)}`}
        >
          <QuotePreview reply={m.reply} onLocate={onLocate} />
          <span className="ms-coin" aria-hidden="true">
            <Icon name="coins" size={18} weight="fill" />
          </span>
          <span className="ms-money-who">
            {m.mine ? "You sent" : `${who} sent you`}
          </span>
          <b className="ms-money-amt num">{fmt(money.naira)}</b>
          {money.note && <span className="ms-money-note">{money.note}</span>}
          <span className="ms-meta">
            <time>{hm(m.at)}</time>
            {state && <Ticks state={state} />}
          </span>
        </article>
        {m.id != null && (
          <button type="button" className="ms-message-action" aria-label={`Actions for message from ${m.mine ? "you" : who}`} onClick={onActions}>
            <Icon name="more" size={18} weight="bold" />
          </button>
        )}
        {state === "failed" && (
          <FailedBar onRetry={onRetry} onDiscard={onDiscard} err={m.err} />
        )}
      </div>
    );
  }
  return (
    <div className={cls} id={m.id != null ? `ms-message-${m.id}` : undefined}>
      <p className={"ms-bub" + (m.st === "sending" ? " pending" : "") + (m.deleted ? " deleted" : "")}>
        <QuotePreview reply={m.reply} onLocate={onLocate} />
        <span className="ms-text">{m.body}</span>
        <span className="ms-meta">
          <time>{hm(m.at)}</time>
          {state && <Ticks state={state} />}
        </span>
      </p>
      {m.id != null && (
        <button type="button" className="ms-message-action" aria-label={`Actions for message from ${m.mine ? "you" : who}`} onClick={onActions}>
          <Icon name="more" size={18} weight="bold" />
        </button>
      )}
      {state === "failed" && (
        <FailedBar onRetry={onRetry} onDiscard={onDiscard} err={m.err} />
      )}
    </div>
  );
}
const FailedBar = ({ onRetry, onDiscard, err }) => (
  <span className="ms-failed" role="alert">
    {err || "Not sent."}
    <button type="button" onClick={onRetry}>
      Try again
    </button>
    <button type="button" onClick={onDiscard}>
      Delete
    </button>
  </span>
);

/* ---------- sheets ---------- */
function Profile({ prof, blocked, onPay, onReport, onBlock, onUnblock }) {
  if (!prof) return <Spinner />;
  return (
    <div className="ms-body ms-body--solo">
      <div className="ms-prof">
        <Avatar name={prof.name} size={72} />
        <h3>{prof.name}</h3>
        <p className="mut">
          {prof.faculty}, {prof.level}L, {prof.class}
        </p>
        {prof.office && <p className="ms-tags"><span>{prof.office}</span></p>}
        {prof.personalities?.length > 0 && (
          <p className="ms-tags">
            {prof.personalities.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </p>
        )}
      </div>
      {/* <dl className="ms-facts">
        <div><dt>CGPA</dt><dd className="num">{prof.cgpa ?? "–"}</dd></div>
        <div><dt>Net worth</dt><dd className="num">{nairaOf(prof.netWorthKobo)}</dd></div>
        <div><dt>Popularity</dt><dd className="num">{prof.popularity}</dd></div>
      </dl> */}
      {/* {prof.graduated && <p className="ms-note">Graduated with {prof.classification}</p>}
      {prof.achievements?.length > 0 && <p className="ms-tags">{prof.achievements.map((a) => <span key={a}>{a}</span>)}</p>} */}
      <div className="ms-actions">
        <button type="button" className="go" onClick={onPay}>
          Send money
        </button>
        <button type="button" onClick={onReport}>
          <Icon name="flag" size={18} />
          Report
        </button>
        {blocked ? (
          <button type="button" onClick={onUnblock}>
            <Icon name="block" size={18} />
            Unblock
          </button>
        ) : (
          <button type="button" className="bad" onClick={onBlock}>
            <Icon name="block" size={18} />
            Block
          </button>
        )}
      </div>
    </div>
  );
}

const QUICK = [1000, 5000, 10000, 50000];
function Pay({ name, g, draft, setDraft, close, onSent, router, reopen }) {
  const { amt, note } = draft,
    n = Number(amt) || 0,
    fee = n >= 100 ? Math.floor(n * 0.02) : 0;
  const valid = Number.isInteger(n) && n >= 100 && n <= 5_000_000;
  const short = valid && !canAfford(BigInt(n + fee) * 100n);
  const err =
    n > 5_000_000
      ? "The most you can send is ₦5,000,000 at a time."
      : n > 0 && n < 100
        ? "The least you can send is ₦100."
        : short
          ? "You do not have enough cash. The 2% fee is added on top."
          : "";
  async function submit(e) {
    e.preventDefault();
    if (!valid || short) return;
    const memo = note,
      cid = crypto.randomUUID(),
      kobo = BigInt(n) * 100n,
      feeKobo = (kobo * 2n) / 100n;
    chat.addMoney(name, { naira: n, note: memo, cid }); // the card is in the chat before anything is sent
    setDraft({ amt: "", note: "" });
    onSent();
    close();
    const r = await run({
      key: `pay:${cid}`,
      router,
      sensitive: true,
      pending: `Sending ${nairaOf(kobo.toString())} to ${name}…`, // the card above is already in the chat with a clock; "Sent" is only said once the server has moved the money
      ok: `Sent ${nairaOf(kobo.toString())} to ${name}. Fee ${nairaOf(feeKobo.toString())}.`,
      sound: "coin",
      request: () =>
        call("/api/transfer", {
          to: name,
          amountNaira: n,
          memo,
          requestId: cid,
        }),
      effects: [{ store: game, patch: cash(-(kobo + feeKobo)) }],
    });
    if (r.failed) {
      chat.moneyFailed(name, cid);
      if (!r.skipped && !r.aborted) {
        setDraft({ amt: String(n), note: memo });
        reopen();
      }
    } else chat.moneySent(name, cid, r.msg); // also for "duplicate": the money WAS sent (an earlier try got through), so the card stays
  }
  return (
    <form onSubmit={submit} className="ms-form">
      <div className="ms-body">
        <h3>Send money to {name}</h3>
        <label className="ms-amt">
          <span className="ms-amt-label">Amount</span>
          <span className="ms-amt-field">
            <span aria-hidden="true">₦</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              value={amt ? n.toLocaleString("en-NG") : ""}
              onChange={(e) =>
                setDraft({
                  amt: e.target.value.replace(/\D/g, "").slice(0, 7),
                  note,
                })
              }
              autoFocus
              aria-invalid={!!err}
              aria-describedby="ms-amt-err"
            />
          </span>
        </label>
        <div className="ms-quick" role="group" aria-label="Quick amounts">
          {QUICK.map((q) => (
            <button
              type="button"
              key={q}
              onClick={() => setDraft({ amt: String(q), note })}
            >
              ₦{q / 1000}k
            </button>
          ))}
        </div>
        <p id="ms-amt-err" className="ms-err" role="alert">
          {err}
        </p>
        <label>
          Note <span className="mut">(optional)</span>
          <input
            type="text"
            maxLength={80}
            placeholder="What is it for?"
            value={note}
            onChange={(e) => setDraft({ amt, note: e.target.value })}
          />
        </label>
        <dl className="ms-sum">
          <div>
            <dt>Fee (2%)</dt>
            <dd className="num">{fee ? fmt(fee) : "–"}</dd>
          </div>
          <div>
            <dt>You pay</dt>
            <dd className="num">{valid ? fmt(n + fee) : "–"}</dd>
          </div>
          {g && (
            <div>
              <dt>Your cash</dt>
              <dd className="num">{nairaOf(g.balanceKobo)}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="ms-foot">
        <button className="go ms-gobtn" disabled={!valid || short}>
          Send {valid ? fmt(n) : "money"}
        </button>
        <p className="mut ms-limits">
          ₦100 to ₦5,000,000 per transfer. Wait 1 minute between successful transfers.
        </p>
      </div>
    </form>
  );
}

const REASONS = [
  "Harassment or bullying",
  "Scam or fraud",
  "Spam",
  "Inappropriate content",
  "Something else",
];
function Report({ name, onSubmit, draft, setDraft }) {
  const { why, more, alsoBlock } = draft,
    setWhy = (v) => setDraft((d) => ({ ...d, why: v })),
    setMore = (v) => setDraft((d) => ({ ...d, more: v })),
    setAlsoBlock = (v) => setDraft((d) => ({ ...d, alsoBlock: v }));
  const ready = why && (why !== "Something else" || more.trim().length >= 5);
  return (
    <form
      className="ms-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready)
          onSubmit(more.trim() ? `${why}: ${more.trim()}` : why, alsoBlock);
      }}
    >
      <div className="ms-body">
        <h3>Report {name}</h3>
        <p className="mut">
          Our team will read your last messages with them to review this. They
          are not told you reported them.
        </p>
        <div
          className="ms-reasons"
          role="radiogroup"
          aria-label="What happened?"
        >
          {REASONS.map((r) => (
            <button
              type="button"
              role="radio"
              aria-checked={why === r}
              key={r}
              className={why === r ? "on" : ""}
              onClick={() => setWhy(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <label>
          Anything else we should know{" "}
          <span className="mut">
            {why === "Something else" ? "(required)" : "(optional)"}
          </span>
          <textarea
            rows={2}
            maxLength={250}
            value={more}
            onChange={(e) => setMore(e.target.value)}
            placeholder="Describe what happened"
          />
        </label>
        <label className="ms-check">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(e) => setAlsoBlock(e.target.checked)}
          />
          Also block {name}
        </label>
      </div>
      <div className="ms-foot">
        <button className="go ms-gobtn" disabled={!ready}>
          Send report
        </button>
      </div>
    </form>
  );
}

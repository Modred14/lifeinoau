// components/apps/GroupConversation.js: a group chat inside the Messages app, laid out like a private chat (header, wallpaper, bubbles, composer),
// with each sender's name on their messages. It uses the same routes as the Groups app; the server decides who may read, post and delete
// (lib/groupChat.js). Group posts are not pushed by the chat connection, so the open chat refreshes every few seconds.
"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { call, notifyError } from "@/lib/client";
import { confirmAction } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import { Spinner } from "../Loader";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import { useLive } from "./sugKit";

export const groupPath = (g) => (g.kind === "faculty" ? "/api/faculty-groups/messages" : `/api/groups/${g.id}/messages`);
const NAME_COLOURS = ["#1f6feb", "#b4235a", "#0f766e", "#9a4d00", "#6d28d9", "#15803d"];
const colourOf = (name) => NAME_COLOURS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % NAME_COLOURS.length];

export function GroupAvatar({ group, size = 44 }) {
  return (
    <span className="ms-gav" data-kind={group.kind} style={{ width: size, height: size }} aria-hidden="true">
      <Icon name={group.kind === "faculty" ? "faculty" : "person"} size={Math.round(size * 0.5)} weight="fill" />
    </span>
  );
}

/** time: the Messages app's own clock formatting { hm, sameDay, dayLabel } (game time). */
export default function GroupConversation({ group, time, onBack, onInfo }) {
  const path = groupPath(group), { d, load, loadFailed } = useLive(path, 5000);
  const [text, setText] = useState(""), [pending, setPending] = useState(null), [older, setOlder] = useState({ rows: [], more: null }), [loadingOlder, setLoadingOlder] = useState(false), [picked, setPicked] = useState(null);
  const scroller = useRef(null), stick = useRef(true), fromBottom = useRef(null), sending = useRef(false);
  const newest = d?.messages ?? [], rows = [...older.rows.filter((m) => !newest.some((n) => n.id === m.id)), ...newest].sort((a, b) => a.id - b.id);
  const hasMore = older.more ?? d?.hasMore;
  // stay at the latest message unless the player scrolled up; keep their place when earlier messages are added above
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    if (fromBottom.current != null) { el.scrollTop = el.scrollHeight - fromBottom.current; fromBottom.current = null; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, rows[rows.length - 1]?.id, !!pending]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (picked != null && !rows.some((m) => m.id === picked.id)) setPicked(null); }, [rows, picked]);

  async function send() {
    const body = text.trim();
    if (!body || sending.current) return;
    sending.current = true; stick.current = true; setPending(body); setText("");
    const r = await call(path, { body });
    if (r.failed) { setText((t) => t || body); notifyError(r, "Your message was not sent."); }
    else await load();
    setPending(null); sending.current = false;
  }
  const onKey = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !window.matchMedia?.("(pointer: coarse)").matches) { e.preventDefault(); send(); } };
  async function showOlder() {
    if (loadingOlder || !rows.length) return;
    setLoadingOlder(true);
    const r = await call(`${path}?before=${rows[0].id}`);
    setLoadingOlder(false);
    if (r.failed) return notifyError(r);
    const el = scroller.current; fromBottom.current = el ? el.scrollHeight - el.scrollTop : null;
    setOlder({ rows: [...r.messages, ...rows], more: r.hasMore });
  }
  async function remove(m) {
    setPicked(null);
    if (!(await confirmAction({ title: "Delete this message?", message: "It is removed for everyone in the group.", confirmLabel: "Delete", tone: "danger" }))) return;
    const r = await call(path, { action: "delete", id: m.id });
    if (r.failed) return notifyError(r);
    setOlder((o) => ({ ...o, rows: o.rows.map((x) => (x.id === m.id ? { ...x, deleted: true, canDelete: false, body: "This message was deleted" } : x)) }));
    load();
  }

  return (
    <div className="ms">
      <header className="ms-bar">
        <button type="button" className="ms-back" onClick={onBack} aria-label="Back to chats"><Icon name="back" size={24} weight="bold" /></button>
        <button type="button" className="ms-who" onClick={onInfo} aria-label={`${group.name}, group info`}>
          <GroupAvatar group={group} size={40} />
          <span><b>{group.name}</b><small>{group.kind === "faculty" ? "Your official faculty group" : "Group"} · tap for info</small></span>
        </button>
      </header>
      <div className="ms-thread" ref={scroller} role="log" aria-live="polite" aria-label={`Group chat ${group.name}`}
        onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        {loadFailed && !d ? <LoadError title="This group chat didn't load" onRetry={load} /> : !d ? <Spinner /> : (
          <>
            {hasMore && <button type="button" className="ms-earlier" disabled={loadingOlder} onClick={showOlder}>{loadingOlder ? "Loading…" : "Load earlier messages"}</button>}
            {!rows.length && !pending && <div className="ms-empty"><GroupAvatar group={group} size={64} /><b>{group.name}</b><span>No messages yet. Say hello.</span></div>}
            {rows.map((m, i) => {
              const before = rows[i - 1], after = rows[i + 1], newDay = !before || !time.sameDay(before.at, m.at);
              const first = newDay || before.from !== m.from, last = !after || after.from !== m.from || !time.sameDay(m.at, after.at);
              const act = m.canDelete ? { role: "button", tabIndex: 0, onClick: () => setPicked(m), onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(m); } } } : {};
              return (
                <div key={m.id} className="ms-group-item">
                  {newDay && <p className="ms-day">{time.dayLabel(m.at)}</p>}
                  <div className={"ms-row" + (m.mine ? " mine" : " theirs") + (first ? " first" : "") + (last ? " last" : "")}>
                    {!m.mine && last && <PlayerAvatar name={m.from} size={28} className="ms-av ms-gsender" />}
                    <p className={"ms-bub" + (m.deleted ? " deleted" : "")} {...act}>
                      {!m.mine && first && <b className="ms-gname" style={{ color: colourOf(m.from) }}>{m.from}</b>}
                      <span className="ms-text">{m.body}</span>
                      <span className="ms-meta"><time>{time.hm(m.at)}</time></span>
                    </p>
                  </div>
                </div>
              );
            })}
            {pending && <div className="ms-row mine first last"><p className="ms-bub pending"><span className="ms-text">{pending}</span><span className="ms-meta">Sending…</span></p></div>}
          </>
        )}
      </div>
      <div className="ms-compose">
        <textarea rows={1} maxLength={1000} placeholder="Message" aria-label={`Message ${group.name}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} enterKeyHint="send" />
        <button type="button" className="ms-send" onPointerDown={(e) => e.preventDefault()} onClick={send} disabled={!text.trim() || !!pending} aria-label="Send" data-sound="none"><Icon name="send" size={20} weight="fill" /></button>
      </div>
      {picked && (
        <div className="ms-action-scrim" onClick={() => setPicked(null)}>
          <section className="ms-action-menu" role="dialog" aria-modal="true" aria-label="Message actions" onClick={(e) => e.stopPropagation()}>
            <div className="ms-action-preview"><b>{picked.mine ? "You" : picked.from}</b><span>{picked.body}</span></div>
            <button type="button" className="bad" onClick={() => remove(picked)}><Icon name="trash" size={19} /> Delete for everyone</button>
            <button type="button" className="ms-action-cancel" onClick={() => setPicked(null)}>Cancel</button>
          </section>
        </div>
      )}
    </div>
  );
}

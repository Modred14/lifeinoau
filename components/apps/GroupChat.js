// components/apps/GroupChat.js: the discussion of a group (faculty or custom). It shows what the server returns and sends one request per tap;
// who may read, post or delete is decided by the server (lib/groupChat.js). It refreshes while open, like the rest of the Groups app.
"use client";
import { useRef, useState } from "react";
import { call, notifyError } from "@/lib/client";
import { confirmAction } from "@/lib/confirm";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import { useLive, when, Empty } from "./sugKit";

export default function GroupChat({ path, onChanged }) {
  const { d, load, loadFailed } = useLive(path, 8000);
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [older, setOlder] = useState({ for: path, rows: [], more: null });
  const sending = useRef(false);
  const extra = older.for === path ? older : { rows: [], more: null };
  if (loadFailed) return <LoadError title="The discussion didn't load" onRetry={load} />;
  if (!d) return <Loader />;
  const newest = d.messages ?? [], rows = [...extra.rows.filter((m) => !newest.some((n) => n.id === m.id)), ...newest].sort((a, b) => a.id - b.id);
  const hasMore = extra.more ?? d.hasMore;

  async function send(e) {
    e.preventDefault();
    if (sending.current || !text.trim()) return;
    sending.current = true; setBusy(true);
    const r = await call(path, { body: text });
    sending.current = false; setBusy(false);
    if (r.failed) return notifyError(r, "Your message was not sent.");
    setText(""); await load(); onChanged?.();
  }
  async function showOlder() {
    if (busy || !rows.length) return;
    setBusy(true);
    const r = await call(`${path}?before=${rows[0].id}`);
    setBusy(false);
    if (r.failed) return notifyError(r);
    setOlder({ for: path, rows: [...r.messages, ...rows], more: r.hasMore });
  }
  async function remove(m) {
    if (!(await confirmAction({ title: "Delete this message?", message: "It is removed for everyone in the group.", confirmLabel: "Delete", tone: "danger" }))) return;
    const r = await call(path, { action: "delete", id: m.id });
    if (r.failed) return notifyError(r);
    setOlder((o) => ({ ...o, rows: o.rows.map((x) => (x.id === m.id ? { ...x, deleted: true, canDelete: false, body: "This message was deleted" } : x)) }));
    load();
  }
  return (
    <div className="fg-stack">
      {hasMore ? <button type="button" className="sg-link" onClick={showOlder} disabled={busy}>Show earlier messages</button> : null}
      {rows.length ? (
        <ol className="gr-chat" aria-label="Group messages" aria-live="polite">
          {rows.map((m) => (
            <li key={m.id} data-mine={m.mine ? "1" : undefined} data-deleted={m.deleted ? "1" : undefined}>
              {m.mine ? null : <PlayerAvatar name={m.from} size={32} />}
              <div className="gr-bubble">
                {m.mine ? null : <b>{m.from}</b>}
                <p>{m.body}</p>
                <small>{when(m.at)}</small>
              </div>
              {m.canDelete ? <button type="button" className="gr-del" onClick={() => remove(m)} aria-label={`Delete message from ${m.mine ? "you" : m.from}`}><Icon name="trash" size={15} /></button> : null}
            </li>
          ))}
        </ol>
      ) : <Empty>No messages yet. Say hello.</Empty>}
      <form className="gr-compose" onSubmit={send}>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Message the group" aria-label="Message the group" autoComplete="off" />
        <button type="submit" className="go" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} weight="fill" /></button>
      </form>
    </div>
  );
}

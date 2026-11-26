// components/apps/CustomGroups.js: player-made groups inside the Groups app: My Groups, Discover, creating one, and a group's own screens.
// Buttons are shown according to what the server says this player may do (`can`); the server checks every action again (lib/customGroupService.js).
"use client";
import { useEffect, useState } from "react";
import { call, notifyError } from "@/lib/client";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import { LIMITS } from "@/lib/customGroupRules.js";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import GroupChat from "./GroupChat";
import { useLive, Note, Empty, Section } from "./sugKit";

const members = (n) => `${n} ${n === 1 ? "member" : "members"}`;
const privacyText = (p) => (p === "PRIVATE" ? "Private" : "Public");
const ROLE_NAME = { OWNER: "Owner", ADMIN: "Administrator", MEMBER: "Member" };

/** One request at a time: returns [busy, run(path, body, okMessage)]. */
function useAction() {
  const [busy, setBusy] = useState(false);
  async function run(path, body, ok) {
    if (busy) return null;
    setBusy(true);
    const r = await call(path, body);
    setBusy(false);
    if (r.failed) { notifyError(r); return null; }
    if (ok) toast.success(typeof ok === "function" ? ok(r) : ok);
    return r;
  }
  return [busy, run];
}

function GroupRow({ g, onOpen, aside }) {
  return (
    <button type="button" className="fg-person" onClick={() => onOpen(g.id)}>
      <span className="gr-emblem" aria-hidden="true">{g.name.slice(0, 1).toUpperCase()}</span>
      <span className="fg-who">
        <b>{g.name}</b>
        <small>{[privacyText(g.privacy), members(g.memberCount), g.role && g.role !== "MEMBER" ? ROLE_NAME[g.role] : null].filter(Boolean).join(" · ")}</small>
      </span>
      {aside ?? (g.unread ? <i className="fg-unread" aria-label={`${g.unread} unread`}>{g.unread > 9 ? "9+" : g.unread}</i> : <Icon name="next" size={18} />)}
    </button>
  );
}

function Fields({ name, setName, description, setDescription, privacy, setPrivacy }) {
  return (
    <>
      <label>Group name<input type="text" value={name} onChange={(e) => setName(e.target.value)} minLength={LIMITS.nameMin} maxLength={LIMITS.nameMax} required autoComplete="off" /></label>
      <label>Description (optional)<input type="text" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.descMax} autoComplete="off" /></label>
      {setPrivacy ? (
        <label>Who can join
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}>
            <option value="PUBLIC">Public: anyone can join</option>
            <option value="PRIVATE">Private: invitation or approval</option>
          </select>
        </label>
      ) : null}
    </>
  );
}

function Create({ onBack, onCreated }) {
  const [name, setName] = useState(""), [description, setDescription] = useState(""), [privacy, setPrivacy] = useState("PUBLIC"), [busy, run] = useAction();
  async function submit(e) {
    e.preventDefault();
    const r = await run("/api/groups", { name, description, privacy }, "Your group is ready. You are its owner.");
    if (r) onCreated(r.id);
  }
  return (
    <div className="fg-stack">
      <button type="button" className="sg-back sg-link" onClick={onBack}><Icon name="left" size={18} /> My groups</button>
      <Section title="Create a group">
        <form className="gr-form" onSubmit={submit}>
          <Fields {...{ name, setName, description, setDescription, privacy, setPrivacy }} />
          <button type="submit" className="go sg-cta" disabled={busy || name.trim().length < LIMITS.nameMin}>{busy ? "Creating…" : "Create group"}</button>
        </form>
      </Section>
    </div>
  );
}

export function MyGroups({ onOpen, onCreate }) {
  const { d, load, loadFailed } = useLive("/api/groups", 15000);
  if (loadFailed) return <LoadError title="Your groups didn't load" onRetry={load} />;
  if (!d) return <Loader />;
  const full = d.limits.owned >= d.limits.maxOwned;
  return (
    <div className="fg-stack">
      <button type="button" className="go sg-cta" onClick={onCreate} disabled={full}><Icon name="plus" size={18} /> Create group</button>
      {full ? <p className="sg-hint">You own {d.limits.maxOwned} groups, which is the most one player can own.</p> : null}
      {d.invites.length ? (
        <Section title="Invitations">
          <div className="fg-list">{d.invites.map((g) => <GroupRow key={g.id} g={g} onOpen={onOpen} aside={<span className="sg-pill" data-s="TODO">Invited</span>} />)}</div>
        </Section>
      ) : null}
      <div className="fg-list">{d.groups.map((g) => <GroupRow key={g.id} g={g} onOpen={onOpen} />)}</div>
      {d.groups.length ? null : <Empty>You are not in any custom group yet. Create one, or look in Discover.</Empty>}
    </div>
  );
}

export function Discover({ onOpen }) {
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [more, setMore] = useState({ for: "", rows: [], done: false }), [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const path = `/api/groups?view=discover&q=${encodeURIComponent(dq)}`;
  const { d, load, loadFailed } = useLive(path, 30000);
  const extra = more.for === dq ? more : { rows: [], done: false };
  const first = d?.groups ?? [], rows = [...first, ...extra.rows.filter((r) => !first.some((f) => f.id === r.id))];
  const hasMore = d && !extra.done && (extra.rows.length ? more.hasMore : d.hasMore);
  async function showMore() {
    if (busy) return; setBusy(true);
    const r = await call(`${path}&offset=${rows.length}`); setBusy(false);
    if (r.failed) return notifyError(r);
    setMore({ for: dq, rows: [...extra.rows, ...r.groups], hasMore: r.hasMore, done: !r.groups.length });
  }
  if (loadFailed) return <LoadError title="Groups didn't load" onRetry={load} />;
  return (
    <div className="fg-stack">
      <label className="fg-search">
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a group" maxLength={40} aria-label="Find a group" autoComplete="off" />
        {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search"><Icon name="close" size={16} /></button> : null}
      </label>
      {!d ? <Loader /> : null}
      <div className="fg-list">{rows.map((g) => <GroupRow key={g.id} g={g} onOpen={onOpen} aside={g.status ? <span className="sg-pill" data-s="TODO">{g.status === "INVITED" ? "Invited" : "Requested"}</span> : null} />)}</div>
      {d && !rows.length ? <Empty>{dq ? "No group matches that name." : "There are no other groups to join yet."}</Empty> : null}
      {hasMore ? <button type="button" className="sg-link" onClick={showMore} disabled={busy}>{busy ? "Loading…" : "Show more"}</button> : null}
    </div>
  );
}

function Members({ d, q, setQ, busy, act }) {
  const [invite, setInvite] = useState("");
  const owner = d.can.changeRoles;
  async function send(e) {
    e.preventDefault();
    if (await act({ action: "invite", name: invite }, (r) => (r.joined ? `${r.name} had asked to join and is now a member.` : `Invitation sent to ${r.name}.`))) setInvite("");
  }
  async function ask(title, message, confirmLabel, body, ok) {
    if (await confirmAction({ title, message, confirmLabel, tone: "danger" })) await act(body, ok);
  }
  return (
    <div className="fg-stack">
      {d.can.invite ? (
        <Section title="Invite a player">
          <form className="gr-compose" onSubmit={send}>
            <input type="text" value={invite} onChange={(e) => setInvite(e.target.value)} maxLength={40} placeholder="Character name" aria-label="Character name to invite" autoComplete="off" />
            <button type="submit" className="go" disabled={busy || !invite.trim()}>Invite</button>
          </form>
        </Section>
      ) : null}
      {d.requests.length ? (
        <Section title="Asking to join">
          {d.requests.map((p) => (
            <div className="gr-member" key={p.name}>
              <PlayerAvatar name={p.name} size={40} /><span className="fg-who"><b>{p.name}</b><small>{p.level}L</small></span>
              <div className="gr-acts"><button type="button" className="go" disabled={busy} onClick={() => act({ action: "approve", name: p.name }, `${p.name} joined.`)}>Approve</button><button type="button" disabled={busy} onClick={() => act({ action: "reject", name: p.name })}>Decline</button></div>
            </div>
          ))}
        </Section>
      ) : null}
      {d.invited.length ? (
        <Section title="Invitations sent">
          {d.invited.map((p) => (
            <div className="gr-member" key={p.name}>
              <PlayerAvatar name={p.name} size={40} /><span className="fg-who"><b>{p.name}</b><small>Waiting for an answer</small></span>
              <div className="gr-acts"><button type="button" disabled={busy} onClick={() => act({ action: "reject", name: p.name })}>Cancel</button></div>
            </div>
          ))}
        </Section>
      ) : null}
      <label className="fg-search">
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" maxLength={30} aria-label="Search members of this group" autoComplete="off" />
      </label>
      <div className="fg-list">
        {d.members.map((p) => (
          <div className="gr-member" key={p.name}>
            <PlayerAvatar name={p.name} size={40} />
            <span className="fg-who"><b>{p.name}{p.isMe ? " (you)" : ""}</b><small>{p.level}L · {ROLE_NAME[p.role]}</small></span>
            {!p.isMe && (owner || p.canRemove) ? (
              <div className="gr-acts">
                {owner ? <button type="button" disabled={busy} onClick={() => act({ action: "role", name: p.name, role: p.role === "ADMIN" ? "MEMBER" : "ADMIN" })}>{p.role === "ADMIN" ? "Remove admin" : "Make admin"}</button> : null}
                {owner ? <button type="button" disabled={busy} onClick={() => ask(`Make ${p.name} the owner?`, "You become an administrator and cannot take this back yourself.", "Make owner", { action: "transfer", name: p.name }, `${p.name} now owns the group.`)}>Make owner</button> : null}
                {p.canRemove ? <button type="button" disabled={busy} onClick={() => ask(`Remove ${p.name}?`, "They cannot rejoin unless an administrator invites them.", "Remove", { action: "remove", name: p.name }, `${p.name} was removed.`)}>Remove</button> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {d.members.length ? null : <Empty>Nobody matches that name.</Empty>}
      {d.hasMore ? <p className="sg-hint">Showing the first {d.members.length} members. Search by name to find others.</p> : null}
    </div>
  );
}

function Manage({ d, busy, act, onGone }) {
  const [name, setName] = useState(d.group.name), [description, setDescription] = useState(d.group.description), [privacy, setPrivacy] = useState(d.group.privacy);
  const alone = d.group.memberCount <= 1, ownerMustHandOver = d.role === "OWNER" && !alone;
  async function save(e) {
    e.preventDefault();
    await act({ action: "update", name, description, ...(d.can.changePrivacy ? { privacy } : {}) }, "Group saved.");
  }
  async function end(action, title, message, label) {
    if (!(await confirmAction({ title, message, confirmLabel: label, tone: "danger" }))) return;
    const r = await act({ action }, action === "delete" ? "Group deleted." : "You left the group.", false);
    if (r) onGone();
  }
  return (
    <div className="fg-stack">
      {d.can.edit ? (
        <Section title="Group details">
          <form className="gr-form" onSubmit={save}>
            <Fields {...{ name, setName, description, setDescription, privacy }} setPrivacy={d.can.changePrivacy ? setPrivacy : null} />
            <button type="submit" className="go" disabled={busy}>Save changes</button>
          </form>
        </Section>
      ) : null}
      <Section title="Membership">
        {ownerMustHandOver ? <p className="sg-hint">To leave, first make another member the owner (Members tab).</p> : null}
        <button type="button" disabled={busy || ownerMustHandOver} onClick={() => end("leave", `Leave ${d.group.name}?`, d.role === "OWNER" ? "You are the only member, so the group and its messages are deleted." : "You stop seeing its discussion.", "Leave")}><Icon name="logout" size={18} /> Leave group</button>
        {d.can.destroy ? <button type="button" className="danger" disabled={busy} onClick={() => end("delete", `Delete ${d.group.name}?`, "The group, its members list and its messages are removed for everyone. This cannot be undone.", "Delete")}><Icon name="trash" size={18} /> Delete group</button> : null}
      </Section>
    </div>
  );
}

function GroupScreen({ id, onBack }) {
  const [tab, setTab] = useState("chat"), [q, setQ] = useState(""), [dq, setDq] = useState(""), [busy, run] = useAction();
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const path = `/api/groups/${id}`, { d: live, load, loadFailed } = useLive(`${path}?q=${encodeURIComponent(dq)}`, 15000);
  const [last, setLast] = useState(null);
  useEffect(() => { if (live) setLast(live); }, [live]);
  const d = live ?? last; // a new search keeps the screen (and the search box) while its answer is on the way
  const back = <button type="button" className="sg-back sg-link" onClick={onBack}><Icon name="left" size={18} /> All groups</button>;
  if (loadFailed) return <div className="fg-stack">{back}<LoadError title="This group didn't load" message="It may have been deleted." onRetry={load} /></div>;
  if (!d) return <Loader />;
  /** Runs an action and re-reads the group (unless the group is about to be left). */
  async function act(body, ok, reread = true) { const r = await run(path, body, ok); if (r && reread && !r.deleted) await load(); return r; }
  const g = d.group, activeTab = d.members === null ? "chat" : tab;
  return (
    <div className="fg-stack">
      {back}
      <div className="fg-hero gr-hero">
        <small>{privacyText(g.privacy)} group{d.role ? ` · You are ${d.role === "MEMBER" ? "a member" : d.role === "OWNER" ? "the owner" : "an administrator"}` : ""}</small>
        <h2>{g.name}</h2>
        {g.description ? <p>{g.description}</p> : null}
        <p>{members(g.memberCount)}</p>
      </div>
      {!d.role ? (
        <>
          {d.status === "REMOVED" ? <Note tone="warn" title="You were removed from this group">An administrator can invite you back.</Note>
            : d.status === "REQUESTED" ? <><Note title="Request sent">An administrator has to approve it.</Note><button type="button" disabled={busy} onClick={() => act({ action: "decline" }, "Request withdrawn.")}>Withdraw request</button></>
            : <>
                <button type="button" className="go sg-cta" disabled={busy} onClick={() => act({ action: "join" }, (r) => (r.requested ? "Request sent." : "You joined the group."))}>{d.status === "INVITED" ? "Accept invitation" : g.privacy === "PUBLIC" ? "Join group" : "Ask to join"}</button>
                {d.status === "INVITED" ? <button type="button" disabled={busy} onClick={() => act({ action: "decline" }, "Invitation declined.")}>Decline</button> : null}
              </>}
          {d.members ? (
            <Section title="Members">
              {d.members.map((p) => <div className="gr-member" key={p.name}><PlayerAvatar name={p.name} size={40} /><span className="fg-who"><b>{p.name}</b><small>{p.level}L · {ROLE_NAME[p.role]}</small></span></div>)}
            </Section>
          ) : <p className="sg-hint">Members and messages are visible after you join.</p>}
        </>
      ) : (
        <>
          <div role="tablist" aria-label="Group">
            {[["chat", "Chat"], ["members", `Members${d.requests.length ? ` (${d.requests.length})` : ""}`], ["manage", d.can.edit ? "Manage" : "Options"]].map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={activeTab === k} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {activeTab === "chat" ? <GroupChat path={`${path}/messages`} />
            : activeTab === "members" ? <Members d={d} q={q} setQ={setQ} busy={busy} act={act} />
            : <Manage d={d} busy={busy} act={act} onGone={onBack} />}
        </>
      )}
    </div>
  );
}

export { Create, GroupScreen };

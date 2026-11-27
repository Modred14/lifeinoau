// components/apps/FacultyApp.js: the Groups app. "My Faculty" is the official faculty group; "My Groups" and "Discover" are player-made groups
// (components/apps/CustomGroups.js). Faculty Groups: your faculty's community inside the phone: the group, its members, a colleague's profile
// (with a Message button), and the faculty elections. Like every app here it only SHOWS what the server says and sends one request per tap:
// who is in the group, who may vote and who wins are decided by lib/facultyGroupService.js and lib/facultyElectionService.js.
// Private messages open the real Messages app (components/apps/MessagesApp.js): one chat system, with its history, unread counts and live delivery.
"use client";
import { useEffect, useRef, useState } from "react";
import { call, notifyError } from "@/lib/client";
import { confirmAction } from "@/lib/confirm";
import { useChat } from "@/lib/chat";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import { useLive, useDo, Countdown, when, Note, Empty, Section } from "./sugKit";
import "./sug-app.css";
import "./faculty-app.css";
import GroupChat from "./GroupChat";
import { MyGroups, Discover, Create, GroupScreen } from "./CustomGroups";

const ago = (t) => {
  if (!t) return "a while ago";
  const m = Math.max(0, Math.round((Date.now() - +new Date(t)) / 60000));
  return m < 2 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

function Dot({ on }) { return <i className="fg-dot" data-on={on ? "1" : undefined} role="img" aria-label={on ? "Online" : "Offline"} />; }

/** One person in a list: picture, name, level, post, online dot, unread badge. The whole row is one big tap target. */
function Person({ p, onOpen }) {
  return (
    <button type="button" className="fg-person" onClick={() => onOpen(p.name)} aria-label={`${p.name}, ${p.online ? "online" : "offline"}${p.unread ? `, ${p.unread} unread` : ""}`}>
      <span className="fg-pic"><PlayerAvatar name={p.name} size={46} /><Dot on={p.online} /></span>
      <span className="fg-who">
        <b>{p.name}</b>
        <small>{[p.level ? `${p.level}L` : null, p.department, p.online ? "Online" : null].filter(Boolean).join(" · ") || "Student"}</small>
        {p.office ? <em className="fg-office">{p.office}</em> : null}
      </span>
      {p.unread ? <i className="fg-unread" aria-hidden="true">{p.unread > 9 ? "9+" : p.unread}</i> : <Icon name="next" size={18} />}
    </button>
  );
}

// ================================================================================================================ group home
function Leader({ o }) {
  return (
    <div className="fg-leader" data-vacant={o.holder ? undefined : "1"}>
      <small>{o.title}</small>
      {o.holder ? <div className="fg-leader-row"><PlayerAvatar name={o.holder.name} size={40} /><span><b>{o.holder.name}</b><small>{o.holder.level}L · since {when(o.holder.since)}</small></span></div> : <p>Not elected yet</p>}
    </div>
  );
}

function Home({ d, el, go }) {
  const cy = el?.cycle;
  return (
    <div className="fg-stack">
      <div className="fg-hero">
        <small>Your official faculty group</small>
        <h2>{d.group.name}</h2>
        <p>{d.group.faculty}</p>
        <div className="fg-stats">
          <div><b>{d.memberCount}</b><span>{d.memberCount === 1 ? "member" : "members"}</span></div>
          <div><b>{d.onlineCount}</b><span>online</span></div>
          <div><b>{d.unread}</b><span>unread</span></div>
        </div>
      </div>
      <button type="button" className="go sg-cta" onClick={() => go("discussion")}><Icon name="talk" size={20} weight="fill" /> Faculty discussion{d.discussionUnread ? ` (${d.discussionUnread > 99 ? "99+" : d.discussionUnread} new)` : ""}</button>
      <div className="fg-actions">
        <button type="button" className="fg-act" onClick={() => go("members")}><Icon name="users" size={22} weight="fill" /><span>Members</span></button>
        <button type="button" className="fg-act" onClick={() => go("messages")}>
          <Icon name="chat" size={22} weight="fill" /><span>Messages</span>{d.unread ? <i className="fg-unread" aria-label={`${d.unread} unread`}>{d.unread > 9 ? "9+" : d.unread}</i> : null}
        </button>
        <button type="button" className="fg-act" onClick={() => go("elections")}><Icon name="hall" size={22} weight="fill" /><span>Elections</span>{cy && el.votingOpen ? <i className="fg-live" aria-hidden="true" /> : null}</button>
      </div>
      <Section title="Faculty leadership" hint="Elected by the members of this faculty.">
        <Leader o={d.offices.REPRESENTATIVE} />
        <Leader o={d.offices.ASSISTANT} />
      </Section>
      {cy ? (
        <button type="button" className="fg-elect" data-s={cy.stage} onClick={() => go("elections")}>
          <small>Faculty elections</small><b>{cy.stageLabel}</b><span>{cy.title}</span>
          {el.votingOpen && el.races.some((r) => r.canVote) ? <em>Your vote is needed</em> : el.me.canRegister ? <em>You can stand for election</em> : null}
        </button>
      ) : null}
    </div>
  );
}

// ================================================================================================================ members
function Members({ onOpen }) {
  const [q, setQ] = useState(""), [dq, setDq] = useState(""), [more, setMore] = useState({ for: "", rows: [], done: false }), [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const path = `/api/faculty-groups/members?q=${encodeURIComponent(dq)}`;
  const { d, load, loadFailed } = useLive(path, 20000);
  const extra = more.for === dq ? more : { rows: [], done: false }; // extra pages belong to one search only
  if (loadFailed) return <LoadError title="Members didn't load" onRetry={load} />;
  const first = d?.members ?? [], rows = [...first, ...extra.rows.filter((r) => !first.some((f) => f.name === r.name))];
  const hasMore = d && !extra.done && (extra.rows.length ? more.hasMore : d.hasMore);
  async function showMore() {
    if (busy) return; setBusy(true);
    const r = await call(`${path}&offset=${rows.length}`); setBusy(false);
    if (r.failed) return notifyError(r);
    setMore({ for: dq, rows: [...extra.rows, ...r.members], hasMore: r.hasMore, done: !r.members.length });
  }
  return (
    <div className="fg-stack">
      <label className="fg-search">
        <Icon name="search" size={18} />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your faculty" maxLength={30} aria-label="Search members of your faculty" autoComplete="off" />
        {q ? <button type="button" onClick={() => setQ("")} aria-label="Clear search"><Icon name="close" size={16} /></button> : null}
      </label>
      {!d ? <Loader /> : null}
      {d ? <p className="sg-hint">{d.total} {d.total === 1 ? "colleague" : "colleagues"}{dq ? ` matching “${dq}”` : ""}</p> : null}
      <div className="fg-list">{rows.map((p) => <Person key={p.name} p={p} onOpen={onOpen} />)}</div>
      {d && !rows.length ? <Empty>{dq ? "Nobody in your faculty matches that name." : "You are the only member so far. Others join automatically when they create their character."}</Empty> : null}
      {hasMore ? <button type="button" className="sg-link" onClick={showMore} disabled={busy}>{busy ? "Loading…" : "Show more"}</button> : null}
    </div>
  );
}

// ================================================================================================================ a colleague
function Profile({ name, onBack, onMessage }) {
  const { d, load, loadFailed } = useLive(`/api/faculty-groups/profile?name=${encodeURIComponent(name)}`, 30000);
  const [busy, setBusy] = useState(false);
  async function message() {
    if (busy) return; setBusy(true);
    const r = await call("/api/faculty-groups/conversation", { name }); setBusy(false);
    if (r.failed) return notifyError(r, "You cannot message this player.");
    onMessage(r.name);
  }
  return (
    <div className="fg-stack">
      <button type="button" className="sg-back sg-link" onClick={onBack}><Icon name="left" size={18} /> Members</button>
      {loadFailed ? <LoadError title="Profile didn't load" message="This player may no longer be in your faculty group." onRetry={load} /> : !d ? <Loader /> : (
        <>
          <div className="fg-prof">
            <span className="fg-pic"><PlayerAvatar name={d.name} size={96} look={d.look ? { gender: d.gender, look: d.look } : null} /><Dot on={d.online} /></span>
            <h2>{d.name}</h2>
            <p>{d.faculty}</p>
            <div className="fg-chips">
              {d.facultyOffice ? <span className="fg-chip" data-hi="1">{d.facultyOffice}</span> : null}
              {d.office ? <span className="fg-chip">{d.office}</span> : null}
              <span className="fg-chip">{d.level}L</span>
              {d.department ? <span className="fg-chip">{d.department}</span> : null}
            </div>
            <small>{d.online ? "Online now" : `Last seen ${ago(d.lastSeen)}`}</small>
          </div>
          <button type="button" className="sg-cta fg-msg" onClick={message} disabled={busy}><Icon name="chat" size={20} weight="fill" /> {busy ? "Opening…" : `Message ${d.name}`}</button>
          <Section title="About">
            <ul className="fg-facts">
              {d.cgpa != null ? <li><span>CGPA</span><b>{d.cgpa.toFixed(2)}</b></li> : null}
              <li><span>Popularity</span><b>{d.popularity}</b></li>
              {d.class ? <li><span>Background</span><b>{d.class}</b></li> : null}
              {d.relationship ? <li><span>Relationship</span><b>{d.relationship}</b></li> : null}
            </ul>
            {d.achievements?.length ? <div className="fg-chips">{d.achievements.slice(0, 6).map((a) => <span className="fg-chip" key={a}>{a}</span>)}</div> : null}
          </Section>
        </>
      )}
    </div>
  );
}

// ================================================================================================================ elections
// A faculty's Faculty Representative and Assistant are elected in the SUG election: these are its faculty races. This screen shows them for MY faculty
// and sends a vote to the SUG election's own vote action, so the rules (one ballot per race, my faculty only, the voting window, runoffs) are SUG's.
function Candidate({ c, canVote, voted, onVote, onOpen }) {
  return (
    <div className="fg-cand" data-voted={voted ? "1" : undefined}>
      <PlayerAvatar name={c.name} size={44} />
      <span className="fg-who"><b>{c.name}{c.isMe ? " (you)" : ""}</b><small>{c.level ? `${c.level}L` : ""}</small>{c.slogan ? <p>“{c.slogan}”</p> : null}</span>
      {canVote && !c.isMe ? <button type="button" className="fg-vote" onClick={() => onVote(c)}>Vote</button> : null}
    </div>
  );
}

function Elections({ ovReload, onOpenApp }) {
  const { d, load, loadFailed } = useLive("/api/faculty-groups/elections", 15000);
  const doIt = useDo("/api/sug", [load, ovReload]);
  if (loadFailed) return <LoadError title="Elections didn't load" onRetry={load} />;
  if (!d) return <Loader />;
  const cy = d.cycle, sug = () => onOpenApp?.("sug");
  async function vote(race, c) {
    if (!(await confirmAction({ title: `Vote for ${c.name}?`, message: `This is your one vote for ${race.title}. You cannot change it later.`, confirmLabel: "Vote" }))) return;
    await doIt({ action: "vote", position: race.position, candidateId: c.id }, { ok: `Voted for ${c.name}.`, key: `fg:vote:${race.position}` });
  }
  return (
    <div className="fg-stack">
      {cy ? (
        <div className="sg-banner fg-banner" data-stage={cy.stage}>
          <small>Faculty elections</small><h2>{cy.stageLabel}</h2><p>{cy.title}</p>
          {cy.next?.at ? <div className="sg-next"><Icon name="timer" size={18} weight="fill" /><span>{cy.next.label} in</span><Countdown at={cy.next.at} label={cy.next.label} /></div> : null}
        </div>
      ) : <Note title="No election right now">{d.nextElection?.announceAt ? `The next Students' Union election will be announced on ${when(d.nextElection.announceAt)}.` : "The next Students' Union election has not been announced yet."} Faculty Representatives are elected in it.</Note>}
      {cy ? <p className="sg-hint">{cy.stageHint}</p> : null}

      <Section title="Faculty leadership" hint="Holding office now.">
        <Leader o={d.offices.REPRESENTATIVE} /><Leader o={d.offices.ASSISTANT} />
      </Section>

      {cy && d.me.canRegister ? <Note tone="good" title="You can stand for election">Put your name forward for Faculty Representative or Assistant in the Students' Union app.<button type="button" className="sg-link" onClick={sug}>Open the SUG app</button></Note> : null}
      {cy && d.me.candidacy ? <Note tone="good" title={`You are standing for ${d.me.candidacy.title}`}><button type="button" className="sg-link" onClick={sug}>Manage your campaign</button></Note> : null}
      {cy && !d.me.mayVote && d.votingOpen ? <Note tone="warn" title="You cannot vote right now">{d.me.voterIssues.join(" ")}</Note> : null}

      {cy ? d.races.map((r) => (
        <Section key={r.position} title={r.title} aside={r.voted ? <span className="sg-pill" data-s="VOTED">You voted</span> : null}
          hint={r.canVote ? "You have one vote for this post." : d.votingOpen ? (r.voted ? "Your vote is in. Results come out when voting ends." : undefined) : undefined}>
          {r.candidates.length ? r.candidates.map((c) => <Candidate key={c.id} c={c} canVote={r.canVote} onVote={(x) => vote(r, x)} />)
            : <Empty>{["ANNOUNCED", "REGISTRATION"].includes(cy.stage) ? "Nobody has registered yet." : "Nobody stood for this post."}</Empty>}
        </Section>
      )) : null}

      {d.results?.races.length ? (
        <Section title="Latest results" hint={d.results.cycle.title}>
          {d.results.races.map((r) => (
            <div className="fg-res" key={r.position}>
              <small>{r.title}</small>
              {r.rows.some((x) => x.won) ? r.rows.filter((x) => x.won).map((x) => <div className="fg-res-win" key={x.name}><PlayerAvatar name={x.name} size={40} /><span><b>{x.name}</b><small>Elected · {x.votes} votes ({x.percent}%){x.tieBreak === "RUNOFF" ? " · won a runoff" : ""}</small></span></div>) : <p>{r.status}</p>}
              {r.rows.length ? <ul className="fg-tally">{r.rows.map((x) => <li key={x.name}><span>{x.name}</span><b>{x.votes}{x.runoffVotes != null ? ` (+${x.runoffVotes} runoff)` : ""}</b></li>)}</ul> : null}
            </div>
          ))}
        </Section>
      ) : null}
      <button type="button" className="sg-link" onClick={sug}>Open the Students' Union election</button>
    </div>
  );
}

// ================================================================================================================ the app
const TABS = [["group", "Group"], ["discussion", "Chat"], ["members", "Members"], ["elections", "Elections"]];
const SECTIONS = [["faculty", "My Faculty"], ["mine", "My Groups"], ["discover", "Discover"]];

export default function GroupsApp({ onOpenApp, initialGroup = null }) {
  const [section, setSection] = useState(initialGroup ? "mine" : "faculty"), [open, setOpen] = useState(initialGroup), [creating, setCreating] = useState(false);
  const pick = (k) => { setSection(k); setOpen(null); setCreating(false); };
  return (
    <div className="fg">
      {!open && !creating ? (
        <nav className="gr-sections" aria-label="Groups">
          {SECTIONS.map(([k, label]) => <button key={k} type="button" aria-current={section === k ? "page" : undefined} onClick={() => pick(k)}>{label}</button>)}
        </nav>
      ) : null}
      {open ? <GroupScreen key={open} id={open} onBack={() => setOpen(null)} />
        : creating ? <Create onBack={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSection("mine"); setOpen(id); }} />
        : section === "faculty" ? <MyFaculty onOpenApp={onOpenApp} />
        : section === "mine" ? <MyGroups onOpen={setOpen} onCreate={() => setCreating(true)} />
        : <Discover onOpen={setOpen} />}
    </div>
  );
}

function MyFaculty({ onOpenApp }) {
  const [tab, setTab] = useState("group"), [who, setWho] = useState(null);
  const ov = useLive("/api/faculty-groups", 20000), el = useLive("/api/faculty-groups/elections", 20000);
  const unread = useChat((s) => s.unread), first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } ov.load(); }, [unread]); // a new message arrived (the chat connection pushes it): refresh the counts

  if (ov.loadFailed) return <LoadError title="Faculty group didn't load" onRetry={ov.load} />;
  if (!ov.d) return <Loader />;
  const go = (t) => (t === "messages" ? onOpenApp?.("messages") : (setWho(null), setTab(t)));
  const openMessages = (name) => onOpenApp?.("messages", name);
  return (
    <div className="fg">
      {!who ? (
        <div role="tablist" aria-label="Faculty group">
          {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{label}</button>)}
        </div>
      ) : null}
      {who ? <Profile name={who} onBack={() => setWho(null)} onMessage={openMessages} />
        : tab === "group" ? <Home d={ov.d} el={el.d} go={go} />
        : tab === "discussion" ? <GroupChat path="/api/faculty-groups/messages" onChanged={ov.load} />
        : tab === "members" ? <Members onOpen={setWho} />
        : <Elections ovReload={ov.load} onOpenApp={onOpenApp} />}
    </div>
  );
}

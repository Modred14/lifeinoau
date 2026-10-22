// components/apps/SugApp.js: the Students' Union Government app (lives inside the phone, see components/Phone.js)
// Election (timetable, eligibility, the 12 races, standing for office), the candidates and the ballot, the campaign, the results,
// then the Government and the Assembly once a term is running. Every rule is enforced by the server (lib/sugService.js and friends);
// these screens only show what it says and send one request per tap, each with its own requestId.
"use client";
import { useEffect, useState } from "react";
import { call, naira } from "@/lib/client";
import { confirmAction } from "@/lib/confirm";
import { toast } from "@/lib/toast";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import { useLive, useDo, Countdown, when, nairaN, Note, Empty, Section } from "./sugKit";
import SugGovernment from "./SugGovernment";
import SugAssembly from "./SugAssembly";
import SugAdmin from "./SugAdmin";
import "./sug-app.css";

const TIMETABLE = [["announcedAt", "Election announced"], ["registrationOpensAt", "Registration opens"], ["campaignStartsAt", "Registration closes, campaign begins"], ["votingStartsAt", "Voting opens"], ["votingEndsAt", "Voting closes"]];

// ============================================================================================================================ election home
function Banner({ cycle }) {
  return (
    <div className="sg-banner" data-stage={cycle.stage}>
      <small>Election {cycle.number}{cycle.title ? ` · ${cycle.title}` : ""}</small>
      <h2>{cycle.stageLabel}</h2>
      <p>{cycle.stageHint}</p>
      {cycle.next?.at ? <div className="sg-next"><Icon name="timer" size={18} weight="fill" /><span>{cycle.next.label} in</span><Countdown at={cycle.next.at} label={cycle.next.label} /></div> : null}
    </div>
  );
}

function Timetable({ cycle }) {
  const t = cycle.timetable, rows = TIMETABLE.map(([k, label]) => [label, t[k]]);
  if (t.runoffStartsAt) rows.push(["Runoff voting (tied seats only)", t.runoffStartsAt]);
  rows.push(["Term begins", cycle.termStartsAt ?? null]);
  return (
    <ol className="sg-time">
      {rows.filter(([, at]) => at).map(([label, at]) => <li key={label} data-past={at <= Date.now() ? "1" : undefined}><span>{label}</span><b>{when(at)}</b></li>)}
    </ol>
  );
}

function Eligibility({ me }) {
  if (me.voterIssues.length)
    return <Note tone="warn" title="You cannot vote in this election yet">{me.voterIssues.join(" ")}</Note>;
  return <Note tone="good" title="You can vote">{me.candidateIssues.length ? `You may vote in every race. To stand for office: ${me.candidateIssues.join(" ")}` : "You may vote in every race, and you meet the conditions to stand for office."}</Note>;
}

function MyCandidacy({ me, cycle, doIt }) {
  const c = me.candidacy;
  if (!c) return null;
  const can = c.status === "ACTIVE" && ["REGISTRATION", "CAMPAIGN"].includes(cycle.stage);
  async function out() {
    if (!(await confirmAction({ title: "Withdraw from the election?", message: `You stop standing for ${c.title}. The nomination fee is not refunded, and you cannot register again in this election.`, confirmLabel: "Withdraw", tone: "danger" }))) return;
    await doIt({ action: "withdraw" }, { ok: "You have withdrawn.", key: "sug:withdraw" });
  }
  return (
    <div className="sg-card sg-mine">
      <small>Your candidacy</small>
      <b>{c.title}</b>
      <p>“{c.slogan}”</p>
      <span className="sg-pill" data-s={c.status}>{c.status === "ACTIVE" ? "On the ballot" : c.status === "WON" ? "Elected" : c.status === "LOST" ? "Not elected" : c.status === "WITHDRAWN" ? "Withdrawn" : "Disqualified"}</span>
      {can ? <button type="button" className="danger" onClick={out}>Withdraw</button> : null}
    </div>
  );
}

function RegisterSheet({ d, onClose, doIt }) {
  const [f, setF] = useState({ position: "", slogan: "", intro: "", manifesto: "", promises: "" });
  const [busy, setBusy] = useState(false);
  const L = d.config.limits, set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const race = d.races.find((r) => r.position === f.position);
  const missing = !f.position ? "Choose the position you want." : f.slogan.trim().length < 3 ? "Add a slogan." : f.intro.trim().length < 10 ? "Introduce yourself in a sentence or two." : f.manifesto.trim().length < 30 ? "Your manifesto needs a little more (at least 30 characters)." : !f.promises.trim() ? "Add at least one promise." : "";
  async function go() {
    if (missing) return toast.error(missing);
    const fee = naira(d.cycle.nominationFeeKobo);
    if (!(await confirmAction({
      title: `Stand for ${race.title}?`,
      message: `The nomination fee is ${fee}, paid now from your cash. You can stand for only one position in this election, you cannot change your entry afterwards, and the fee is not refunded if you withdraw.`,
      confirmLabel: `Pay ${fee} and register`,
    }))) return;
    setBusy(true);
    const res = await doIt({ action: "register", ...f }, { sensitive: true, pending: "Registering your candidacy…", ok: `You are on the ballot for ${race.title}.`, sound: "coin", key: "sug:register" });
    setBusy(false);
    if (!res.failed) onClose();
  }
  return (
    <div className="sg-sheet" role="dialog" aria-label="Stand for office">
      <div className="sg-sheet-in">
        <header><h3>Stand for office</h3><button type="button" onClick={onClose} aria-label="Close"><Icon name="close" size={18} /></button></header>
        <Note title={`Nomination fee ${naira(d.cycle.nominationFeeKobo)}`}>One position only. Your slogan, introduction, manifesto and promises are shown to every student and cannot be edited after you register.</Note>
        <label>Position
          <select value={f.position} onChange={set("position")}>
            <option value="">Choose a position</option>
            {d.races.map((r) => <option key={r.position} value={r.position}>{r.title}{r.seats > 1 ? ` (${r.seats} seats)` : ""}</option>)}
          </select>
        </label>
        {race ? <p className="sg-hint">{race.about} Spending cap: {nairaN(race.group === "EXECUTIVE" ? Number(BigInt(d.cycle.spendCapExecKobo) / 100n) : Number(BigInt(d.cycle.spendCapAssemblyKobo) / 100n))}.</p> : null}
        <label>Slogan <small>{f.slogan.length}/{L.slogan}</small><input type="text" value={f.slogan} maxLength={L.slogan} onChange={set("slogan")} placeholder="A line students will remember" /></label>
        <label>About you <small>{f.intro.length}/{L.intro}</small><textarea rows={3} value={f.intro} maxLength={L.intro} onChange={set("intro")} placeholder="Who you are and why you are standing" /></label>
        <label>Manifesto <small>{f.manifesto.length}/{L.manifesto}</small><textarea rows={6} value={f.manifesto} maxLength={L.manifesto} onChange={set("manifesto")} placeholder="What you will do in office" /></label>
        <label>Promises <small>one per line, up to {L.promises}</small><textarea rows={4} value={f.promises} onChange={set("promises")} placeholder={"Cheaper food at the SUB\nLonger library hours"} /></label>
        {missing ? <Note tone="info">{missing}</Note> : null}
        <button type="button" className="go" disabled={busy || !!missing} onClick={go}>{busy ? "Registering…" : "Register"}</button>
      </div>
    </div>
  );
}

function RaceRow({ r, me, onOpen }) {
  const voted = me.round === 2 ? r.votedRunoff : r.voted;
  return (
    <button type="button" className="sg-race" onClick={() => onOpen(r.position)} data-mine={r.mine ? "1" : undefined}>
      <span className="sg-race-t"><b>{r.title}</b><small>{r.seats > 1 ? `${r.seats} seats` : "1 seat"} · {r.candidates} candidate{r.candidates === 1 ? "" : "s"}{r.mine ? " · you" : ""}</small></span>
      {r.inRunoff && me.votingOpen ? <span className="sg-pill" data-s="RUNOFF">Runoff</span> : null}
      {me.votingOpen ? <span className="sg-pill" data-s={voted ? "VOTED" : "TODO"}>{voted ? "Voted" : "Vote"}</span> : <Icon name="caret" size={18} />}
    </button>
  );
}

function Election({ d, load, onOpen }) {
  const doIt = useDo("/api/sug", load), [reg, setReg] = useState(false);
  if (!d.cycle)
    return (
      <div className="sg-stack">
        <div className="sg-banner" data-stage="NONE"><small>Students' Union Government</small><h2>No election is running</h2>
          <p>{d.next?.announceAt ? `The next election will be announced on ${when(d.next.announceAt)}.` : "The next election will be announced by the Union."}</p></div>
        <Note title="How it works">One election fills 12 races: nine executive posts, the Speaker, the Deputy Speaker and 30 Honourable Members. The Clerk is appointed afterwards, not elected.</Note>
      </div>
    );
  const { cycle, me } = d, ex = d.races.filter((r) => r.group === "EXECUTIVE"), asm = d.races.filter((r) => r.group === "ASSEMBLY");
  return (
    <div className="sg-stack">
      <Banner cycle={cycle} />
      <Eligibility me={me} />
      <MyCandidacy me={me} cycle={cycle} doIt={doIt} />
      {me.canRegister ? <button type="button" className="go sg-cta" onClick={() => setReg(true)}>Stand for office · {naira(cycle.nominationFeeKobo)}</button> : !me.candidacy && me.registerWhy ? <Note tone="info">{me.registerWhy}</Note> : null}
      <Section title="Timetable"><Timetable cycle={{ ...cycle, termStartsAt: null }} /></Section>
      <Section title="Executive" hint="One winner each.">{ex.map((r) => <RaceRow key={r.position} r={r} me={me} onOpen={onOpen} />)}</Section>
      <Section title="Student Representative Assembly" hint="The Speaker, the Deputy Speaker and 30 Honourable Members.">{asm.map((r) => <RaceRow key={r.position} r={r} me={me} onOpen={onOpen} />)}</Section>
      {reg ? <RegisterSheet d={d} doIt={doIt} onClose={() => setReg(false)} /> : null}
    </div>
  );
}

// ============================================================================================================================ one race: candidates and the ballot
function Strength({ v }) {
  return <span className="sg-meter" role="img" aria-label={`Campaign strength ${v} out of 100`}><i style={{ width: `${Math.min(100, v)}%` }} /></span>;
}

function Candidate({ c, ctx, doIt, load }) {
  const [more, setMore] = useState(false);
  const { race, home } = ctx, me = home.me, round = me.round;
  const inRace = race.status !== "RUNOFF" || !race.tieIds || race.tieIds.includes(c.id);
  const voted = round === 2 ? home.races.find((r) => r.position === race.position)?.votedRunoff : home.races.find((r) => r.position === race.position)?.voted;
  const canVote = me.votingOpen && me.mayVote && !voted && c.status === "ACTIVE" && inRace;
  const canPledge = ["CAMPAIGN", "VOTING"].includes(home.cycle?.stage) && !c.isMe && !c.iPledged && c.status === "ACTIVE";
  async function vote() {
    if (!(await confirmAction({ title: `Vote for ${c.who.name}?`, message: `You are voting for ${c.who.name} as ${race.title}. Your vote is private, you have one vote in this race, and you cannot change it afterwards.`, confirmLabel: "Cast my vote" }))) return;
    await doIt({ action: "vote", position: race.position, candidateId: c.id }, { sensitive: true, pending: "Casting your vote…", ok: "Your vote is counted.", key: `sug:vote:${race.position}` });
  }
  return (
    <article className="sg-cand" data-me={c.isMe ? "1" : undefined}>
      <header>
        <PlayerAvatar name={c.who.name} size={40} className="sg-ava" />
        <div><b>{c.who.name}{c.isMe ? " (you)" : ""}</b><small>{[c.who.faculty, c.who.level ? `${c.who.level}L` : null].filter(Boolean).join(" · ")}</small></div>
        {c.status === "WON" ? <span className="sg-pill" data-s="WON">Elected</span> : null}
      </header>
      <p className="sg-slogan">“{c.slogan}”</p>
      <p>{c.intro}</p>
      {more ? (
        <div className="sg-more">
          <h4>Manifesto</h4><p className="sg-pre">{c.manifesto}</p>
          <h4>Promises</h4><ul>{(Array.isArray(c.promises) ? c.promises : []).map((p, i) => <li key={i}>{p}</li>)}</ul>
          {c.events.length ? <><h4>Recent campaign</h4><ul>{c.events.map((e) => <li key={e.id}>{e.title || e.kind.toLowerCase()} · {e.status === "SUCCESS" ? `${e.attendees} came` : e.status.toLowerCase()}</li>)}</ul></> : null}
        </div>
      ) : null}
      <button type="button" className="sg-link" onClick={() => setMore(!more)}>{more ? "Show less" : "Read manifesto and promises"}</button>
      <div className="sg-facts">
        <span>Campaign strength <Strength v={c.strength.total} /></span>
        <span>{c.supporters} supporter{c.supporters === 1 ? "" : "s"} · {c.pledged} pledged · {c.eventsHeld} event{c.eventsHeld === 1 ? "" : "s"}</span>
        <span>Spent {nairaN(Number(BigInt(c.spentKobo) / 100n))} of {nairaN(Number(BigInt(c.capKobo) / 100n))}</span>
      </div>
      <div className="sg-actions">
        {canPledge ? <button type="button" onClick={() => doIt({ action: "pledge", candidateId: c.id }, { ok: `You pledged to support ${c.who.name}.`, key: `sug:pledge:${c.id}` })}>Pledge support</button> : c.iPledged ? <span className="sg-pill" data-s="VOTED">You pledged</span> : null}
        {canVote ? <button type="button" className="go" onClick={vote}>Vote</button> : null}
      </div>
    </article>
  );
}

function Race({ position, onBack }) {
  const home = useLive("/api/sug", 20000), cand = useLive(`/api/sug?view=candidates&position=${position}`, 20000);
  const doIt = useDo("/api/sug", async () => { await Promise.all([home.load(), cand.load()]); });
  if (!cand.d || !home.d) return cand.loadFailed ? <LoadError onRetry={cand.load} /> : <Loader label="Loading candidates" />;
  const { race, candidates } = cand.d, h = home.d, r = h.races.find((x) => x.position === position);
  const voted = h.me.round === 2 ? r?.votedRunoff : r?.voted;
  return (
    <div className="sg-stack">
      <button type="button" className="sg-back" onClick={onBack}><Icon name="back" size={16} weight="bold" /> All races</button>
      <div className="sg-banner" data-stage={h.cycle?.stage}><small>{race.seats > 1 ? `${race.seats} seats` : "1 seat"}</small><h2>{race.title}</h2><p>{r?.about}</p></div>
      {race.status === "RUNOFF" && h.me.votingOpen ? <Note tone="info" title="Runoff">The vote ended level for the last seat. Only the tied candidates are on this ballot.</Note> : null}
      {voted ? <Note tone="good" title="You have voted in this race">Your vote is private and cannot be changed.</Note> : h.me.votingOpen && !h.me.mayVote ? <Note tone="warn" title="You cannot vote">{h.me.voterIssues.join(" ")}</Note> : null}
      {!h.me.votingOpen && h.cycle?.stage !== "RESULTS" ? <Note tone="info">{h.cycle?.stageHint}</Note> : null}
      {candidates.length ? candidates.map((c) => <Candidate key={c.id} c={c} ctx={{ race, home: h }} doIt={doIt} />) : <Empty>No one has registered for this race yet.</Empty>}
    </div>
  );
}

// ============================================================================================================================ campaign
function Opponents({ position, value, onChange }) {
  const { d } = useLive(`/api/sug?view=candidates&position=${position}`);
  return (
    <label>Debate opponent
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a candidate in your race</option>
        {(d?.candidates ?? []).filter((c) => !c.isMe).map((c) => <option key={c.id} value={c.id}>{c.who.name}</option>)}
      </select>
    </label>
  );
}

function StartEvent({ d, home, doIt }) {
  const kinds = home.config.events, [kind, setKind] = useState("SPEECH"), [venue, setVenue] = useState(Object.keys(home.config.venues)[0]);
  const [title, setTitle] = useState(""), [body, setBody] = useState(""), [opp, setOpp] = useState("");
  const k = kinds[kind], m = d.mine, used = m.usedToday[kind] ?? 0;
  async function go() {
    if (kind === "MESSAGE" && body.trim().length < 5) return toast.error("Write the message first.");
    if (k.opponent && !opp) return toast.error("Choose who you want to debate.");
    if (k.costNaira && !(await confirmAction({ title: `${k.label} costs ${nairaN(k.costNaira)}`, message: `It is paid now from your cash and counts towards your spending cap (${naira(m.spentKobo)} spent of ${naira(m.capKobo)}).`, confirmLabel: `Pay ${nairaN(k.costNaira)}` }))) return;
    const res = await doIt({ action: "event.start", kind, venue: k.venue ? venue : undefined, title, body, opponentId: k.opponent ? Number(opp) : undefined },
      { sensitive: k.costNaira > 0, pending: "Starting…", ok: k.live ? `${k.label} started. It counts if students come.` : `${k.label} done.`, key: `sug:event:${kind}` });
    if (!res.failed) { setTitle(""); setBody(""); }
  }
  return (
    <div className="sg-card sg-form">
      <h4>Campaign activity</h4>
      <div className="sg-chips" role="tablist" aria-label="Kind of activity">
        {Object.entries(kinds).map(([key, x]) => <button key={key} type="button" role="tab" aria-selected={kind === key} className={kind === key ? "on" : ""} onClick={() => setKind(key)}>{x.label}</button>)}
      </div>
      <p className="sg-hint">{k.blurb}</p>
      <p className="sg-facts"><span>Cost {k.costNaira ? nairaN(k.costNaira) : "free"} · Energy {k.energy}%{k.minutes ? ` · ${k.minutes} min` : ""}</span><span>Today {used}/{k.dailyMax} · Wait {k.cooldownMin} min between</span></p>
      {k.venue ? <label>Venue<select value={venue} onChange={(e) => setVenue(e.target.value)}>{Object.entries(home.config.venues).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label> : null}
      {k.venue ? <Note tone="info">You must be standing at the venue (open the map and travel there) when you start.</Note> : null}
      {k.opponent ? <Opponents position={m.position} value={opp} onChange={setOpp} /> : null}
      <label>{kind === "MESSAGE" ? "Message" : "Title (optional)"}{kind === "MESSAGE" ? null : <input type="text" value={title} maxLength={home.config.limits.title} onChange={(e) => setTitle(e.target.value)} />}</label>
      {kind === "MESSAGE" || k.live ? <textarea rows={3} value={body} maxLength={kind === "MESSAGE" ? home.config.limits.message : home.config.limits.speech} onChange={(e) => setBody(e.target.value)} placeholder={kind === "MESSAGE" ? "What do you want every student to read?" : "What will you say? (optional)"} /> : null}
      <button type="button" className="go" onClick={go}>Start</button>
    </div>
  );
}

function EventCard({ e, mine, doIt }) {
  const [names, setNames] = useState("");
  return (
    <div className="sg-event">
      <div><b>{e.label}{e.title ? `: ${e.title}` : ""}</b><small>{e.host} · {e.positionTitle}{e.venueName ? ` · ${e.venueName}` : ""}</small></div>
      <div className="sg-ev-r"><Countdown at={e.endsAt} label="Event ends" /><small>{e.attendees} here</small></div>
      {e.body ? <p>{e.body}</p> : null}
      {!e.mine ? <button type="button" onClick={() => doIt({ action: "event.join", eventId: e.id }, { ok: e.debateWithMe ? "You joined your debate." : "You joined. Thanks for coming.", key: `sug:join:${e.id}` })}>{e.debateWithMe ? "Accept debate / join" : "Join"}</button> : (
        <div className="sg-invite"><input type="text" value={names} placeholder="Invite by name, comma separated" onChange={(ev) => setNames(ev.target.value)} aria-label="Names to invite" />
          <button type="button" disabled={!names.trim()} onClick={async () => { const r = await doIt({ action: "event.invite", eventId: e.id, names }, { ok: "Invitations sent.", key: `sug:invite:${e.id}` }); if (!r.failed) setNames(""); }}>Invite</button></div>
      )}
    </div>
  );
}

function Campaign({ home }) {
  const { d, load, loadFailed } = useLive("/api/sug?view=campaign", 8000);
  const doIt = useDo("/api/sug", async () => { await Promise.all([load(), home.load()]); });
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Loading the campaign" />;
  const m = d.mine, h = home.d;
  return (
    <div className="sg-stack">
      {!h.cycle ? <Note tone="info" title="No campaign right now">There is no election running.</Note> : null}
      {m ? (
        <>
          <div className="sg-card"><small>Your campaign</small>
            <div className="sg-facts"><span>Spent {naira(m.spentKobo)} of {naira(m.capKobo)}</span><span>Influence today {m.momentumToday}/{m.momentumCap}</span></div>
            <p className="sg-hint">Influence from events is capped each day, so repeating the same thing does not add more. Real students coming to your events counts most.</p></div>
          {["CAMPAIGN", "VOTING", "REGISTRATION"].includes(h.cycle?.stage) ? <StartEvent d={d} home={h} doIt={doIt} /> : null}
        </>
      ) : h.cycle ? <Note tone="info" title="You are not a candidate">You can still go to events, pledge your support and vote.</Note> : null}
      <Section title="Happening now" hint="Join an event to hear a candidate. Your presence counts for them.">
        {d.live.length ? d.live.map((e) => <EventCard key={e.id} e={e} doIt={doIt} />) : <Empty>No live events at the moment.</Empty>}
      </Section>
      <Section title="Campaign messages">
        {d.messages.length ? d.messages.map((e) => <div className="sg-msg" key={e.id}><b>{e.host}</b><small>{e.positionTitle} · {when(e.startsAt)}</small><p>{e.body || e.title || e.label}</p></div>) : <Empty>No messages yet.</Empty>}
      </Section>
      <Section title="Recent events">
        {d.recent.length ? d.recent.map((e) => <div className="sg-msg" key={e.id}><b>{e.label} · {e.host}</b><small>{e.positionTitle} · {e.status === "SUCCESS" ? `${e.attendees} came` : "too few came"}</small></div>) : <Empty>Nothing has happened yet.</Empty>}
      </Section>
    </div>
  );
}

// ============================================================================================================================ results
function Results() {
  const { d, load, loadFailed } = useLive("/api/sug?view=results"), hist = useLive("/api/sug?view=history");
  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Loader label="Loading results" />;
  return (
    <div className="sg-stack">
      {!d.available ? <Note tone="info" title="No results yet">Results appear as soon as voting has ended and the votes are counted. They cannot be changed after that.</Note> : (
        <>
          <div className="sg-banner" data-stage="RESULTS"><small>Election {d.cycle.number}</small><h2>Final results</h2><p>{d.totalSeats} seats were contested. The term runs {when(d.cycle.termStartsAt)} to {when(d.cycle.termEndsAt)}.</p></div>
          {d.races.map((r) => (
            <section className="sg-sec" key={r.position}>
              <header><h3>{r.title}</h3><span className="sg-pill" data-s={r.vacant ? "VACANT" : "WON"}>{r.status}</span></header>
              <p className="sg-hint">{r.validVotes} valid vote{r.validVotes === 1 ? "" : "s"}{r.vacant ? ` · ${r.vacant} seat${r.vacant === 1 ? "" : "s"} vacant` : ""}</p>
              {r.tieNote ? <Note tone="info" title="Tie rule">{r.tieNote}</Note> : null}
              <ol className="sg-rows">
                {r.rows.map((x) => (
                  <li key={x.candidateId} data-won={x.outcome === "WON" ? "1" : undefined}>
                    <span className="sg-rank">{x.rank}</span>
                    <span className="sg-rname"><b>{x.who.name}</b><small>{x.outcome === "WON" ? (x.seat ? `Seat ${x.seat}` : "Elected") : "Not elected"}{x.runoffVotes ? ` · runoff ${x.runoffVotes}` : ""}</small></span>
                    <span className="sg-rv"><b>{x.votes}</b><small>{x.percent.toFixed(2)}%</small></span>
                    <span className="sg-bar"><i style={{ width: `${Math.min(100, x.percent)}%` }} /></span>
                  </li>
                ))}
              </ol>
              {!r.rows.length ? <Empty>No one stood in this race.</Empty> : null}
            </section>
          ))}
        </>
      )}
      {hist.d?.cycles?.length ? (
        <Section title="Past governments">
          {hist.d.cycles.map((c) => <details key={c.id} className="sg-hist"><summary>Election {c.number} · {when(c.termStartsAt)}</summary><ul>{c.leaders.map((l) => <li key={l.position}><span>{l.title}</span><b>{l.name}</b></li>)}</ul></details>)}
        </Section>
      ) : null}
    </div>
  );
}

// ============================================================================================================================ the app
const TABS = [["election", "Election"], ["campaign", "Campaign"], ["results", "Results"], ["government", "Government"], ["assembly", "Assembly"]];

export default function SugApp() {
  const home = useLive("/api/sug", 30000);
  const [tab, setTab] = useState("election"), [race, setRace] = useState(null), [admin, setAdmin] = useState(false);
  useEffect(() => { // administrators get one more tab; everyone else gets a 404 here and sees nothing
    let live = true;
    call("/api/admin/sug").then((r) => { if (live && !r.failed) setAdmin(true); });
    return () => { live = false; };
  }, []);
  if (!home.d) return home.loadFailed ? <LoadError onRetry={home.load} /> : <Loader label="Opening the Union" />;
  const tabs = admin ? [...TABS, ["admin", "Admin"]] : TABS;
  return (
    <div className="sg">
      <div role="tablist" aria-label="Students' Union Government">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => { setTab(id); setRace(null); }}>{label}</button>)}
      </div>
      {tab === "election" ? (race ? <Race position={race} onBack={() => setRace(null)} /> : <Election d={home.d} load={home.load} onOpen={setRace} />) : null}
      {tab === "campaign" ? <Campaign home={home} /> : null}
      {tab === "results" ? <Results /> : null}
      {tab === "government" ? <SugGovernment /> : null}
      {tab === "assembly" ? <SugAssembly /> : null}
      {tab === "admin" ? <SugAdmin /> : null}
    </div>
  );
}
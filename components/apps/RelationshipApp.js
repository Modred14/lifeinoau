// components/apps/RelationshipApp.js: the Love app. Lives inside the phone (see components/Phone.js).
// Real players only: you can start something with someone you have messaged, date them, feed them, have them over, then ask them to be
// your babe or your sneaky link. Every tap shows its result at once and is taken back if the server says no (lib/lovePatches.js).
"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Heart, HeartBreak, ForkKnife, Gift, HouseLine, MoonStars, PaperPlaneTilt, Champagne, Diamond, Key, UserPlus, Clock, Check, Warning, Lock, Sparkle,
  Trash, ArrowCounterClockwise, ShieldWarning, ChatCircleDots, CaretDown, CaretUp, Eye, Hourglass, Handshake, HandHeart,
} from "@phosphor-icons/react";
import { call } from "@/lib/client";
import { toast } from "@/lib/toast";
import { playSound } from "@/lib/sound";
import { confirmAction } from "@/lib/confirm";
import { game, run, cash, bump, chain, canAfford, roomStore, useResource } from "@/lib/gameStore";
import { ACTIVITY, GIFTS, RINGS, COST, NOTES, COUPLE, MAX_SNEAKY, REQUEST_WEEKS, PROPOSE_AFTER_WEEKS } from "@/lib/relationships";
import * as P from "@/lib/lovePatches";
import LoadError from "@/components/LoadError";
import "./relationship-app.css";

const HUES = ["#3b6fd4", "#1f8f6a", "#b5651d", "#8a4fb3", "#c2456a", "#2e8a9c", "#a0802a"];
const hue = (n = "") => HUES[[...n].reduce((s, ch) => s + ch.charCodeAt(0), 0) % HUES.length];
const initials = (n = "") => n.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "?";
const first = (n = "") => n.split(/\s+/)[0];
const money = (n) => "₦" + Number(n).toLocaleString("en-NG");
const brief = (why) => String(why ?? "").split(". ")[0].replace(/\.$/, "");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const post = (body) => call("/api/relationship", { ...body, requestId: crypto.randomUUID() });
const isTmp = (id) => String(id).startsWith("tmp");
const RING_NAMES = { simple: "Simple band", classic: "Classic solitaire", royal: "Royal diamond" };
const ASKED = { DATE: "on a date", VISIT: "to come over", HANG: "to hang out", NIGHT: "for a night in", BABE: "to be your babe", SNEAKY: "to be your sneaky link", PROPOSE: "to marry you", MOVEIN: "to move in", RECONCILE: "for another chance" };
const KIND_ICON = { BABE: Heart, ENGAGED: Diamond, SNEAKY: Eye, BESTIE: Handshake, TALKING: ChatCircleDots, EX: HeartBreak };

// ---------------------------------------------------------------------------------------------------------------------------------
// small pieces
// ---------------------------------------------------------------------------------------------------------------------------------
function Avatar({ name, size = 48, kind, ring }) {
  const K = kind && KIND_ICON[kind];
  return (
    <span className="lv-av" style={{ width: size, height: size, background: hue(name), fontSize: size * 0.34 }} data-ring={ring ? "1" : undefined} aria-hidden="true">
      {initials(name)}
      {K && kind !== "TALKING" && kind !== "EX" && <i data-k={kind}><K size={size * 0.22} weight="fill" /></i>}
    </span>
  );
}

const Chip = ({ k, children }) => <span className="lv-chip" data-k={k}>{children}</span>;

function Meter({ b }) {
  return (
    <div className="lv-meter" aria-label={`Affection ${b.affection} out of 100, ${b.mood}`}>
      <div className="lv-meter-top"><b>{b.mood}</b><span className="num">{b.affection}/100</span></div>
      <div className="lv-bar" data-k={b.kind}>
        {[0, 1, 2, 3, 4].map((i) => <span key={i}><i style={{ width: Math.max(0, Math.min(100, ((b.affection - i * 20) / 20) * 100)) + "%" }} /></span>)}
      </div>
    </div>
  );
}

function Tile({ icon: I, label, sub, onClick, disabled, wait, tone }) {
  return (
    <button type="button" className="lv-tile" disabled={disabled} data-wait={wait ? "1" : undefined} data-tone={tone} onClick={onClick}>
      <span className="t-ico"><I size={18} weight="fill" /></span>
      <span className="t-txt"><b>{label}</b><small>{sub}</small></span>
    </button>
  );
}

function Empty({ icon: I = Heart, title, children, tone, action }) {
  return (
    <div className="lv-empty" data-tone={tone}>
      <span className="e-ico"><I size={26} weight="fill" /></span>
      <b>{title}</b>
      <p>{children}</p>
      {action}
    </div>
  );
}

function Sheet({ title, lead, onClose, children }) {
  return (
    <div className="ph-sheet-scrim" onClick={onClose}>
      <div className="ph-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <span className="ph-grab" />
        <h3>{title}</h3>
        {lead && <p className="lv-lead">{lead}</p>}
        {children}
      </div>
    </div>
  );
}

function Opt({ icon: I, title, sub, price, onClick, disabled, on }) {
  return (
    <button type="button" className="lv-opt" disabled={disabled} data-on={on ? "1" : undefined} onClick={onClick}>
      <span className="o-ico"><I size={20} weight="fill" /></span>
      <span className="o-t"><b>{title}</b>{sub && <small>{sub}</small>}</span>
      {price && <em>{price}</em>}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="lv lv-sk" aria-busy="true" aria-label="Loading">
      <i style={{ height: 40, borderRadius: 16 }} />
      <i style={{ height: 300 }} />
      <i style={{ height: 120 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// the app
// ---------------------------------------------------------------------------------------------------------------------------------
export default function Relationship({ onOpenApp }) {
  const router = useRouter();
  const { d, store, load, loadFailed } = useResource("/api/relationship");
  const [tab, setTab] = useState("love");
  const [sheet, setSheet] = useState(null); // { type, b }
  const [open, setOpen] = useState({});
  const seenIn = useRef(null);

  // pick up new requests, answers and catches from the other player
  useEffect(() => {
    const tick = () => !document.hidden && store.refresh();
    const t = setInterval(tick, 10000);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [store]);
  const incomingN = d ? d.requests.filter((r) => !r.mine).length : 0;
  useEffect(() => {
    if (!d) return;
    if (seenIn.current !== null && incomingN > seenIn.current) playSound("receive");
    seenIn.current = incomingN;
  }, [incomingN, d]);

  if (!d) return loadFailed ? <LoadError onRetry={load} /> : <Skeleton />;

  const me = d.me, bonds = d.bonds;
  const couple = bonds.find((b) => COUPLE.includes(b.kind));
  const sneaky = bonds.filter((b) => b.kind === "SNEAKY");
  const talking = bonds.filter((b) => b.kind === "TALKING");
  const besties = bonds.filter((b) => b.kind === "BESTIE");
  const exes = bonds.filter((b) => b.kind === "EX");
  const incoming = d.requests.filter((r) => !r.mine), outgoing = d.requests.filter((r) => r.mine);
  const toggle = (k) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // ---- the one way every tap goes out: show it now, ask the server, undo it if refused ----
  function go(b, key, { ok, sound, body, patch, naira = 0, energy = 0, then }) {
    if (b && isTmp(b.id)) return toast.info("One moment, adding them…");
    if (naira && !canAfford(naira * 100)) return toast.error("You cannot afford that.");
    const spend = naira || energy ? { store: game, patch: chain(naira && cash(-naira * 100), energy && bump({ energy: -energy })) } : { store: game };
    return run({
      key: `love:${b?.id ?? ""}:${key}`, ok, sound, router, request: () => post(body),
      effects: [{ store, patch }, spend],
      then: (r) => {
        for (const x of r.caught ?? []) toast.error(x.over ? `${x.by} caught you with ${x.with} again. It is over.` : `${x.by} caught you with ${x.with}.`, { duration: 9000 });
        then?.(r);
      },
    });
  }

  const solo = (b, activity, extra = {}) => {
    const a = ACTIVITY[activity], naira = activity === "gift" ? GIFTS[extra.tier][0] : a.cost;
    go(b, activity, {
      ok: { note: `Note sent to ${first(b.name)}.`, food: `You bought ${first(b.name)} food.`, gift: `Gift sent to ${first(b.name)}.` }[activity],
      sound: naira ? "coin" : "send", body: { action: activity, id: b.id, ...extra }, patch: P.solo(b.id, activity, extra.tier), naira, energy: a.energy,
    });
  };
  const ask = (b, kind, variant, ok) => go(b, kind, { ok, sound: "send", body: { action: "request", id: b.id, kind, variant }, patch: P.sent(b.id, kind, variant, "tmp-" + Math.random().toString(36).slice(2)) });
  const invite = (b, kind, variant) => ask(b, kind, variant, `Invite sent to ${first(b.name)}.`);

  const answer = (r, accept) => {
    if (isTmp(r.id)) return toast.info("One moment…");
    const lower = r.kind.toLowerCase(), a = ACTIVITY[lower];
    const b = bonds.find((x) => x.id === r.bondId);
    const ok = !accept ? "Declined." : {
      DATE: `Date with ${r.from} is on.`, VISIT: `You are going over to ${r.from}'s.`, HANG: `Hanging out with ${r.from}.`, NIGHT: `A night in with ${r.from}.`,
      BABE: `${r.from} is your babe now.`, SNEAKY: `${r.from} is your sneaky link now.`, PROPOSE: `You said yes. You are engaged to ${r.from}.`,
      MOVEIN: `You are moving in with ${r.from}.`, RECONCILE: `You and ${r.from} are back together.`,
    }[r.kind];
    go(b ?? { id: r.bondId }, "ans" + r.id, {
      ok, sound: accept ? (["PROPOSE", "BABE"].includes(r.kind) ? "reveal" : "coin") : "tap", body: { action: "answer", id: r.id, accept }, patch: P.answered(r.id, accept),
      energy: accept && a ? a.energy : 0,
      then: () => { if (accept && r.kind === "MOVEIN") roomStore.scheduleRefresh(); },
    });
  };
  const cancel = (r) => (isTmp(r.id) ? toast.info("One moment…") : go({ id: r.bondId }, "can" + r.id, { ok: "Request taken back.", sound: "tap", body: { action: "cancel", id: r.id }, patch: P.cancelled(r.id) }));

  const breakUp = async (b) => {
    const what = b.kind === "ENGAGED" ? "your engagement" : b.kind === "BABE" ? "your relationship" : "things";
    if (!(await confirmAction({ title: `End ${what} with ${b.name}?`, message: b.kind === "ENGAGED" ? "Calling off an engagement hurts both of you." : "You will both feel it. This can only be undone if they agree to try again.", confirmLabel: "End it", cancelLabel: "Stay together", tone: "danger" }))) return;
    go(b, "breakup", { ok: `You ended things with ${first(b.name)}.`, sound: "warn", body: { action: "breakup", id: b.id }, patch: P.brokeUp(b.id) });
  };
  const forgive = (b) => go(b, "forgive", { ok: `You forgave ${first(b.name)}.`, sound: "reveal", body: { action: "forgive", id: b.id }, patch: P.forgave(b.id) });
  const apologise = (b) => go(b, "apologise", { ok: `${first(b.name)} knows you are sorry.`, sound: "coin", body: { action: "apologise", id: b.id }, patch: P.apologised(b.id), naira: COST.apology });
  const fresh = (b) => go(b, "fresh", { ok: `Starting over with ${first(b.name)}.`, sound: "pop", body: { action: "fresh", id: b.id }, patch: P.startedOver(b.id) });
  const reconcile = (b) => ask(b, "RECONCILE", null, `Asked ${first(b.name)} for another chance.`);
  const remove = async (b) => {
    if (!(await confirmAction({ title: `Remove ${b.name}?`, message: "They disappear from your Love list. You can add them again later.", confirmLabel: "Remove", cancelLabel: "Keep", tone: "danger" }))) return;
    go(b, "remove", { ok: `${first(b.name)} was removed.`, sound: "tap", body: { action: "remove", id: b.id }, patch: P.removed(b.id) });
  };
  const add = (p) => go(null, "add" + p.name, { ok: p.kind === "BESTIE" ? `${first(p.name)} is your bestie now.` : `You started talking to ${first(p.name)}.`, sound: "pop", body: { action: "add", name: p.name }, patch: P.added(p) });
  const decide = (choice) => run({ key: "love:preg", ok: choice === "keep" ? "You decided to keep the baby." : "Decision made.", sound: "coin", router, request: () => call("/api/pregnancy", { choice, requestId: crypto.randomUUID() }),
    effects: [{ store, patch: (s) => ({ ...s, pregnancy: null }) }, { store: game }] });

  // ---- tiles that know about waiting, answered and greyed-out states ----
  const T = (b, k, icon, label, sub, onClick) => {
    const lower = k.toLowerCase(), same = (r) => r.kind.toLowerCase() === lower;
    const mineReq = b.pending.find((r) => r.mine && same(r)), theirReq = b.pending.find((r) => !r.mine && same(r)), why = b.can[k];
    if (mineReq) return <Tile icon={Clock} label={label} sub={`Waiting for ${first(b.name)}`} disabled wait />;
    if (theirReq) return <Tile icon={icon} label={label} sub="They asked you. Answer" onClick={() => setTab("requests")} />;
    if (why) return <Tile icon={Lock} label={label} sub={brief(why)} disabled />;
    return <Tile icon={icon} label={label} sub={sub} onClick={onClick} />;
  };
  const sheetFor = (type, b) => setSheet({ type, b });
  const tiles = (b, keys) => {
    const TILES = {
    date: () => T(b, "date", Champagne, "Go on a date", `${money(COST.date)} · invite`, () => invite(b, "DATE")),
    food: () => T(b, "food", ForkKnife, "Buy food", money(COST.food), () => solo(b, "food")),
    gift: () => T(b, "gift", Gift, "Send a gift", "From ₦5,000", () => sheetFor("gift", b)),
    visit: () => T(b, "visit", Key, "Have them over", "Free · invite", () => invite(b, "VISIT")),
    night: () => T(b, "night", MoonStars, "A night in", "Just the two of you", () => sheetFor("night", b)),
    note: () => T(b, "note", PaperPlaneTilt, "Send a note", "Free", () => sheetFor("note", b)),
    hang: () => T(b, "hang", Sparkle, "Hang out", `${money(COST.hang)} · invite`, () => invite(b, "HANG")),
    };
    return keys.map((k) => <Fragment key={k}>{TILES[k]()}</Fragment>);
  };

  const Memories = ({ b }) => b.memories.length === 0 ? null : (
    <div>
      <button type="button" className="lv-btn lv-fold" onClick={() => toggle("m" + b.id)} aria-expanded={!!open["m" + b.id]}>
        <span>Memories · {b.memories.length}</span>{open["m" + b.id] ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
      </button>
      {open["m" + b.id] && <ul className="lv-mem">{b.memories.map((m, i) => <li key={i}><time>Wk {m.week}</time><span>{m.text}</span></li>)}</ul>}
    </div>
  );

  const Head = ({ b, size = 52 }) => (
    <div className="lv-head">
      <Avatar name={b.name} size={size} kind={b.kind} ring={b.kind === "ENGAGED"} />
      <div className="lv-who lv-grow">
        <h3>{b.name}</h3>
        <small>{b.faculty} · {b.level}L</small>
      </div>
      <Chip k={b.kind}>{b.label}</Chip>
    </div>
  );

  // ---- the main partner ----
  const Couple = ({ b }) => {
    const engaged = b.kind === "ENGAGED", mc = b.cheat;
    return (
      <section className="lv-card" data-k={b.kind} aria-label={`${b.label}: ${b.name}`}>
        <div className="lv-head">
          <Avatar name={b.name} size={60} kind={b.kind} ring={engaged} />
          <div className="lv-who lv-grow">
            <h3>{b.name}</h3>
            <small>{b.faculty} · {b.level}L</small>
          </div>
          <Chip k={b.kind}>{b.label}</Chip>
        </div>
        <div className="lv-line">
          <span>{b.weeks === 0 ? "Just started" : `${engaged ? "Engaged" : "Together"} ${plural(b.weeks, "week")}`}</span>
          {b.together && <Chip k="HOME">Living together</Chip>}
        </div>
        {mc && mc.by === "me" && (
          <div className="lv-note" data-tone="bad"><ShieldWarning size={18} weight="fill" /><span><b>{first(b.name)} caught you with someone.</b> They have to forgive you before you can do much together. A sorry gift helps.</span></div>
        )}
        {mc && mc.by === "them" && (
          <div className="lv-note" data-tone="bad"><ShieldWarning size={18} weight="fill" /><span><b>You caught {first(b.name)} cheating.</b> Forgive them or end it.</span></div>
        )}
        <Meter b={b} />
        {mc ? (
          <div className="lv-row">
            {mc.by === "them" ? (
              <>
                <button type="button" className="lv-btn primary" onClick={() => forgive(b)}><HandHeart size={18} weight="fill" />Forgive</button>
                <button type="button" className="lv-btn danger" onClick={() => breakUp(b)}><HeartBreak size={18} weight="fill" />End it</button>
              </>
            ) : (
              <button type="button" className="lv-btn primary" disabled={b.done.apology} onClick={() => apologise(b)}><Gift size={18} weight="fill" />{b.done.apology ? "Already apologised" : `Say sorry · ${money(COST.apology)}`}</button>
            )}
          </div>
        ) : (
          <div className="lv-grid">{tiles(b, ["date", "food", "gift", "visit", "night", "note"])}</div>
        )}
        {!mc && (
          <div className="lv-grid" style={{ gridTemplateColumns: engaged ? "1fr" : "1fr 1fr" }}>
            {!engaged && T(b, "PROPOSE", Diamond, "Propose", `Buy a ring · after ${plural(PROPOSE_AFTER_WEEKS, "week")}`, () => sheetFor("ring", b))}
            {b.together ? <Tile icon={HouseLine} label="Living together" sub="Rent is shared out" disabled /> : me.offCampus
              ? T(b, "MOVEIN", HouseLine, "Take them home", "Move in together", () => sheetFor("movein", b))
              : <Tile icon={Lock} label="Take them home" sub="Live off campus first" disabled />}
          </div>
        )}
        {Memories({ b })}
        <div className="lv-foot">
          <button type="button" className="lv-btn ghost" onClick={() => onOpenApp?.("messages")}><ChatCircleDots size={18} weight="fill" />Message</button>
          <button type="button" className="lv-btn danger" onClick={() => breakUp(b)}><HeartBreak size={18} weight="fill" />{engaged ? "Call it off" : "Break up"}</button>
        </div>
      </section>
    );
  };

  const Ready = ({ b }) => {
    const pend = (k) => b.pending.some((r) => r.mine && r.kind === k);
    const askBtn = (kind, label, icon) => {
      const why = b.can[kind], I = icon;
      return pend(kind)
        ? <button type="button" className="lv-btn" disabled><Clock size={18} weight="fill" />Waiting for {first(b.name)}</button>
        : <button type="button" className={`lv-btn ${kind === "BABE" ? "primary" : "dark"}`} disabled={!!why} onClick={() => sheetFor(kind === "BABE" ? "babe" : "sneaky", b)} title={why ?? undefined}><I size={18} weight="fill" />{label}</button>;
    };
    return (
      <>
        <div className="lv-steps">
          <span className="lv-steps-t">{b.ready ? "You two are ready" : "Before you can ask them out"}</span>
          {b.progress.map((p) => (
            <div className="lv-step" key={p.key} data-done={p.have >= p.need ? "1" : undefined}>
              <span className="ck"><Check size={14} weight="bold" /></span><span>{p.label}</span><em>{p.have}/{p.need}</em>
            </div>
          ))}
        </div>
        <div className="lv-row tight">
          {askBtn("BABE", "Be my babe", Heart)}
          {askBtn("SNEAKY", "Sneaky link", Eye)}
        </div>
        {!b.ready && <p className="lv-sub">Asking opens once you have done all three together.</p>}
        {b.can.BABE && b.ready && !b.pending.some((r) => r.mine && r.kind === "BABE") && <p className="lv-sub">{brief(b.can.BABE)}.</p>}
      </>
    );
  };

  const Sneaky = ({ b }) => (
    <section className="lv-card" data-k="SNEAKY" aria-label={`Sneaky link: ${b.name}`}>
      {Head({ b, size: 46 })}
      <Meter b={b} />
      {couple && <div className="lv-note"><Warning size={18} weight="fill" /><span>You have a babe. Every time you link up with {first(b.name)}, {first(couple.name)} might find out.</span></div>}
      <div className="lv-grid">{tiles(b, ["date", "food", "visit", "night", "gift", "note"])}</div>
      <div className="lv-foot">
        {!couple ? (() => {
          const why = b.can.BABE, mine = b.pending.some((r) => r.mine && r.kind === "BABE");
          return mine ? <button type="button" className="lv-btn" disabled><Clock size={18} weight="fill" />Waiting</button>
            : <button type="button" className="lv-btn primary" disabled={!!why} title={why ?? undefined} onClick={() => sheetFor("babe", b)}><Heart size={18} weight="fill" />Make them my babe</button>;
        })() : <span />}
        <button type="button" className="lv-btn danger" onClick={() => breakUp(b)}>End it</button>
      </div>
      {Memories({ b })}
    </section>
  );

  const Talking = ({ b }) => (
    <section className="lv-card" data-k="TALKING" aria-label={`Talking: ${b.name}`}>
      {Head({ b, size: 46 })}
      <Meter b={b} />
      <div className="lv-grid">{tiles(b, ["date", "food", "visit"])}</div>
      {Ready({ b })}
      {Memories({ b })}
      <div className="lv-foot">
        <button type="button" className="lv-btn ghost" onClick={() => onOpenApp?.("messages")}><ChatCircleDots size={18} weight="fill" />Message</button>
        <button type="button" className="lv-btn ghost" onClick={() => remove(b)}><Trash size={18} weight="fill" />Remove</button>
      </div>
    </section>
  );

  const Bestie = ({ b }) => (
    <section className="lv-card" data-k="BESTIE" aria-label={`Bestie: ${b.name}`}>
      {Head({ b, size: 50 })}
      <Meter b={b} />
      <div className="lv-grid">{tiles(b, ["hang", "food", "gift", "visit", "note"])}</div>
      {Memories({ b })}
      <div className="lv-foot">
        <button type="button" className="lv-btn ghost" onClick={() => onOpenApp?.("messages")}><ChatCircleDots size={18} weight="fill" />Message</button>
        <button type="button" className="lv-btn ghost" onClick={() => remove(b)}><Trash size={18} weight="fill" />Remove</button>
      </div>
    </section>
  );

  const Ex = ({ b }) => {
    const left = b.canReconcileUntil - d.week, can = !b.can.RECONCILE, wait = b.pending.some((r) => r.mine && r.kind === "RECONCILE");
    return (
      <section className="lv-card" data-k="EX" aria-label={`Ex: ${b.name}`}>
        <div className="lv-head">
          <Avatar name={b.name} size={42} />
          <div className="lv-who lv-grow"><h3>{b.name}</h3><small>{b.endedByMe ? "You ended it" : "They ended it"} · week {b.endedWeek}</small></div>
          <Chip k="EX">Ex</Chip>
        </div>
        <div className="lv-row tight">
          {wait ? <button type="button" className="lv-btn" disabled><Clock size={18} weight="fill" />Waiting</button>
            : <button type="button" className="lv-btn" disabled={!can} onClick={() => reconcile(b)}><ArrowCounterClockwise size={18} weight="fill" />{can ? `Another chance · ${money(COST.reconcile)}` : "Another chance"}</button>}
          <button type="button" className="lv-btn" onClick={() => fresh(b)}>Start over</button>
        </div>
        {can && left >= 0 && <p className="lv-sub">You can ask for another chance for {plural(Math.max(0, left), "more week")}.</p>}
        <div className="lv-foot"><span /><button type="button" className="lv-btn ghost" onClick={() => remove(b)}><Trash size={18} weight="fill" />Remove</button></div>
      </section>
    );
  };

  const Request = ({ r }) => {
    const b = bonds.find((x) => x.id === r.bondId), name = r.mine ? r.to : r.from, left = r.expiresWeek - d.week;
    const detail = (() => {
      const k = r.kind;
      if (r.mine) return left > 0 ? `Lapses in ${plural(left, "week")} if ${first(name)} does not answer.` : "Lapses this week if they do not answer.";
      if (k === "DATE") return `It costs ${first(name)} ${money(COST.date)}. You each spend ${ACTIVITY.date.energy} energy.`;
      if (k === "VISIT") return `You each spend ${ACTIVITY.visit.energy} energy.`;
      if (k === "HANG") return `You each spend ${ACTIVITY.hang.energy} energy.`;
      if (k === "NIGHT") return `${r.variant === "safe" ? "They want to be careful." : "They are not planning to be careful."} You each spend ${ACTIVITY.night.energy} energy.`;
      if (k === "BABE") return "You would be babes. Only one babe at a time.";
      if (k === "SNEAKY") return couple && couple.id !== r.bondId ? `You have a babe. ${first(couple.name)} might find out.` : "Keep it quiet.";
      if (k === "PROPOSE") return `${first(name)} is buying you a ${RING_NAMES[r.variant]?.toLowerCase() ?? "ring"}.`;
      if (k === "MOVEIN") return r.variant === "cover" ? `You would move into ${first(name)}'s place. They cover the rent.` : `You would move into ${first(name)}'s place and pay your own rent.`;
      if (k === "RECONCILE") return `A ${money(COST.reconcile)} gift comes with it.`;
      return "";
    })();
    return (
      <div className="lv-req" data-in={r.mine ? undefined : "1"}>
        <div className="lv-head">
          <Avatar name={name} size={44} kind={b?.kind} />
          <div className="lv-grow"><p>{r.mine ? <>You asked <b>{first(name)}</b> {ASKED[r.kind]}.</> : r.text}</p><span className="lv-sub">{detail}</span></div>
        </div>
        {r.mine ? (
          <div className="lv-foot"><Chip k="WAIT"><Clock size={12} weight="fill" />Waiting</Chip><button type="button" className="lv-btn ghost" onClick={() => cancel(r)}>Take it back</button></div>
        ) : (
          <div className="lv-row tight">
            <button type="button" className="lv-btn primary" onClick={() => answer(r, true)}><Check size={18} weight="bold" />{["BABE", "SNEAKY", "PROPOSE", "RECONCILE"].includes(r.kind) ? "Say yes" : "Accept"}</button>
            <button type="button" className="lv-btn" onClick={() => answer(r, false)}>Not now</button>
          </div>
        )}
      </div>
    );
  };

  // ---------------------------------------------------------------------------------------------------------------------------------
  // the tabs
  // ---------------------------------------------------------------------------------------------------------------------------------
  const TABS = [["love", "Partners"], ["besties", "Besties"], ["requests", "Requests"], ["meet", "Meet"]];
  return (
    <div className="lv">
      <div className="lv-sticky"><div role="tablist" aria-label="Love">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {label}{k === "requests" && incoming.length > 0 && <span className="lv-count">{incoming.length}</span>}
          </button>
        ))}
      </div></div>

      {d.pregnancy && tab === "love" && (
        <section className="lv-card" role="alert" data-k="EX">
          <div className="lv-who"><h3>A big decision</h3></div>
          <p className="lv-sub" style={{ fontSize: "0.9rem", color: "#344054" }}>
            {d.partnerIsPregnant ? "Your partner says she is pregnant." : "You think you might be pregnant."} You have <b>{d.pregnancy.weeksLeft}</b> game week(s) to decide. If you wait too long, life decides for you.
          </p>
          <div className="lv-row tight">
            <button type="button" className="lv-btn primary" onClick={() => decide("keep")}>Keep the baby<br /><span style={{ fontWeight: 400, fontSize: "0.76rem" }}>₦150,000 now, then ₦10,000 a week</span></button>
            <button type="button" className="lv-btn" onClick={() => decide("end")}>End the pregnancy<br /><span style={{ fontWeight: 400, fontSize: "0.76rem" }}>₦500,000, one time</span></button>
          </div>
          <p className="lv-sub">These are fictional game mechanics, not advice and not OAU rules.</p>
        </section>
      )}

      {tab === "love" && (
        <>
          {couple ? Couple({ b: couple }) : (
            <Empty title="No babe yet" action={<button type="button" className="lv-btn primary" onClick={() => setTab(talking.length || sneaky.length ? "love" : "meet")}>{talking.length || sneaky.length ? "Keep getting to know them" : "Meet someone"}</button>}>
              Go on 2 dates, buy them food and have them over. Then you can ask them to be your babe.
            </Empty>
          )}
          {sneaky.length > 0 && (<><div className="lv-h">Sneaky links<small>{sneaky.length}/{MAX_SNEAKY}</small></div>{sneaky.map((b) => <Fragment key={b.id}>{Sneaky({ b })}</Fragment>)}</>)}
          <div className="lv-h">Getting to know</div>
          {talking.length ? talking.map((b) => <Fragment key={b.id}>{Talking({ b })}</Fragment>) : (
            <Empty icon={ChatCircleDots} tone="slate" title="Nobody yet" action={<button type="button" className="lv-btn" onClick={() => setTab("meet")}><UserPlus size={18} weight="fill" />Find someone</button>}>
              Start with someone you have been messaging. Love only works between players who have talked.
            </Empty>
          )}
          {exes.length > 0 && (
            <>
              <button type="button" className="lv-btn lv-fold" style={{ margin: "10px 0 6px" }} onClick={() => toggle("exes")} aria-expanded={!!open.exes}>
                <span>Past · {exes.length}</span>{open.exes ? <CaretUp size={14} weight="bold" /> : <CaretDown size={14} weight="bold" />}
              </button>
              {open.exes && exes.map((b) => <Fragment key={b.id}>{Ex({ b })}</Fragment>)}
            </>
          )}
        </>
      )}

      {tab === "besties" && (
        besties.length ? (<><div className="lv-h">Your besties<small>{besties.length}</small></div>{besties.map((b) => <Fragment key={b.id}>{Bestie({ b })}</Fragment>)}</>) : (
          <Empty icon={Handshake} tone="blue" title="No besties yet" action={<button type="button" className="lv-btn" onClick={() => setTab("meet")}><UserPlus size={18} weight="fill" />Find someone</button>}>
            Players of your own gender become besties. Hang out, buy them food and send gifts to grow the bond.
          </Empty>
        )
      )}

      {tab === "requests" && (
        <>
          {incoming.length > 0 && <div className="lv-h">Waiting for you<small>{incoming.length}</small></div>}
          {incoming.map((r) => <Fragment key={r.id}>{Request({ r })}</Fragment>)}
          {outgoing.length > 0 && <div className="lv-h">Sent by you<small>{outgoing.length}</small></div>}
          {outgoing.map((r) => <Fragment key={r.id}>{Request({ r })}</Fragment>)}
          {!incoming.length && !outgoing.length && (
            <Empty icon={Hourglass} tone="slate" title="Nothing waiting">
              Invites, dates and questions show up here. People have {plural(REQUEST_WEEKS, "game week")} to answer before a request lapses.
            </Empty>
          )}
        </>
      )}

      {tab === "meet" && (
        <>
          <div className="lv-h">People you have talked to<small>{d.discover.length}</small></div>
          {d.discover.length ? d.discover.map((p) => (
            <div className="lv-person" key={p.name}>
              <Avatar name={p.name} size={44} />
              <div className="lv-who"><h3 style={{ fontSize: "1rem" }}>{p.name}</h3><small>{p.faculty} · {p.level}L</small></div>
              <button type="button" className={`lv-btn ${p.kind === "BESTIE" ? "" : "primary"}`} onClick={() => add(p)}>{p.kind === "BESTIE" ? "Add bestie" : "Start talking"}</button>
            </div>
          )) : (
            <Empty icon={ChatCircleDots} tone="slate" title="Message someone first" action={<button type="button" className="lv-btn primary" onClick={() => onOpenApp?.("messages")}><ChatCircleDots size={18} weight="fill" />Open Messages</button>}>
              You can only start something with a player you have really talked to: one message each way.
            </Empty>
          )}
          <div className="lv-how">
            <h3>How it works</h3>
            <ol>
              <li><span><b>Talk first.</b> Message a player and get a reply. Then add them here.</span></li>
              <li><span><b>Do things together.</b> Go on 2 dates, buy them food and have them over.</span></li>
              <li><span><b>Ask them.</b> Be my <b>babe</b> (one at a time) or a <b>sneaky link</b> (up to {MAX_SNEAKY}). Only opposite genders date. The same gender stays bestie.</span></li>
              <li><span><b>Take it further.</b> Propose after {plural(PROPOSE_AFTER_WEEKS, "week")} of dating, or take your babe home once you live off campus.</span></li>
              <li><span><b>Do not get caught.</b> A babe and a sneaky link at once is risky. Get caught twice and your babe walks.</span></li>
            </ol>
          </div>
        </>
      )}

      {sheet && <SheetView sheet={sheet} onClose={() => setSheet(null)} {...{ solo, invite, ask, couple, me, d }} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// bottom sheets
// ---------------------------------------------------------------------------------------------------------------------------------
function SheetView({ sheet, onClose, solo, invite, ask, couple, me }) {
  const { type, b } = sheet, name = first(b.name);
  const pick = (fn) => () => { onClose(); fn(); };
  if (type === "gift") return (
    <Sheet title={`A gift for ${name}`} lead="They get a notification and it grows your bond. One gift a week." onClose={onClose}>
      <div className="lv-opts">
        {Object.entries(GIFTS).map(([tier, [n, aff]]) => (
          <Opt key={tier} icon={Gift} title={{ small: "Small gift", medium: "Nice gift", big: "Big gift" }[tier]} sub={`+${aff} affection`} price={money(n)} onClick={pick(() => solo(b, "gift", { tier }))} />
        ))}
      </div>
    </Sheet>
  );
  if (type === "note") return (
    <Sheet title={`Send ${name} a note`} lead="It goes straight into your chat. Once a week." onClose={onClose}>
      <div className="lv-opts">
        {NOTES.map((t, line) => <Opt key={line} icon={PaperPlaneTilt} title={t} onClick={pick(() => solo(b, "note", { line }))} />)}
      </div>
    </Sheet>
  );
  if (type === "night") return (
    <Sheet title={`A night in with ${name}`} lead={`${name} gets an invite and it happens when they say yes. It stays private.`} onClose={onClose}>
      <div className="lv-opts">
        <Opt icon={Check} title="Be careful" sub="Lowest risk" price={money(COST.safe)} onClick={pick(() => invite(b, "NIGHT", "safe"))} />
        <Opt icon={Warning} title="Just go with it" sub="Free, higher risk" onClick={pick(() => invite(b, "NIGHT", "risky"))} />
      </div>
      <p className="lv-sub" style={{ marginTop: 10 }}>Fictional, text-only game mechanic for adults.</p>
    </Sheet>
  );
  if (type === "ring") return (
    <Sheet title={`Propose to ${name}`} lead="You pay for the ring only if they say yes. Pick the one you can afford." onClose={onClose}>
      <div className="lv-opts">
        {Object.entries(RINGS).map(([tier, [n, aff]]) => (
          <Opt key={tier} icon={Diamond} title={RING_NAMES[tier]} sub={`+${aff} affection`} price={money(n)} disabled={!canAfford(n * 100)} onClick={pick(() => ask(b, "PROPOSE", tier, `You asked ${name} to marry you.`))} />
        ))}
      </div>
    </Sheet>
  );
  if (type === "movein") return (
    <Sheet title={`Take ${name} home`} lead={`${name} moves into your ${me.hostel}. Their rent switches to your home's rate for the rest of the session. They can say no.`} onClose={onClose}>
      <div className="lv-opts">
        <Opt icon={HandHeart} title="I will cover their rent" sub="Your wallet pays the move" onClick={pick(() => ask(b, "MOVEIN", "cover", `Asked ${name} to move in.`))} />
        <Opt icon={HouseLine} title="They pay their own" sub="Each of you pays your own rent" onClick={pick(() => ask(b, "MOVEIN", "own", `Asked ${name} to move in.`))} />
      </div>
    </Sheet>
  );
  if (type === "babe" || type === "sneaky") {
    const babe = type === "babe";
    return (
      <Sheet title={babe ? `Ask ${name} to be your babe` : `Make ${name} your sneaky link`} lead={babe ? "One babe at a time, for both of you. Ask only if you mean it." : "Something quiet on the side. It is secret, but secrets get found out."} onClose={onClose}>
        {!babe && couple && <div className="lv-note"><Warning size={18} weight="fill" /><span>You already have a babe. Each time you link up with {name}, {first(couple.name)} might find out. Caught twice and they leave.</span></div>}
        <button type="button" className="lv-btn primary" onClick={pick(() => ask(b, babe ? "BABE" : "SNEAKY", null, `Asked ${name} to be your ${babe ? "babe" : "sneaky link"}.`))}>
          {babe ? <Heart size={18} weight="fill" /> : <Eye size={18} weight="fill" />}Send the ask
        </button>
      </Sheet>
    );
  }
  return null;
}
// components/admin/Actions.js — every operation an administrator can perform on one player, as a form with a mandatory reason.
// Each form owns ONE request id for its lifetime: a double click or a retry after a lost answer sends the same id, so the server applies it once.
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Btn, Modal, Input, Area, Select, Seg, Note, Badge, kobo, act, useRid, confirmAction, Person, Field } from "./kit";

const INT64 = 9223372036854775807n;
/** What the server accepts, mirrored for instant feedback: exact kobo from text, never a float. Returns { kobo } or { error }. */
export function parseNaira(text, { allowZero = false } = {}) {
  const s = String(text ?? "").trim().replace(/^₦\s*/, "").replace(/[,\s_]/g, "");
  if (!s) return { error: "" };
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: "Use digits only, for example 5000000 or 2500.50." };
  const [w, f = ""] = s.split(".");
  if (f.length > 2) return { error: "At most two decimal places (kobo). Nothing is rounded." };
  const k = BigInt(w) * 100n + BigInt(f.padEnd(2, "0") || "0");
  if (k === 0n && !allowZero) return { error: "Must be greater than zero." };
  if (k > INT64) return { error: "That is more than the database can store (₦92,233,720,368,547,758.07)." };
  return { kobo: k };
}
export const BIG = 1_000_000_000n * 100n; // ₦1,000,000,000: above this the administrator must also type the player's name (a confirmation, not a limit)

function Form({ title, sub, onClose, onDone, children, canSubmit = true, submit, label, tone = "pri", wide }) {
  const [busy, setBusy] = useState(false);
  async function go(e) {
    e?.preventDefault(); if (busy || !canSubmit) return; setBusy(true);
    try { const r = await submit(); if (r && !r.failed) { onDone?.(r); onClose(); } } finally { setBusy(false); }
  }
  return (
    <Modal title={title} sub={sub} onClose={onClose} wide={wide} footer={<><Btn onClick={onClose} disabled={busy}>Cancel</Btn><Btn tone={tone} busy={busy} disabled={!canSubmit} onClick={go}>{label}</Btn></>}>
      <form onSubmit={go} style={{ display: "grid", gap: 14 }}>{children}<button hidden /></form>
    </Modal>
  );
}
const reasonOk = (r) => r.trim().length >= 10;
const Reason = ({ value, onChange, hint = "Recorded in the audit log and shown to other administrators. At least 10 characters." }) => <Area label="Reason" value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} hint={hint} data-autofocus />;

// ------------------------------------------------------------------ money
export function MoneyForm({ p, onClose, onDone, initialMode = "credit" }) {
  const [mode, setMode] = useState(initialMode), [amt, setAmt] = useState(""), [reason, setReason] = useState(""), [msg, setMsg] = useState(""), [notify, setNotify] = useState(true), [typed, setTyped] = useState("");
  const a = parseNaira(amt, { allowZero: mode === "set" }), cur = (() => { try { return BigInt(p.balance ?? 0); } catch { return 0n; } })();
  const next = a.kobo == null ? null : mode === "credit" ? cur + a.kobo : mode === "debit" ? cur - a.kobo : a.kobo;
  const overflow = next != null && next > INT64, short = mode === "debit" && next != null && next < 0n;
  const big = a.kobo != null && (a.kobo >= BIG || (mode === "set" && cur >= BIG)); // very large changes need the player's name typed
  const typedOk = !big || typed.trim().toLowerCase() === String(p.name).toLowerCase();
  const ok = a.kobo != null && !overflow && !short && reasonOk(reason) && typedOk;
  const verb = mode === "credit" ? "Give" : mode === "debit" ? "Deduct" : "Set balance of";
  return (
    <Form title="Change balance" sub={`${p.name} · current balance ${kobo(cur)}`} onClose={onClose} onDone={onDone} canSubmit={ok} label={a.kobo != null ? `${verb} ${kobo(a.kobo)}` : "Apply"} tone={mode === "debit" ? "solid-danger" : "pri"}
      submit={() => act("economy/money", { characterId: p.characterId, mode, amount: String(amt).trim(), reason: reason.trim(), message: msg.trim() || undefined, notify }, { pending: "Applying balance change…", success: "Balance updated." })}>
      <Seg value={mode} onChange={setMode} label="Kind of change" options={[["credit", "Give money"], ["debit", "Deduct money"], ["set", "Set exact balance"]]} />
      <Input label={mode === "set" ? "New balance (₦)" : "Amount (₦)"} inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} error={a.error} hint="No upper limit other than what the database can hold. Typed exactly, never rounded." autoComplete="off" />
      {next != null && <div className="preview"><span className="mut">After this change</span><span className="big num">{short ? "Not enough money" : overflow ? "Over the database limit" : kobo(next)}</span><span className="mut">{mode === "set" ? `Changes the balance by ${kobo(next - cur, { sign: true })}` : `${kobo(cur)} ${mode === "credit" ? "+" : "−"} ${kobo(a.kobo)}`}</span></div>}
      {short && <Note tone="bad">This player only has {kobo(cur)}. A deduction cannot take the balance below zero.</Note>}
      <Reason value={reason} onChange={setReason} />
      <Field label="Message to the player" hint="Optional. They always receive a notice with the amount; this adds your own words.">{(id) => <input id={id} className="inp" maxLength={200} value={msg} onChange={(e) => setMsg(e.target.value)} />}</Field>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />Notify the player</label>
      {big && <Input label={`Type the player's name (${p.name}) to confirm this large change`} value={typed} onChange={(e) => setTyped(e.target.value)} error={typed && !typedOk ? "Does not match" : ""} autoComplete="off" />}
    </Form>
  );
}

// ------------------------------------------------------------------ account
export function SuspendForm({ p, onClose, onDone }) {
  const [kind, setKind] = useState("hours"), [hours, setHours] = useState("24"), [until, setUntil] = useState(""), [reason, setReason] = useState("");
  const body = kind === "indefinite" ? { indefinite: true } : kind === "until" ? { until: until ? new Date(until).toISOString() : "" } : { hours: Number(hours) };
  const ok = reasonOk(reason) && (kind === "indefinite" || (kind === "until" ? !!until : Number.isInteger(Number(hours)) && Number(hours) >= 1));
  return (
    <Form title="Suspend account" sub={`${p.name ?? p.email}: they are signed out at once and cannot log in until it ends.`} onClose={onClose} onDone={onDone} canSubmit={ok} label="Suspend account" tone="solid-danger"
      submit={() => act("moderation/suspend", { ref: p.userId, reason: reason.trim(), ...body }, { pending: "Suspending…", success: "Account suspended." })}>
      <Seg value={kind} onChange={setKind} label="Duration" options={[["hours", "For some hours"], ["until", "Until a date"], ["indefinite", "Until restored"]]} />
      {kind === "hours" && <Input label="Hours" type="number" min="1" value={hours} onChange={(e) => setHours(e.target.value)} hint="24 = one day, 168 = one week, 720 = 30 days." />}
      {kind === "until" && <Input label="Until" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} hint="Your local time." />}
      <Reason value={reason} onChange={setReason} hint="The player sees a short version of this when they try to log in." />
    </Form>
  );
}
export function RestoreForm({ p, onClose, onDone }) {
  const [reason, setReason] = useState("");
  return (
    <Form title={p.status === "DELETED" ? "Restore archived account" : "Lift suspension"} sub={p.name} onClose={onClose} onDone={onDone} canSubmit={reasonOk(reason)} label="Restore account" tone="ok"
      submit={() => act("moderation/restore", { ref: p.userId, reason: reason.trim() }, { pending: "Restoring…", success: "Account restored." })}>
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
}
export function DeleteForm({ p, onClose, onDone }) {
  const [reason, setReason] = useState(""), [typed, setTyped] = useState(""), word = p.name ?? p.email;
  const ok = reasonOk(reason) && typed.trim() === word;
  return (
    <Form title="Delete (archive) account" sub={word} onClose={onClose} onDone={onDone} canSubmit={ok} label="Delete account" tone="solid-danger"
      submit={() => act("moderation/delete", { ref: p.userId, reason: reason.trim(), confirmName: typed.trim() }, { pending: "Archiving account…", success: "Account deleted (archived)." })}>
      <Note tone="warn"><b>What happens:</b> they are signed out and can never log in, and they disappear from search, maps, chat and every leaderboard. Running matches are cancelled and wagers returned. <b>What is kept:</b> the character, the ledger and all history, so the money in the game still adds up. An administrator can restore the account at any time.</Note>
      <Reason value={reason} onChange={setReason} />
      <Input label={`Type ${word} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" error={typed && typed.trim() !== word ? "Does not match" : ""} />
    </Form>
  );
}
export function WarnForm({ p, onClose, onDone }) {
  const [msg, setMsg] = useState("");
  return (
    <Form title="Warn player" sub={`${p.name} receives this as a notice. It is recorded in their history.`} onClose={onClose} onDone={onDone} canSubmit={msg.trim().length >= 10} label="Send warning"
      submit={() => act("moderation/warn", { ref: p.userId, message: msg.trim() }, { pending: "Sending warning…", success: "Warning sent." })}>
      <Area label="Warning" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} data-autofocus hint="At least 10 characters. Written for the player to read." />
    </Form>
  );
}

// ------------------------------------------------------------------ game discipline and repair
const simple = (path, title, label, tone, extra) => function SimpleForm({ p, onClose, onDone }) {
  const [reason, setReason] = useState(""), [hours, setHours] = useState("48");
  return (
    <Form title={title} sub={p.name} onClose={onClose} onDone={onDone} canSubmit={reasonOk(reason) && (!extra?.hours || Number(hours) >= 1)} label={label} tone={tone}
      submit={() => act(path, { ref: p.userId, reason: reason.trim(), ...(extra?.hours ? { hours: Number(hours) } : {}) }, { pending: `${label}…`, success: "Done." })}>
      {extra?.note && <Note>{extra.note}</Note>}
      {extra?.hours && <Input label="Hours" type="number" min="1" value={hours} onChange={(e) => setHours(e.target.value)} />}
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
};
export const GameSuspendForm = simple("moderation/game-suspend", "Suspend from school", "Suspend from school", "solid-danger", { hours: true, note: "An in-game academic suspension. The account still works, but the player is locked out of lectures and school activities." });
export const GameClearForm = simple("moderation/game-suspend-clear", "Lift academic suspension", "Lift suspension", "ok");
export const ExpelForm = simple("moderation/expel", "Expel from school", "Expel player", "solid-danger", { note: "Expels the character for the game's standard period; they restart at the lowest level when they return." });
export const ReinstateForm = simple("moderation/reinstate", "Reinstate player", "Reinstate player", "ok");
export const ReleaseForm = simple("moderation/release", "Release from custody", "Release from custody", "ok", { note: "Frees the player from Floor O. Any bill is cancelled without charging them." });

export function ResetForm({ p, onClose, onDone }) {
  const KEYS = [["health", "Health → 80"], ["energy", "Energy → 90"], ["happiness", "Happiness → 60"], ["academics", "Academics → 40"], ["popularity", "Popularity → 10"], ["suspicion", "Suspicion → 0"], ["strikes", "Strikes → 0"], ["failedSessions", "Failed sessions → 0"]];
  const [sel, setSel] = useState([]), [reason, setReason] = useState("");
  const tog = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  return (
    <Form title="Reset attributes" sub={`${p.name}: restores the chosen values to the game's starting defaults.`} onClose={onClose} onDone={onDone} canSubmit={sel.length > 0 && reasonOk(reason)} label={`Reset ${sel.length || ""} attribute${sel.length === 1 ? "" : "s"}`}
      submit={() => act("moderation/reset", { ref: p.userId, fields: sel, reason: reason.trim() }, { pending: "Resetting…", success: "Attributes reset." })}>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>{KEYS.map(([k, l]) => <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={sel.includes(k)} onChange={() => tog(k)} />{l}</label>)}</div>
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
}
export function EditForm({ p, onClose, onDone }) {
  const c = p.character ?? {}, F = [["health", "Health", 0, 100], ["energy", "Energy", 0, 100], ["happiness", "Happiness", 0, 100], ["academics", "Academics", 0, 100], ["popularity", "Popularity", 0, 100], ["suspicion", "Suspicion", 0, 100], ["strikes", "Strikes", 0, 20], ["failedSessions", "Failed sessions", 0, 2]];
  const [v, setV] = useState({}), [reason, setReason] = useState(""), val = (k) => v[k] ?? c[k] ?? "";
  const changed = useMemo(() => Object.fromEntries(Object.entries(v).filter(([k, x]) => String(x) !== String(c[k] ?? "")).map(([k, x]) => [k, k === "hostel" || k === "jobKey" ? x : Number(x)])), [v, c]);
  const n = Object.keys(changed).length;
  return (
    <Form title="Edit character" sub={`${p.name}: only supported properties, each checked against the game's own range.`} wide onClose={onClose} onDone={onDone} canSubmit={n > 0 && reasonOk(reason)} label={`Save ${n || ""} change${n === 1 ? "" : "s"}`}
      submit={() => act("moderation/edit", { ref: p.userId, set: changed, reason: reason.trim() }, { pending: "Saving…", success: "Character updated." })}>
      <div className="row">{F.map(([k, l, lo, hi]) => <Input key={k} label={`${l} (${lo}–${hi})`} type="number" min={lo} max={hi} value={val(k)} onChange={(e) => setV({ ...v, [k]: e.target.value })} />)}
        <Select label="Level" value={String(val("level"))} onChange={(x) => setV({ ...v, level: x })} options={[100, 200, 300, 400, 500].map((l) => [String(l), `${l}L`])} />
        <Input label="Home (hostel id)" value={val("hostel")} onChange={(e) => setV({ ...v, hostel: e.target.value })} hint="Checked against what this player can live in." />
        <Input label="Job key (empty removes it)" value={val("jobKey") ?? ""} onChange={(e) => setV({ ...v, jobKey: e.target.value })} /></div>
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
}
const FIXES = [["travel", "Clear a stuck trip"], ["position", "Send to their home (clears map and building position)"], ["activity", "Cancel a stuck activity, job shift or hustle"], ["sleep", "Wake from sleep"], ["match", "Void any running match (wagers returned)"], ["energy", "Refill energy to 100"]];
export function FixForm({ p, onClose, onDone }) {
  const [fix, setFix] = useState("travel"), [reason, setReason] = useState("");
  return (
    <Form title="Fix a stuck state" sub={p.name} onClose={onClose} onDone={onDone} canSubmit={reasonOk(reason)} label="Apply fix"
      submit={() => act("moderation/fix", { ref: p.userId, fix, reason: reason.trim() }, { pending: "Applying fix…", success: "Fixed." })}>
      <Select label="What is wrong?" value={fix} onChange={setFix} options={FIXES} />
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
}
export function ForbesForm({ p, onClose, onDone, restore }) {
  const [reason, setReason] = useState("");
  return (
    <Form title={restore ? "Restore to Forbes OAU" : "Remove from Forbes OAU"} sub={p.name} onClose={onClose} onDone={onDone} canSubmit={reasonOk(reason)} label={restore ? "Restore to the board" : "Remove from the board"} tone={restore ? "ok" : "solid-danger"}
      submit={() => act(restore ? "forbes/restore" : "forbes/exclude", { characterId: p.characterId, reason: reason.trim() }, { pending: "Updating Forbes…", success: restore ? "Back on the eligible list." : "Removed from Forbes." })}>
      <Note>{restore ? "They become eligible again and rank by their real net worth." : "Their money, businesses and progress are untouched. Automatic re-ranking will never put them back; only restoring does."}</Note>
      <Reason value={reason} onChange={setReason} />
    </Form>
  );
}

export const FORMS = { money: MoneyForm, suspend: SuspendForm, restore: RestoreForm, delete: DeleteForm, warn: WarnForm, gameSuspend: GameSuspendForm, gameClear: GameClearForm, expel: ExpelForm, reinstate: ReinstateForm, release: ReleaseForm, reset: ResetForm, edit: EditForm, fix: FixForm, forbesOut: (p) => <ForbesForm {...p} />, forbesIn: (p) => <ForbesForm {...p} restore /> };

/** Build the player object the action forms need from a /player response. */
export function actionPlayer(d) {
  const a = d.account, c = d.character, fut = (x) => x && +new Date(x) > Date.now();
  return { userId: a.userId, characterId: c?.id, name: c?.name ?? a.email, email: a.email, status: a.status, hasCharacter: !!c, isAdmin: a.role === "ADMIN", balance: d.balance, character: c,
    expelled: !!c?.expelled && (!c.expelledUntil || fut(c.expelledUntil)), jailed: !!fut(c?.jailedUntil), gameSuspended: !!fut(c?.suspendedUntil), forbesExcluded: !!d.forbes?.excluded };
}

/** Which actions make sense for this player right now. p = { userId, characterId, name, status, hasCharacter, isAdmin, expelled, jailed, gameSuspended, forbesExcluded } */
export function actionsFor(p) {
  if (p.isAdmin) return [];
  const gone = p.status === "DELETED", susp = p.status === "SUSPENDED", ch = p.hasCharacter && !gone;
  return [
    ch && { id: "money", label: "Change balance", group: "Economy" },
    p.hasCharacter && !p.forbesExcluded && !gone && { id: "forbesOut", label: "Remove from Forbes", group: "Economy" },
    p.hasCharacter && p.forbesExcluded && { id: "forbesIn", label: "Restore to Forbes", group: "Economy" },
    !gone && { id: "warn", label: "Warn", group: "Moderation" },
    !gone && !susp && { id: "suspend", label: "Suspend account", group: "Moderation", tone: "danger" },
    (susp || gone) && { id: "restore", label: gone ? "Restore account" : "Lift suspension", group: "Moderation", tone: "ok" },
    !gone && { id: "delete", label: "Delete account", group: "Moderation", tone: "danger" },
    ch && !p.gameSuspended && { id: "gameSuspend", label: "Suspend from school", group: "Game discipline" },
    ch && p.gameSuspended && { id: "gameClear", label: "Lift school suspension", group: "Game discipline" },
    ch && !p.expelled && { id: "expel", label: "Expel", group: "Game discipline", tone: "danger" },
    ch && p.expelled && { id: "reinstate", label: "Reinstate", group: "Game discipline" },
    ch && p.jailed && { id: "release", label: "Release from custody", group: "Game discipline" },
    ch && { id: "edit", label: "Edit character", group: "Repair" }, ch && { id: "reset", label: "Reset attributes", group: "Repair" }, ch && { id: "fix", label: "Fix stuck state", group: "Repair" },
  ].filter(Boolean);
}

/** The button row plus whichever form is open. onChange is called after any successful change so the page can reload. */
export function PlayerActions({ p, onChange, compact }) {
  const [open, setOpen] = useState(null), list = actionsFor(p), router = useRouter();
  if (p.isAdmin) return <Badge tone="info">Administrator: protected from admin actions</Badge>;
  if (!list.length) return null;
  const Form_ = open ? FORMS[open] : null;
  return (
    <>
      <div className="chips">{list.map((a) => <Btn key={a.id} size="sm" tone={a.tone} onClick={() => setOpen(a.id)}>{a.label}</Btn>)}</div>
      {Form_ && <Form_ p={p} onClose={() => setOpen(null)} onDone={() => onChange?.()} />}
    </>
  );
}

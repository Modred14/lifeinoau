// components/SettingsScreen.js
// The player's Settings: profile, character & appearance, account, gameplay, audio, notifications, privacy & security, accessibility.
// A full-screen page opened by Shell (event "oau:settings", sent by the phone's Settings icon). Everything shown here is real:
//   - the profile, the saved appearance and the preferences are read from /api/settings and saved back to the database through it;
//   - preferences are previewed live and kept only when "Save changes" succeeds; the character is previewed in 3D and kept only on "Apply";
//   - what the game decides (class, level, faculty, money...) is shown as read-only.
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import Loader from "./Loader";
import PlayerAvatar from "./PlayerAvatar";
import { avatarDirectory } from "@/lib/avatarClient";
import { call, naira, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { game } from "@/lib/gameStore";
import { applyPrefs } from "@/lib/prefs";
import { MUSIC } from "@/lib/sound";
import { SETTING_DEFAULTS, cleanSettings, sameSettings } from "@/lib/settings";
import { SKIN_TONES, HAIR, HEIGHTS, adaptLook, cleanLook, lookKey, label } from "@/lib/look";
import { NAME_RE, NAME_RULE, cleanName, hostelForGender } from "@/lib/profileRules";
import "./settings-screen.css";

const CharacterViewer = dynamic(() => import("./CharacterViewer"), { ssr: false, loading: () => <div className="stage" style={{ height: "100%" }} aria-busy="true" /> });

const TABS = [
  ["profile", "My Profile", "person", "Who you are in the game"],
  ["character", "Character & Appearance", "sparkle", "Body, hair and clothes"],
  ["account", "Account", "driver", "Email and login"],
  ["gameplay", "Gameplay", "game", "Camera and name tags"],
  ["audio", "Audio", "sound", "Music and sound effects"],
  ["notifications", "Notifications", "bell", "Pop-ups and alerts"],
  ["privacy", "Privacy & Security", "shield", "Who can find you, password"],
  ["accessibility", "Accessibility", "eye", "Motion, text and contrast"],
];
const PREF_TABS = ["gameplay", "audio", "notifications", "privacy", "accessibility"];
const HEIGHT_LABEL = { short: "Short", average: "Average", tall: "Tall" };
const STAT_LABEL = [["health", "Health"], ["energy", "Energy"], ["happiness", "Happiness"], ["academics", "Academics"], ["popularity", "Popularity"]];
const when = (iso) => new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });

/* ---------------------------------- small pieces ---------------------------------- */

function Card({ title, note, icon, children, tone }) {
  return (
    <section className="sx-card" data-tone={tone}>
      {(title || note) && (
        <header className="sx-cardhead">
          {icon && <span className="sx-cardico" aria-hidden="true"><Icon name={icon} size={20} weight="fill" /></span>}
          <span><h3>{title}</h3>{note && <p>{note}</p>}</span>
        </header>
      )}
      {children}
    </section>
  );
}

/** One row with an on/off switch (a real checkbox with role="switch", so keyboards and screen readers work). */
function Toggle({ title, note, checked, onChange, disabled }) {
  return (
    <label className="sx-row" data-disabled={disabled ? "1" : undefined} data-sound="none">
      <span className="sx-rowtxt"><b>{title}</b>{note && <small>{note}</small>}</span>
      <input type="checkbox" role="switch" className="sx-in" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sx-track" aria-hidden="true" />
    </label>
  );
}

function Slider({ id, title, value, onChange, disabled }) {
  return (
    <div className="sx-slider" data-disabled={disabled ? "1" : undefined}>
      <label htmlFor={id}>{title}</label>
      <input id={id} type="range" min="0" max="100" step="5" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={`${value} percent`} />
      <output htmlFor={id} className="num">{value}%</output>
    </div>
  );
}

function Field({ title, value, children }) {
  return (
    <div className="sx-field">
      <div className="sx-fieldhead"><h4>{title}</h4>{value && <span>{value}</span>}</div>
      {children}
    </div>
  );
}

const Swatches = ({ map, value, onPick, name, disabled }) => (
  <div className="sx-swatches" role="group" aria-label={name}>
    {Object.entries(map).map(([k, hex]) => (
      <button key={k} type="button" className="sx-swatch" style={{ "--sw": hex }} aria-pressed={value === k} aria-label={label(k)} title={label(k)} disabled={disabled} onClick={() => onPick(k)}>
        <Icon name="check" size={16} weight="bold" />
      </button>
    ))}
  </div>
);

const Chips = ({ items, value, onPick, name, text = label }) => (
  <div className="sx-chips" role="group" aria-label={name}>
    {items.map((k) => <button key={k} type="button" className="sx-chip" aria-pressed={value === k} onClick={() => onPick(k)}>{text(k)}</button>)}
  </div>
);

const Fact = ({ k, v, system }) => (
  <div className="sx-fact"><dt>{k}{system && <Icon name="lockS" size={12} weight="fill" label="Set by the game" />}</dt><dd>{v}</dd></div>
);

/** A message under a form: busy / ok / error. */
const Status = ({ s }) => (s ? <p className="sx-status" data-kind={s.kind} role={s.kind === "error" ? "alert" : "status"}>{s.text}</p> : null);

/* ---------------------------------- the screen ---------------------------------- */

export default function SettingsScreen({ onClose, onLogout, loggingOut }) {
  const router = useRouter();
  const [tab, setTab] = useState("profile");
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [draft, setDraft] = useState(null); // preferences being edited
  const [save, setSave] = useState(null); // { kind: "busy" | "ok" | "error", text }
  const [look, setLook] = useState(null); // { gender, look } being previewed
  const [lookSave, setLookSave] = useState(null);
  const [edit, setEdit] = useState(null); // { name } while renaming
  const [nameSave, setNameSave] = useState(null);
  const root = useRef(null), opener = useRef(typeof document === "undefined" ? null : document.activeElement), main = useRef(null);

  const adopt = useCallback((r) => { setData(r); setDraft(cleanSettings(r.settings)); setLook({ gender: r.profile.gender, look: r.profile.look }); }, []);
  const load = useCallback(async () => {
    setLoadErr(null);
    const r = await call("/api/settings");
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return setLoadErr(r.error || "We could not load your settings. Check your connection.");
    adopt(r);
  }, [adopt, router]);
  useEffect(() => { load(); }, [load]);

  const saved = data?.settings ?? SETTING_DEFAULTS;
  const prefsDirty = !!draft && !sameSettings(draft, saved);
  const lookDirty = !!look && !!data && lookKey(look.look, look.gender) !== data.profile.lookKey;
  const nameDirty = !!edit && cleanName(edit.name) !== data?.profile.name;
  const anyDirty = prefsDirty || lookDirty || nameDirty;

  // preferences are previewed live as they are changed; leaving without saving puts the saved ones back (see close below)
  // (only while they differ from the saved ones, so merely opening Settings never undoes a quick mute from the sound button)
  useEffect(() => { if (draft && prefsDirty) applyPrefs(draft, { cache: false }); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = useCallback(async () => {
    if (anyDirty && !(await confirmAction({ title: "Discard unsaved changes?", message: "Some of your changes have not been saved. They will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" }))) return;
    if (prefsDirty) applyPrefs(saved); // unsaved previews are put back to what is saved
    onClose();
  }, [anyDirty, prefsDirty, saved, onClose]);

  // Escape closes (unless a dialog or a field is handling it); focus starts inside the screen and goes back to where it was
  useEffect(() => {
    root.current?.focus();
    const back = opener.current;
    return () => { if (back && document.contains(back)) back.focus?.(); };
  }, []);
  useEffect(() => {
    const k = (e) => { if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".cd")) return; e.preventDefault(); close(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [close]);
  useEffect(() => { main.current?.scrollTo?.({ top: 0 }); }, [tab]);

  // a leaving page with unsaved work asks the browser to warn
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);

  /** Every save goes through here: one request, a clear message, a 401 sends the player to log in. */
  const post = useCallback(async (body) => {
    const r = await call("/api/settings", body);
    if (r.status === 401) { loggedOut(router); return null; }
    return r;
  }, [router]);
  const patchGame = (fn) => { game.pushDone((s) => (s ? { ...s, character: fn(s.character) } : s)); window.dispatchEvent(new Event("game:refresh")); };

  /* ---- preferences ---- */
  const setPref = (group, key) => (value) => setDraft((d) => ({ ...d, [group]: { ...d[group], [key]: value } }));
  async function savePrefs() {
    setSave({ kind: "busy", text: "Saving…" });
    const r = await post({ action: "preferences", settings: draft });
    if (!r) return;
    if (r.failed) return setSave({ kind: "error", text: r.error || "Could not save. Check your connection and try again." });
    setData((d) => ({ ...d, settings: r.settings })); setDraft(cleanSettings(r.settings));
    patchGame((c) => ({ ...c, settings: r.settings }));
    setSave({ kind: "ok", text: "Saved. Your settings follow you to any device." });
    setTimeout(() => setSave((s) => (s?.kind === "ok" ? null : s)), 3000);
  }
  const discardPrefs = () => { setDraft(cleanSettings(saved)); applyPrefs(saved); setSave(null); };

  /* ---- character ---- */
  const g = look?.gender, lk = look?.look;
  const pickGender = (next) => { if (next === g) return; setLook({ gender: next, look: adaptLook(lk, next) }); setLookSave(null); };
  const setLookKey = (k) => (v) => { setLook((l) => ({ ...l, look: { ...l.look, [k]: v } })); setLookSave(null); };
  const hallMove = look && data && g !== data.profile.gender ? { from: data.profile.hostel, to: hostelForGender(data.profile.hostel, g) } : null;
  async function applyLook() {
    setLookSave({ kind: "busy", text: "Saving your character…" });
    const r = await post({ action: "appearance", gender: g, look: lk });
    if (!r) return;
    if (r.failed) return setLookSave({ kind: "error", text: r.error || "Could not save your character. Try again." });
    setData((d) => ({ ...d, profile: { ...d.profile, gender: r.gender, look: r.look, lookKey: r.lookKey, hostel: r.hostel } }));
    setLook({ gender: r.gender, look: r.look });
    // every screen reads the character from the game state: put the saved look there at once, then ask the server again
    patchGame((c) => ({ ...c, gender: r.gender, look: r.look, hostel: r.hostel }));
    avatarDirectory.seed(data.profile.name, r.gender, r.look, r.lookKey); // every profile picture of this player (messages, leaderboards, home...) is redrawn from the new look
    setLookSave({ kind: "ok", text: r.hostelMoved ? `Saved. Your room moved from ${r.previousHostel} to ${r.hostel}.` : "Saved. Your character looks like this everywhere in the game." });
    toast.success("Character updated.");
  }
  const cancelLook = () => { setLook({ gender: data.profile.gender, look: data.profile.look }); setLookSave(null); };

  /* ---- name ---- */
  const nameClean = edit ? cleanName(edit.name) : "";
  const nameBad = edit && nameClean && !NAME_RE.test(nameClean);
  async function saveName() {
    setNameSave({ kind: "busy", text: "Saving…" });
    const r = await post({ action: "name", name: nameClean });
    if (!r) return;
    if (r.failed) return setNameSave({ kind: "error", text: r.error || "Could not change your name." });
    setData((d) => ({ ...d, profile: { ...d.profile, name: r.name }, editable: { ...d.editable, nameChangeAvailableAt: r.changed ? new Date(Date.now() + 7 * 864e5).toISOString() : d.editable.nameChangeAvailableAt } }));
    patchGame((c) => ({ ...c, name: r.name }));
    if (r.changed) { avatarDirectory.forget(data.profile.name); avatarDirectory.seed(r.name, data.profile.gender, data.profile.look, data.profile.lookKey); } // the old name no longer exists; the new one keeps the same look
    setEdit(null); setNameSave(null);
    if (r.changed) toast.success("Your name was changed.");
  }

  /* ---- account: email and password ---- */
  const [mail, setMail] = useState({ open: false, email: "", pw: "" }), [mailSave, setMailSave] = useState(null);
  const [pw, setPw] = useState({ cur: "", next: "", again: "" }), [pwSave, setPwSave] = useState(null);
  async function saveMail() {
    setMailSave({ kind: "busy", text: "Saving…" });
    const r = await post({ action: "email", email: mail.email, password: mail.pw });
    if (!r) return;
    if (r.failed) return setMailSave({ kind: "error", text: r.error || "Could not change your email." });
    setData((d) => ({ ...d, profile: { ...d.profile, email: r.email } }));
    setMail({ open: false, email: "", pw: "" }); setMailSave(null); toast.success("Email updated.");
  }
  async function savePw() {
    if (pw.next !== pw.again) return setPwSave({ kind: "error", text: "The two new passwords do not match." });
    if (pw.next.length < 8) return setPwSave({ kind: "error", text: "The new password must be at least 8 characters." });
    setPwSave({ kind: "busy", text: "Saving…" });
    const r = await post({ action: "password", current: pw.cur, next: pw.next });
    if (!r) return;
    if (r.failed) return setPwSave({ kind: "error", text: r.error || "Could not change your password." });
    setPw({ cur: "", next: "", again: "" }); setPwSave({ kind: "ok", text: "Password changed. Use it next time you log in." });
  }

  /* ---- blocked players ---- */
  const [busyBlock, setBusyBlock] = useState(null);
  async function unblock(name) {
    setBusyBlock(name);
    const r = await post({ action: "unblock", name });
    setBusyBlock(null);
    if (!r) return;
    if (r.failed) return toast.error(r.error || "Could not unblock them.");
    setData((d) => ({ ...d, blocked: d.blocked.filter((n) => n !== name) })); toast.success(`${name} is unblocked.`);
  }

  const p = data?.profile;
  const savedPic = useMemo(() => (p ? { name: p.name, gender: p.gender, look: p.look, key: p.lookKey } : null), [p?.name, p?.gender, p?.lookKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const tabInfo = TABS.find((t) => t[0] === tab);
  const badge = useMemo(() => ({ character: lookDirty, profile: nameDirty, audio: prefsDirty && tab === "audio" }), [lookDirty, nameDirty, prefsDirty, tab]);

  /* ---------------------------------- sections ---------------------------------- */

  const sections = {
    profile: p && (
      <>
        <div className="sx-hero">
          <div className="sx-heroview" aria-label="Your character">
            <CharacterViewer look={p.look} gender={p.gender} />
          </div>
          <div className="sx-herotxt">
            <div className="sx-idrow">
              <PlayerAvatar name={p.name} size={56} look={savedPic} className="sx-pic" />
              <p className="sx-eyebrow">Player #{p.id}</p>
            </div>
            <h2>{p.name}</h2>
            <p className="mut">{p.gender === "F" ? "Woman" : "Man"} · {p.faculty.replace(/^Faculty of /, "")} · {p.level}L</p>
            <div className="sx-tags">
              <span>{p.class}</span>
              {p.office && <span>{p.office}</span>}
              {p.graduated && <span>Graduated{p.classification ? `, ${p.classification}` : ""}</span>}
              {p.personalities?.map((x) => <span key={x}>{x}</span>)}
            </div>
            <div className="sx-heroact">
              <button type="button" className="go" onClick={() => setTab("character")}><Icon name="sparkle" size={18} weight="fill" /> Change look</button>
            </div>
          </div>
        </div>

        <Card title="Your name" note="This is the name other players see. You can change it once a week." icon="person">
          {edit ? (
            <form className="sx-form" onSubmit={(e) => { e.preventDefault(); if (nameDirty && !nameBad) saveName(); }}>
              <label className="sx-label" htmlFor="sx-name">Character name</label>
              <input id="sx-name" type="text" value={edit.name} maxLength={20} autoComplete="off" autoFocus aria-invalid={!!nameBad} aria-describedby="sx-name-h" onChange={(e) => { setEdit({ name: e.target.value }); setNameSave(null); }} />
              <span id="sx-name-h" className={"sx-help" + (nameBad ? " bad" : "")}>{NAME_RULE}</span>
              <Status s={nameSave} />
              <div className="sx-btns">
                <button type="submit" className="go" disabled={!nameDirty || !!nameBad || !nameClean || nameSave?.kind === "busy"}>{nameSave?.kind === "busy" ? "Saving…" : "Save name"}</button>
                <button type="button" onClick={() => { setEdit(null); setNameSave(null); }}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="sx-inline">
              <b className="sx-big">{p.name}</b>
              <button type="button" disabled={!!data.editable.nameChangeAvailableAt} onClick={() => setEdit({ name: p.name })}><Icon name="wrench" size={16} /> Edit name</button>
              {data.editable.nameChangeAvailableAt && <small className="mut">You can change it again on {when(data.editable.nameChangeAvailableAt)}.</small>}
            </div>
          )}
        </Card>

        <Card title="Set by the game" note="You cannot edit these. They change as you play." icon="lockS">
          <dl className="sx-facts">
            <Fact system k="Player ID" v={`#${p.id}`} />
            <Fact system k="Class" v={p.class} />
            <Fact system k="Faculty" v={p.faculty} />
            <Fact system k="Level" v={`${p.level}L`} />
            <Fact system k="Home" v={p.hostel || "Not chosen yet"} />
            <Fact system k="Transport" v={p.transport} />
            <Fact system k="CGPA" v={p.cgpa ?? "–"} />
            <Fact system k="Net worth" v={naira(p.netWorthKobo)} />
            <Fact system k="Relationship" v={p.relationship ?? "Single"} />
            <Fact system k="Joined" v={when(p.joined)} />
          </dl>
        </Card>

        <Card title="Your stats" icon="health">
          <ul className="sx-stats">
            {STAT_LABEL.map(([k, name]) => (
              <li key={k}><span>{name}</span><span className="sx-bar" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.stats[k]}><i style={{ width: `${Math.max(0, Math.min(100, p.stats[k]))}%` }} /></span><b className="num">{p.stats[k]}</b></li>
            ))}
          </ul>
        </Card>

        <Card title="Achievements" note={p.achievements?.length ? `${p.achievements.length} earned` : "None yet. Keep playing."} icon="medal">
          {p.achievements?.length > 0 && <div className="sx-tags">{p.achievements.map((a) => <span key={a} data-gold="1">{a}</span>)}</div>}
        </Card>
      </>
    ),

    character: look && (
      <div className="sx-char">
        <div className="sx-charview">
          <div className="sx-viewbox" aria-label="Character preview"><CharacterViewer look={lk} gender={g} /></div>
          <div className="sx-caption"><b>{p.name}</b><span className="mut">{g === "F" ? "Woman" : "Man"}, {label(lk.hair).toLowerCase()} hair, {lk.wear ? "Offishall" : label(lk.outfit).toLowerCase()} outfit</span>
            {lookDirty && <em>Preview. Not saved yet.</em>}</div>
        </div>
        <div className="sx-charpanel">
          <Card title="Body" note="Switch whenever you like. Your level, money, progress and everything else stay exactly as they are." icon="person">
            <div className="sx-seg" role="group" aria-label="Body">
              {[["F", "Woman"], ["M", "Man"]].map(([k, name]) => (
                <button key={k} type="button" aria-pressed={g === k} disabled={!!data.editable.genderBlock && k !== data.profile.gender} onClick={() => pickGender(k)}>{name}</button>
              ))}
            </div>
            {data.editable.genderBlock && <p className="sx-note" role="note"><Icon name="lockS" size={14} weight="fill" /> {data.editable.genderBlock}</p>}
            {hallMove && hallMove.from !== hallMove.to && <p className="sx-note" role="note"><Icon name="hostel" size={14} weight="fill" /> Your hall will move from {hallMove.from} to {hallMove.to}. Rent and room size stay the same.</p>}
            {g !== data.profile.gender && <p className="sx-note" role="note"><Icon name="sparkle" size={14} weight="fill" /> Hair and other options that do not exist for this body are swapped for the nearest match. You can change them below.</p>}
          </Card>
          <Card title="Look" icon="sparkle">
            <Field title="Skin tone" value={label(lk.skin)}><Swatches map={SKIN_TONES} value={lk.skin} onPick={setLookKey("skin")} name="Skin tone" /></Field>
            <Field title="Hairstyle" value={label(lk.hair)}><Chips items={HAIR[g]} value={lk.hair} onPick={setLookKey("hair")} name="Hairstyle" /></Field>
            <Field title="Height" value={HEIGHT_LABEL[lk.height]}><Chips items={HEIGHTS} value={lk.height} onPick={setLookKey("height")} name="Height" text={(k) => HEIGHT_LABEL[k]} /></Field>
          </Card>
          <Card title="Clothes" icon="bag">
            <p className="sx-note" role="note"><Icon name="shirt" size={14} weight="fill" /> Clothes now come from the Offishall Store on your phone. Everything you buy is kept in your wardrobe, and you can change outfits there whenever you like.</p>
          </Card>
        </div>
        <div className="sx-bar-fixed" data-show={lookDirty || lookSave ? "1" : undefined}>
          <Status s={lookSave} />
          <div className="sx-btns">
            <button type="button" onClick={cancelLook} disabled={!lookDirty || lookSave?.kind === "busy"}>Cancel</button>
            <button type="button" className="go" onClick={applyLook} disabled={!lookDirty || lookSave?.kind === "busy"}>{lookSave?.kind === "busy" ? "Saving…" : "Apply & save"}</button>
          </div>
        </div>
      </div>
    ),

    account: p && (
      <>
        <Card title="Login" note="The details you sign in with." icon="driver">
          <dl className="sx-facts">
            <Fact k="Email" v={p.email} />
            <Fact system k="Player ID" v={`#${p.id}`} />
            <Fact system k="Account created" v={when(p.joined)} />
            <Fact k="Character name" v={<>{p.name} <button type="button" className="sx-link" onClick={() => setTab("profile")}>Edit</button></>} />
          </dl>
          {mail.open ? (
            <form className="sx-form" onSubmit={(e) => { e.preventDefault(); saveMail(); }}>
              <label className="sx-label" htmlFor="sx-mail">New email</label>
              <input id="sx-mail" type="email" autoComplete="email" value={mail.email} onChange={(e) => setMail({ ...mail, email: e.target.value })} />
              <label className="sx-label" htmlFor="sx-mailpw">Your password</label>
              <input id="sx-mailpw" type="password" autoComplete="current-password" value={mail.pw} onChange={(e) => setMail({ ...mail, pw: e.target.value })} />
              <Status s={mailSave} />
              <div className="sx-btns">
                <button type="submit" className="go" disabled={!mail.email || !mail.pw || mailSave?.kind === "busy"}>{mailSave?.kind === "busy" ? "Saving…" : "Change email"}</button>
                <button type="button" onClick={() => { setMail({ open: false, email: "", pw: "" }); setMailSave(null); }}>Cancel</button>
              </div>
            </form>
          ) : <div className="sx-btns"><button type="button" onClick={() => setMail({ ...mail, open: true })}><Icon name="send" size={16} /> Change email</button></div>}
        </Card>
        <Card title="Session" note="Leave the game on this device." icon="logout">
          <div className="sx-btns"><button type="button" className="danger" disabled={loggingOut} onClick={onLogout}><Icon name="logout" size={18} /> {loggingOut ? "Logging out…" : "Log out"}</button></div>
        </Card>
      </>
    ),

    gameplay: draft && (
      <Card title="In the world" note="How the game looks and starts for you." icon="game">
        <div className="sx-row sx-rowselect">
          <span className="sx-rowtxt"><b>Camera inside buildings</b><small>The view you start with. You can switch at any time with the camera button.</small></span>
          <select aria-label="Camera inside buildings" value={draft.gameplay.interiorView} onChange={(e) => setPref("gameplay", "interiorView")(e.target.value)}>
            <option value="follow">Close view (behind you)</option>
            <option value="overhead">Top view</option>
          </select>
        </div>
        <Toggle title="Show player name tags" note="Names above other real players. Turn off for a cleaner view; you can still find players in Messages." checked={draft.gameplay.nameTags} onChange={setPref("gameplay", "nameTags")} />
      </Card>
    ),

    audio: draft && (
      <Card title="Sound" note="Your choice is saved to your account." icon="sound">
        <Toggle title="Background music" note={`${MUSIC.title} · ${MUSIC.artist}`} checked={draft.audio.music} onChange={setPref("audio", "music")} />
        <Slider id="sx-music" title="Music volume" value={draft.audio.musicVolume} disabled={!draft.audio.music} onChange={setPref("audio", "musicVolume")} />
        <Toggle title="Sound effects" note="Taps, clicks and alerts" checked={draft.audio.sfx} onChange={setPref("audio", "sfx")} />
        <Slider id="sx-sfx" title="Effects volume" value={draft.audio.sfxVolume} disabled={!draft.audio.sfx} onChange={setPref("audio", "sfxVolume")} />
        <p className="sx-foot">{!draft.audio.music && !draft.audio.sfx ? "The game is silent." : "Changes play at once so you can hear them."} Browsers start sound after your first tap.</p>
      </Card>
    ),

    notifications: draft && (
      <Card title="Pop-ups and alerts" note="Messages always show their unread badge on the phone." icon="bell">
        <Toggle title="Achievement pop-ups" note="A message when you unlock an award. Awards are still saved in Awards." checked={draft.notifications.achievements} onChange={setPref("notifications", "achievements")} />
        <Toggle title="Alert sound" note="The chime that comes with game alerts" checked={draft.notifications.alertSound} onChange={setPref("notifications", "alertSound")} />
      </Card>
    ),

    privacy: draft && data && (
      <>
        <Card title="Who can see what" icon="shield">
          <Toggle title="Show my relationship status" note="Whether your profile says you are single, dating or engaged." checked={draft.privacy.showRelationship} onChange={setPref("privacy", "showRelationship")} />
          <Toggle title="Appear in player search" note="When off, other players cannot find you by typing your name. They can still message you if they already know it." checked={draft.privacy.searchable} onChange={setPref("privacy", "searchable")} />
        </Card>
        <Card title="Blocked players" note={data.blocked.length ? "They cannot message you, and you do not see each other in the world." : "You have not blocked anyone."} icon="block">
          {data.blocked.length > 0 && (
            <ul className="sx-list">
              {data.blocked.map((n) => <li key={n}><span>{n}</span><button type="button" disabled={busyBlock === n} onClick={() => unblock(n)}>{busyBlock === n ? "…" : "Unblock"}</button></li>)}
            </ul>
          )}
        </Card>
        <Card title="Change password" note="Use at least 8 characters. Other devices stay signed in until their login expires." icon="lock">
          <form className="sx-form" onSubmit={(e) => { e.preventDefault(); savePw(); }}>
            <label className="sx-label" htmlFor="sx-pw0">Current password</label>
            <input id="sx-pw0" type="password" autoComplete="current-password" value={pw.cur} onChange={(e) => setPw({ ...pw, cur: e.target.value })} />
            <label className="sx-label" htmlFor="sx-pw1">New password</label>
            <input id="sx-pw1" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            <label className="sx-label" htmlFor="sx-pw2">New password again</label>
            <input id="sx-pw2" type="password" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
            <Status s={pwSave} />
            <div className="sx-btns"><button type="submit" className="go" disabled={!pw.cur || !pw.next || !pw.again || pwSave?.kind === "busy"}>{pwSave?.kind === "busy" ? "Saving…" : "Change password"}</button></div>
          </form>
        </Card>
      </>
    ),

    accessibility: draft && (
      <Card title="Comfort" note="These apply to the whole game straight away." icon="eye">
        <Toggle title="Reduce motion" note="Stops sliding and fading effects, and the turning character preview." checked={draft.accessibility.reduceMotion} onChange={setPref("accessibility", "reduceMotion")} />
        <Toggle title="Larger text" note="Makes writing about a fifth bigger everywhere." checked={draft.accessibility.largeText} onChange={setPref("accessibility", "largeText")} />
        <Toggle title="High contrast" note="Brighter text, stronger borders and focus outlines." checked={draft.accessibility.highContrast} onChange={setPref("accessibility", "highContrast")} />
        <Toggle title="Spin the character preview" note="The character turns by itself while you look at it. You can always drag to turn it." checked={draft.accessibility.autoSpin} onChange={setPref("accessibility", "autoSpin")} disabled={draft.accessibility.reduceMotion} />
      </Card>
    ),
  };

  return (
    <div className="sx" ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Settings">
      <header className="sx-top">
        <button type="button" className="sx-close" onClick={close} aria-label="Close settings" data-sound="close"><Icon name="back" size={22} weight="bold" /></button>
        <h1>Settings</h1>
        <span className="sx-sp" />
        {p && <span className="sx-who" aria-hidden="true">{p.name}</span>}
      </header>
      <div className="sx-body">
        <nav className="sx-nav" aria-label="Settings sections">
          {TABS.map(([id, name, icon, sub]) => (
            <button key={id} type="button" className="sx-tab" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              <span className="sx-tabico"><Icon name={icon} size={20} weight={tab === id ? "fill" : "regular"} /></span>
              <span className="sx-tabtxt"><b>{name}</b><small>{sub}</small></span>
              {badge[id] && <i className="sx-dot" aria-label="Unsaved changes" />}
            </button>
          ))}
        </nav>
        <main className="sx-main" ref={main} data-pad={PREF_TABS.includes(tab) || tab === "character" ? "bar" : undefined}>
          <div className="sx-inner">
            <h2 className="sx-title">{tabInfo[1]}</h2>
            {!data && !loadErr && <div className="sx-load"><Loader label="Loading your settings" size={40} className="lo-inline" /></div>}
            {loadErr && (
              <div className="sx-error" role="alert"><Icon name="alert" size={28} /><p>{loadErr}</p><button type="button" className="go" onClick={load}>Try again</button></div>
            )}
            {data && sections[tab]}
          </div>
        </main>
      </div>
      {data && prefsDirty && tab !== "character" && (
        <div className="sx-bar-fixed" data-show="1" role="region" aria-label="Unsaved changes">
          <span className="sx-barmsg"><Icon name="alert" size={16} /> You have unsaved changes</span>
          <Status s={save} />
          <div className="sx-btns">
            <button type="button" onClick={discardPrefs} disabled={save?.kind === "busy"}>Discard</button>
            <button type="button" className="go" onClick={savePrefs} disabled={save?.kind === "busy"}>{save?.kind === "busy" ? "Saving…" : "Save changes"}</button>
          </div>
        </div>
      )}
      {data && !prefsDirty && save && PREF_TABS.includes(tab) && <div className="sx-toast" role="status"><Status s={save} /></div>}
    </div>
  );
}

// components/apps/SettingsApp.js: the phone's Settings app. It lives INSIDE the handset (components/Phone.js), light like every other phone app, and has pages of its own:
//   Profile · Appearance · Gameplay · Audio · Notifications · Accessibility · Privacy & Security · Install Game · Start a new life
// Every control here is real:
//   - preferences (audio, gameplay, notifications, privacy, accessibility) take effect everywhere the moment they are changed and are saved to the player's account
//     (components/apps/settingsKit.js savePref -> /api/settings -> Character.settings), so they follow the player to any device;
//   - name, appearance, password and email are saved by the server rules in lib/profileService.js; clothes by the Offishall wardrobe (lib/wardrobeService.js);
//   - Install Game uses the browser's real install prompt (lib/pwa.js); Start a new life is a server-side reset behind a confirmation (lib/newLifeService.js).
// Back steps out of a page or sheet first; from the list it returns to the phone's home screen. Esc does the same.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../Icon";
import PlayerAvatar from "../PlayerAvatar";
import { call, naira, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { confirmAction } from "@/lib/confirm";
import { game, useGame, useResource } from "@/lib/gameStore";
import { avatarDirectory } from "@/lib/avatarClient";
import { resetAll } from "@/lib/optimistic";
import { resetBoot, setPlayMode } from "@/lib/ui";
import { usePrefs } from "@/lib/prefs";
import { MUSIC } from "@/lib/sound";
import { useInstall, promptInstall } from "@/lib/pwa";
import { lookKey } from "@/lib/look";
import { Group, NavRow, InfoRow, ToggleRow, SliderRow, Segmented, Status, Note, Sheet, savePref } from "./settingsKit";
import SettingsLook from "./SettingsLook";
import SettingsInstall from "./SettingsInstall";
import NewLifeSheet from "./SettingsNewLife";
import "./settings-app.css";

const PAGES = { profile: "Profile", appearance: "Appearance", gameplay: "Gameplay", audio: "Audio", notifications: "Notifications", accessibility: "Accessibility", privacy: "Privacy & Security", install: "Install Game" };
const STAT_LABEL = [["health", "Health"], ["energy", "Energy"], ["happiness", "Happiness"], ["academics", "Academics"], ["popularity", "Popularity"]];
const bodyName = (g) => (g === "F" ? "Woman" : "Man");

/* ---------------------------------- sheets that edit one thing ---------------------------------- */

function EmailSheet({ p, store, onClose, router }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [s, setS] = useState(null), busy = s?.kind === "busy";
  async function save(e) {
    e.preventDefault();
    if (!email || !pw || busy) return;
    setS({ kind: "busy", text: "Saving…" });
    const r = await call("/api/settings", { action: "email", email, password: pw });
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return setS({ kind: "error", text: r.error || "Could not change your email." });
    store.pushDone((x) => (x ? { ...x, profile: { ...x.profile, email: r.email } } : x));
    toast.success("Email updated.");
    onClose();
  }
  return (
    <Sheet title="Change your email" onClose={onClose} busy={busy}>
      <p className="st-sheetlead">Now: <b>{p.email}</b>. This is the email you log in with.</p>
      <form onSubmit={save}>
        <label className="st-label" htmlFor="st-mail">New email</label>
        <input id="st-mail" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setS(null); }} />
        <label className="st-label" htmlFor="st-mailpw">Your password</label>
        <input id="st-mailpw" type="password" autoComplete="current-password" value={pw} onChange={(e) => { setPw(e.target.value); setS(null); }} />
        <Status s={s} />
        <div className="st-btns"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="go" disabled={!email || !pw || busy}>{busy ? "Saving…" : "Change email"}</button></div>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ onClose, router }) {
  const [f, setF] = useState({ cur: "", next: "", again: "" }), [s, setS] = useState(null), busy = s?.kind === "busy";
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setS(null); };
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    if (f.next.length < 8) return setS({ kind: "error", text: "The new password must be at least 8 characters." });
    if (f.next !== f.again) return setS({ kind: "error", text: "The two new passwords do not match." });
    setS({ kind: "busy", text: "Saving…" });
    const r = await call("/api/settings", { action: "password", current: f.cur, next: f.next });
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return setS({ kind: "error", text: r.error || "Could not change your password." });
    toast.success("Password changed. Use it next time you log in.");
    onClose();
  }
  return (
    <Sheet title="Change your password" onClose={onClose} busy={busy}>
      <p className="st-sheetlead">Use at least 8 characters. Other devices stay signed in until their login expires.</p>
      <form onSubmit={save}>
        <label className="st-label" htmlFor="st-pw0">Current password</label>
        <input id="st-pw0" type="password" autoComplete="current-password" value={f.cur} onChange={set("cur")} />
        <label className="st-label" htmlFor="st-pw1">New password</label>
        <input id="st-pw1" type="password" autoComplete="new-password" value={f.next} onChange={set("next")} />
        <label className="st-label" htmlFor="st-pw2">New password again</label>
        <input id="st-pw2" type="password" autoComplete="new-password" value={f.again} onChange={set("again")} />
        <Status s={s} />
        <div className="st-btns"><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="go" disabled={!f.cur || !f.next || !f.again || busy}>{busy ? "Saving…" : "Change password"}</button></div>
      </form>
    </Sheet>
  );
}

/* ---------------------------------- the app ---------------------------------- */

export default function SettingsApp({ onHome, onClose, onOpenApp, onLogout, loggingOut }) {
  const router = useRouter(), root = useRef(null);
  const [page, setPage] = useState(null), [sheet, setSheet] = useState(null), [lookDirty, setLookDirty] = useState(false);
  const { d, store, load, loadFailed } = useResource("/api/settings");
  const prefs = usePrefs(), install = useInstall(), gs = useGame(), me = gs?.character;
  const [busyBlock, setBusyBlock] = useState(null);
  const onAuth = useCallback(() => loggedOut(router), [router]);
  const pref = (group, key, opts) => (value) => savePref(group, key, value, { onAuth, ...opts });
  async function installGame() {
    if (install.kind !== "available") { go("install"); return; }
    const result = await promptInstall();
    if (result === "accepted") toast.success("Installing Life in OAU. Look for it on your home screen.");
    else if (result === "dismissed") toast.info("No problem. You can install it any time from Settings.");
    else go("install");
  }

  const go = useCallback((id) => setPage(id), []);
  const back = useCallback(async () => {
    if (sheet) return setSheet(null);
    if (!page) return onHome?.();
    if (page === "appearance" && lookDirty && !(await confirmAction({ title: "Discard your changes?", message: "Your new look has not been saved. It will be lost.", confirmLabel: "Discard", cancelLabel: "Keep editing", tone: "danger" }))) return;
    setLookDirty(false); setPage(null);
  }, [sheet, page, lookDirty, onHome]);

  // Esc steps back one level (a sheet, then a page). From the list it falls through to the phone, which goes home. A dialog that is open handles its own Esc.
  useEffect(() => {
    const k = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector(".cd-scrim") || (!sheet && !page)) return;
      e.preventDefault(); e.stopPropagation(); back();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [sheet, page, back]);
  useEffect(() => { root.current?.closest(".pa-body")?.scrollTo?.({ top: 0 }); }, [page]);

  async function unblock(name) {
    setBusyBlock(name);
    const r = await call("/api/settings", { action: "unblock", name });
    setBusyBlock(null);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return toast.error(r.error || "Could not unblock them.");
    store.pushDone((x) => (x ? { ...x, blocked: x.blocked.filter((n) => n !== name) } : x));
    toast.success(`${name} is unblocked.`);
  }

  /** The new life has started on the server: forget everything this browser knows about the old one and go to character creation. */
  function lifeDone() {
    resetAll(); resetBoot(); setPlayMode("home"); // the stores, the chat connection and the cached preferences of the old life are cleared
    toast.success("Your old life is behind you. Create your new character.", { id: "session" });
    onClose?.();
    router.push("/home");
  }

  const p = d?.profile;
  const pic = me ? { name: me.name, gender: me.gender, look: me.look, key: lookKey(me.look, me.gender) } : null;
  const audioState = prefs.audio.music || prefs.audio.sfx ? [prefs.audio.music && "Music", prefs.audio.sfx && "Effects"].filter(Boolean).join(" · ") : "Off";
  const installState = { installed: "Installed", available: "Ready", ios: "Add via Share", manual: "Via menu" }[install.kind] ?? "";

  /* ---------------------------------- pages ---------------------------------- */

  const needData = !d ? (loadFailed ? <div className="st-retry st-big"><Icon name="alert" size={26} /><p>Your settings did not load. Check your connection.</p><button type="button" className="go" onClick={load}>Try again</button></div> : <div className="ph-spin" role="status" aria-label="Loading your settings"><span className="ph-spin-ring" /></div>) : null;

  const pages = {
    profile: needData ?? (
      <>
        <div className="st-hero st-me">
          <PlayerAvatar name={p.name} size={92} look={{ name: p.name, gender: p.gender, look: p.look, key: p.lookKey }} className="st-pic" />
          <h3>{p.name}</h3>
          <p>{bodyName(p.gender)} · {p.faculty.replace(/^Faculty of /, "")} · {p.level}L</p>
          <div className="st-tags"><span>{p.class}</span>{p.office && <span>{p.office}</span>}{p.graduated && <span>Graduated{p.classification ? `, ${p.classification}` : ""}</span>}{p.personalities?.map((x) => <span key={x}>{x}</span>)}</div>
        </div>
        <Group title="Personal information" foot="Your name cannot be changed. Your body, hair and clothes are on the Appearance page.">
          <InfoRow title="Name" value={p.name} lock />
          <NavRow icon="sparkle" tone="rose" title="Gender" value={bodyName(p.gender)} sub="Change in Appearance" onClick={() => go("appearance")} />
          <NavRow icon="send" tone="sky" title="Email" value={p.email} sub="The email you log in with" onClick={() => setSheet("email")} />
        </Group>
        <Group title="Set by the game" foot="You cannot edit these. They change as you play.">
          <InfoRow lock title="Class" value={p.class} />
          <InfoRow lock title="Faculty" value={p.faculty} />
          <InfoRow lock title="Level" value={`${p.level}L`} />
          <InfoRow lock title="Home" value={p.hostel || "Not chosen yet"} />
          <InfoRow lock title="Transport" value={p.transport} />
          <InfoRow lock title="CGPA" value={p.cgpa ?? "–"} />
          <InfoRow lock title="Net worth" value={naira(p.netWorthKobo)} />
          <InfoRow lock title="Relationship" value={p.relationship ?? "Single"} />
        </Group>
        <Group title="Your stats">
          <ul className="st-stats">
            {STAT_LABEL.map(([k, name]) => (
              <li key={k}><span>{name}</span><span className="st-bar-meter" role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.stats[k]}><i style={{ width: `${Math.max(0, Math.min(100, p.stats[k]))}%` }} /></span><b className="num">{p.stats[k]}</b></li>
            ))}
          </ul>
        </Group>
        <Group title="Achievements" foot={p.achievements?.length ? undefined : "None yet. Keep playing."}>
          {p.achievements?.length > 0 && <div className="st-pad"><div className="st-tags" data-gold="1">{p.achievements.map((a) => <span key={a}>{a}</span>)}</div></div>}
        </Group>
      </>
    ),

    appearance: needData ?? <SettingsLook data={d} store={store} onDirty={setLookDirty} onOpenApp={onOpenApp} router={router} />,

    gameplay: (
      <>
        <Group title="Camera" foot="The view you start with when you walk into a building. You can switch at any time with the camera button, or the V key.">
          <div className="st-pad">
            <Segmented label="Camera inside buildings" value={prefs.gameplay.interiorView} onPick={pref("gameplay", "interiorView")} options={[["follow", "Close view"], ["overhead", "Top view"]]} />
            <p className="st-muted st-small">{prefs.gameplay.interiorView === "follow" ? "Close view follows behind your character." : "Top view looks down on the whole floor."}</p>
          </div>
        </Group>
        <Group title="Controls" foot="Applies to the walking stick, the run button and the driving pedals on your screen.">
          <ToggleRow icon="move" tone="violet" title="Left-handed controls" sub="Swap the stick and the buttons to the other side" checked={prefs.gameplay.leftHanded} onChange={pref("gameplay", "leftHanded")} />
          <ToggleRow icon="list" tone="slate" title="Show control hints" sub="The “how to move” line inside buildings" checked={prefs.gameplay.controlHints} onChange={pref("gameplay", "controlHints")} />
        </Group>
        {/* <Group title="Display">
          <ToggleRow icon="users" tone="teal" title="Show player name tags" sub="Names above other real players. You can still find players in Messages." checked={prefs.gameplay.nameTags} onChange={pref("gameplay", "nameTags")} />
        </Group> */}
      </>
    ),

    audio: (
      <>
        <Group title="Background music" foot={`${MUSIC.title} · ${MUSIC.artist}`}>
          <ToggleRow icon="music" tone="orange" title="Music" sub="The song that plays while you play" checked={prefs.audio.music} onChange={pref("audio", "music")} />
          <SliderRow id="st-music" title="Volume" value={prefs.audio.musicVolume} disabled={!prefs.audio.music} onChange={pref("audio", "musicVolume", { delay: 500 })} />
        </Group>
        <Group title="Sound effects">
          <ToggleRow icon="sound" tone="amber" title="Sound effects" sub="Taps, clicks and alerts" checked={prefs.audio.sfx} onChange={pref("audio", "sfx")} />
          <SliderRow id="st-sfx" title="Volume" value={prefs.audio.sfxVolume} disabled={!prefs.audio.sfx} onChange={pref("audio", "sfxVolume", { delay: 500 })} />
        </Group>
        <p className="st-foot">{!prefs.audio.music && !prefs.audio.sfx ? "The game is silent." : "Changes apply at once, everywhere in the game."} They are saved to your account, so they follow you to any device. Browsers start sound after your first tap.</p>
      </>
    ),

    notifications: (
      <>
        <Group title="In the game">
          <ToggleRow icon="medal" tone="gold" title="Achievement pop-ups" sub="A message when you unlock an award. Awards are still saved in Awards." checked={prefs.notifications.achievements} onChange={pref("notifications", "achievements")} />
          <ToggleRow icon="bell" tone="amber" title="Alert sound" sub="The chime that comes with game alerts" checked={prefs.notifications.alertSound} onChange={pref("notifications", "alertSound")} />
        </Group>
        <Group title="Messages" foot="Unread messages always show their badge on the phone, whatever you choose here.">
          <ToggleRow icon="chat" tone="blue" title="Message pop-ups" sub="A small notice when a message arrives while Messages is closed" checked={prefs.notifications.messagePopups} onChange={pref("notifications", "messagePopups")} />
          <ToggleRow icon="sound" tone="sky" title="Message sound" sub="A sound when a message arrives" checked={prefs.notifications.messageSound} onChange={pref("notifications", "messageSound")} />
        </Group>
        <Note icon="sparkle">These are the notices the game shows while you play. Life in OAU does not send notifications to your phone when the game is closed.</Note>
      </>
    ),

    accessibility: (
      <Group title="Comfort" foot="These apply to the whole game straight away.">
        <ToggleRow icon="timer" tone="teal" title="Reduce motion" sub="Stops sliding and fading effects, and the turning character preview" checked={prefs.accessibility.reduceMotion} onChange={pref("accessibility", "reduceMotion")} />
        <ToggleRow icon="eye" tone="indigo" title="Larger text" sub="Makes writing about a fifth bigger everywhere" checked={prefs.accessibility.largeText} onChange={pref("accessibility", "largeText")} />
        <ToggleRow icon="focus" tone="graphite" title="High contrast" sub="Stronger text, borders and focus outlines" checked={prefs.accessibility.highContrast} onChange={pref("accessibility", "highContrast")} />
        <ToggleRow icon="rotateRight" tone="mint" title="Spin the character preview" sub="The character turns by itself while you look at it. You can always drag to turn it." checked={prefs.accessibility.autoSpin} onChange={pref("accessibility", "autoSpin")} disabled={prefs.accessibility.reduceMotion} />
      </Group>
    ),

    privacy: needData ?? (
      <>
        <Group title="Who can see what">
          <ToggleRow icon="love" tone="rose" title="Show my relationship status" sub="Whether your profile says you are single, dating or engaged" checked={prefs.privacy.showRelationship} onChange={pref("privacy", "showRelationship")} />
          <ToggleRow icon="search" tone="blue" title="Appear in player search" sub="When off, other players cannot find you by typing your name. They can still message you if they already know it." checked={prefs.privacy.searchable} onChange={pref("privacy", "searchable")} />
        </Group>
        <Group title="Blocked players" foot={d.blocked.length ? "They cannot message you, and you do not see each other in the world." : "You have not blocked anyone. You can block someone from their name tag or from Messages."}>
          {d.blocked.map((n) => (
            <div key={n} className="st-row st-info"><span className="ph-ico st-ico" data-tone="slate" aria-hidden="true"><Icon name="block" size={20} weight="fill" /></span><span className="st-txt"><b>{n}</b></span><button type="button" className="st-small-btn" disabled={busyBlock === n} onClick={() => unblock(n)}>{busyBlock === n ? "…" : "Unblock"}</button></div>
          ))}
        </Group>
        <Group title="Security" foot="Other devices stay signed in until their login expires.">
          <NavRow icon="lock" tone="navy" title="Change password" sub="Use at least 8 characters" onClick={() => setSheet("password")} />
          <NavRow icon="send" tone="sky" title="Change email" value={p.email} onClick={() => setSheet("email")} />
        </Group>
        <Group title="This device">
          <NavRow icon="logout" tone="slate" title={loggingOut ? "Logging out…" : "Log out"} sub="Leave the game on this device" disabled={loggingOut} onClick={onLogout} />
        </Group>
      </>
    ),

    install: <SettingsInstall />,
  };

  return (
    <div className="st" ref={root}>
      <header className="pa-bar st-top">
        <button type="button" className="pa-back" onClick={back} aria-label={page ? "Back to Settings" : "Back to home screen"}><Icon name="back" size={24} weight="bold" /></button>
        <h2>{page ? PAGES[page] : "Settings"}</h2>
      </header>
      <div className="pa-content st-body">
        {!page ? (
          <>
            {me && (
              <button type="button" className="st-card" onClick={() => go("profile")} aria-label={`${me.name}, open your profile`}>
                <PlayerAvatar name={me.name} size={58} look={pic} className="st-pic" />
                <span className="st-txt"><b>{me.name}</b><small>{bodyName(me.gender)} · {String(me.faculty ?? "").replace(/^Faculty of /, "")} · {me.level}L</small></span>
                <span className="st-chev" aria-hidden="true"><Icon name="caret" size={16} weight="bold" /></span>
              </button>
            )}
            <Group title="Account">
              <NavRow icon="person" tone="blue" title="Profile" sub="Name, email and your details" onClick={() => go("profile")} />
              <NavRow icon="sparkle" tone="rose" title="Appearance" sub="Body, hair and clothes" onClick={() => go("appearance")} />
            </Group>
            <Group title="Game">
              <NavRow icon="game" tone="violet" title="Gameplay" sub="Camera and controls" onClick={() => go("gameplay")} />
              <NavRow icon="sound" tone="orange" title="Audio" sub="Music and sound effects" value={audioState} onClick={() => go("audio")} />
              <NavRow icon="bell" tone="amber" title="Notifications" sub="Pop-ups and alerts" onClick={() => go("notifications")} />
              <NavRow icon="eye" tone="teal" title="Accessibility" sub="Motion, text and contrast" onClick={() => go("accessibility")} />
            </Group>
            <Group title="Safety">
              <NavRow icon="shield" tone="navy" title="Privacy & Security" sub="Visibility, blocked players, password" onClick={() => go("privacy")} />
            </Group>
            <Group title="App">
              <NavRow icon="phone" tone="green" title="Install Game" sub="Add Life in OAU to your home screen" value={installState} onClick={installGame} />
            </Group>
            <Group title="Start over" tone="danger" foot="Delete your character and begin a brand new life. You will be asked to confirm, and nothing changes until you do.">
              <NavRow icon="undo" tone="rose" title="Start a new life" sub="Reset your character and progress" danger onClick={() => setSheet("life")} />
            </Group>
          </>
        ) : pages[page]}
      </div>
      {sheet === "email" && p && <EmailSheet p={p} store={store} onClose={() => setSheet(null)} router={router} />}
      {sheet === "password" && <PasswordSheet onClose={() => setSheet(null)} router={router} />}
      {sheet === "life" && <NewLifeSheet name={me?.name} onClose={() => setSheet(null)} onDone={lifeDone} router={router} />}
    </div>
  );
}

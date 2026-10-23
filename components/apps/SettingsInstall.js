// components/apps/SettingsInstall.js: Settings > Install Game, inside the phone.
// Shows what this device and browser can really do (lib/pwa.js decides): one-tap install where the browser offers its prompt, the Share-menu steps on iPhone and iPad,
// the browser-menu steps where the prompt is not offered, and a plain reason (with a way forward) where installing is not possible.
"use client";
import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { toast } from "@/lib/toast";
import { useInstall, promptInstall, refreshInstall } from "@/lib/pwa";
import { Group, Note } from "./settingsKit";

const BENEFITS = [
  ["phone", "Opens from your home screen", "One tap, like any other app."],
  ["focus", "Full screen", "No browser bars: more room for the game."],
  ["timer", "Opens quickly", "The game keeps what it needs, so coming back is fast."],
];

export default function SettingsInstall() {
  const s = useInstall(), [busy, setBusy] = useState(false);
  useEffect(() => { refreshInstall(); }, []);

  async function install() {
    if (s.kind === "ios" && typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Life in OAU", url: window.location.href });
        toast.info("Choose Add to Home Screen in the Share menu to finish installing.");
      } catch (error) {
        if (error?.name !== "AbortError") toast.info("Open the Share menu and choose Add to Home Screen.");
      }
      return;
    }
    setBusy(true);
    const out = await promptInstall();
    setBusy(false);
    if (out === "accepted") toast.success("Installing Life in OAU. Look for it on your home screen.");
    else if (out === "dismissed") toast.info("No problem. You can install it any time from here.");
    else toast.info("Your browser is not offering the install button right now. Use the steps shown here.");
  }

  const deviceName = s.device === "ios" ? "iPhone or iPad" : s.device === "android" ? "phone" : "computer";
  return (
    <div className="st-install">
      <div className="st-hero" data-kind={s.kind}>
        <span className="st-hero-ico" aria-hidden="true"><Icon name={s.kind === "installed" ? "win" : s.kind === "unsupported" ? "alert" : "phone"} size={30} weight="fill" /></span>
        {s.kind === "checking" && <><b>Checking your device…</b></>}
        {s.kind === "installed" && <><b>Life in OAU is installed</b><p>You are playing the installed app on this {deviceName}.</p></>}
        {s.kind === "available" && <><b>Install Life in OAU</b><p>Add the game to your {deviceName} so it opens like an app.</p></>}
        {s.kind === "ios" && <><b>Add Life in OAU to your home screen</b><p>On {deviceName === "iPhone or iPad" ? "iPhone and iPad" : "this device"} you do this from the Share menu.</p></>}
        {s.kind === "manual" && <><b>Install Life in OAU</b><p>Your browser can install the game from its menu.</p></>}
        {s.kind === "unsupported" && <><b>This browser cannot install the game</b><p>{s.why}</p></>}
        {(s.kind === "available" || s.kind === "ios") && <button type="button" className="go st-installbtn" disabled={busy} onClick={install}>{busy ? "Opening…" : s.kind === "ios" ? "Open Share menu" : "Install game"}</button>}
      </div>

      {(s.kind === "ios" || s.kind === "manual") && (
        <Group title="How to install">
          <ol className="st-steps">{s.steps.map((t, i) => <li key={i}><span className="st-n">{i + 1}</span><span>{t}</span></li>)}</ol>
        </Group>
      )}
      {s.kind === "unsupported" && s.fix && <Note icon="sparkle">{s.fix}</Note>}
      {s.kind === "manual" && <Note icon="alert">Your browser decides when to show its own install button. If you already installed the game, or turned the offer down earlier, it may not appear. The steps above always work.</Note>}

      {s.kind !== "installed" && s.kind !== "unsupported" && (
        <Group title="Why install">
          {BENEFITS.map(([icon, t, sub]) => (
            <div key={t} className="st-row st-info"><span className="ph-ico st-ico" data-tone="green" aria-hidden="true"><Icon name={icon} size={20} weight="fill" /></span><span className="st-txt"><b>{t}</b><small>{sub}</small></span></div>
          ))}
        </Group>
      )}
      <p className="st-foot">Life in OAU always needs an internet connection to play. Installing does not change your account or your progress.</p>
    </div>
  );
}

// components/apps/SettingsLook.js: Settings > Appearance, inside the phone.
// Two kinds of change, each saved by the server rule that owns it:
//   - body (man / woman), hairstyle, skin tone and height: previewed in 3D, kept when "Save appearance" succeeds (/api/settings, lib/profileService.js saveAppearance);
//   - clothes: an outfit made of clothes the player OWNS from Offishall Stores, worn with one tap (/api/wardrobe, lib/wardrobeService.js). The server refuses to change clothes
//     from anywhere else, so this page never pretends to: it only offers what the wardrobe really allows.
// A saved look is written into the game state and every profile picture at once, so the room, the map, buildings, messages and other players all show it.
"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "../Icon";
import { call, loggedOut } from "@/lib/client";
import { toast } from "@/lib/toast";
import { game, useResource } from "@/lib/gameStore";
import { avatarDirectory } from "@/lib/avatarClient";
import { SKIN_TONES, HAIR, HEIGHTS, adaptLook, keepClothing, lookKey, label } from "@/lib/look";
import { itemById, fitsGender, checkWear, wearKey } from "@/lib/wardrobe";
import { hostelForGender } from "@/lib/profileRules";
import { Group, Segmented, Status, Note } from "./settingsKit";

const CharacterViewer = dynamic(() => import("../CharacterViewer"), { ssr: false, loading: () => <div className="stage" style={{ height: "100%" }} aria-busy="true" /> });
const HEIGHT_LABEL = { short: "Short", average: "Average", tall: "Tall" };
const names = (ids) => (ids ?? []).map((i) => itemById(i)?.name).filter(Boolean).join(" + ");

export default function SettingsLook({ data, store, onDirty, onOpenApp, router }) {
  const p = data.profile, block = data.editable.genderBlock;
  const [staged, setStaged] = useState(null); // { gender, look } while the player is editing; null = nothing changed
  const [status, setStatus] = useState(null), [busy, setBusy] = useState(false);
  const g = staged?.gender ?? p.gender;
  // What is drawn: the edited look, but the clothes are always the ones really worn (the wardrobe below can change them while this page is open).
  const shown = useMemo(() => adaptLook(keepClothing(staged?.look ?? p.look, p.look), g), [staged, p.look, g]);
  const dirty = !!staged && lookKey(shown, g) !== p.lookKey;
  useEffect(() => { onDirty?.(dirty); }, [dirty]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onDirty?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickGender = (next) => { if (next !== g) { setStaged({ gender: next, look: adaptLook(keepClothing(shown, p.look), next) }); setStatus(null); } };
  const setField = (k) => (v) => { setStaged({ gender: g, look: { ...shown, [k]: v } }); setStatus(null); };
  const hallMove = g !== p.gender ? { from: p.hostel, to: hostelForGender(p.hostel, g) } : null;

  async function save() {
    setBusy(true); setStatus({ kind: "busy", text: "Saving your look…" });
    const r = await call("/api/settings", { action: "appearance", gender: g, look: shown });
    setBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return setStatus({ kind: "error", text: r.error || "Could not save your look. Check your connection and try again." });
    store.pushDone((x) => (x ? { ...x, profile: { ...x.profile, gender: r.gender, look: r.look, lookKey: r.lookKey, hostel: r.hostel } } : x));
    game.pushDone((s) => (s ? { ...s, character: { ...s.character, gender: r.gender, look: r.look, hostel: r.hostel } } : s)); // the room, the map and the buildings redraw from this
    avatarDirectory.seed(p.name, r.gender, r.look, r.lookKey); // every profile picture of this player is redrawn
    window.dispatchEvent(new Event("game:refresh"));
    setStaged(null);
    setStatus({ kind: "ok", text: r.hostelMoved ? `Saved. Your room moved from ${r.previousHostel} to ${r.hostel}.` : "Saved. You look like this everywhere in the game." });
    toast.success("Appearance updated.");
  }

  /* ---- clothes: the wardrobe ---- */
  const { d: w, store: wStore, load: loadWardrobe, loadFailed } = useResource("/api/wardrobe");
  const worn = w?.wear ?? null, wornKey = wearKey(worn);
  const [pick, setPick] = useState({ set: null, top: null, bottom: null }), [wearBusy, setWearBusy] = useState(false), [wearMsg, setWearMsg] = useState(null);
  useEffect(() => { // the choice starts from what is being worn, and follows it when the outfit changes
    const items = (worn ?? []).map(itemById).filter(Boolean);
    setPick({ set: items.find((i) => i.slot === "set")?.id ?? null, top: items.find((i) => i.slot === "top")?.id ?? null, bottom: items.find((i) => i.slot === "bottom")?.id ?? null });
  }, [wornKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = useMemo(() => (w ? w.owned.map((o) => itemById(o.id)).filter((i) => i && fitsGender(i, p.gender)) : []), [w, p.gender]);
  const ids = pick.set ? [pick.set] : pick.top || pick.bottom ? [pick.top, pick.bottom].filter(Boolean) : null;
  const fit = ids ? checkWear(ids, p.gender) : null;
  const wearDirty = !!fit?.ok && wearKey(fit.ids) !== wornKey;
  const choose = (it) => { setWearMsg(null); setPick((c) => (it.slot === "set" ? { set: c.set === it.id ? null : it.id, top: null, bottom: null } : { set: null, top: it.slot === "top" ? (c.top === it.id ? null : it.id) : c.top, bottom: it.slot === "bottom" ? (c.bottom === it.id ? null : it.id) : c.bottom })); };
  const isPicked = (it) => pick.set === it.id || pick.top === it.id || pick.bottom === it.id;

  async function dress(body, okText) {
    setWearBusy(true); setWearMsg({ kind: "busy", text: "Changing clothes…" });
    const r = await call("/api/wardrobe", body);
    setWearBusy(false);
    if (r.status === 401) return loggedOut(router);
    if (r.failed) return setWearMsg({ kind: "error", text: r.error || "Could not change your clothes. Try again." });
    wStore.pushDone((x) => (x ? { ...x, wear: r.wear, look: r.look, lookKey: r.lookKey } : x));
    store.pushDone((x) => (x ? { ...x, profile: { ...x.profile, look: r.look, lookKey: r.lookKey } } : x));
    game.pushDone((s) => (s ? { ...s, character: { ...s.character, look: r.look } } : s));
    avatarDirectory.seed(p.name, r.gender ?? p.gender, r.look, r.lookKey);
    window.dispatchEvent(new Event("game:refresh"));
    setWearMsg({ kind: "ok", text: okText }); toast.success(okText);
  }

  const sections = [["Complete outfits", mine.filter((i) => i.slot === "set")], ["Tops", mine.filter((i) => i.slot === "top")], ["Bottoms", mine.filter((i) => i.slot === "bottom")]];
  const bodyChanging = g !== p.gender;

  return (
    <div className="st-look">
      <div className="st-view" aria-label="Character preview">
        <CharacterViewer look={shown} gender={g} label="Your character" />
        <div className="st-caption"><b>{p.name}</b><span>{g === "F" ? "Woman" : "Man"} · {label(shown.hair)} hair · {shown.wear ? "Offishall outfit" : "starter outfit"}</span>{dirty && <em>Preview. Not saved yet.</em>}</div>
      </div>

      <Group title="Body" foot="Switch whenever you like. Your level, money, progress and everything else stay exactly as they are.">
        <div className="st-pad">
          <Segmented label="Body" value={g} onPick={pickGender} options={[["F", "Woman"], ["M", "Man"]]} disabled={busy} />
          {block && <Note icon="lockS">{block}</Note>}
          {hallMove && hallMove.from !== hallMove.to && <Note icon="hostel">Your hall will move from {hallMove.from} to {hallMove.to}. Rent and room size stay the same.</Note>}
          {bodyChanging && <Note icon="sparkle">Hair and other options that do not exist for this body are swapped for the nearest match. You can change them below.</Note>}
        </div>
      </Group>

      <Group title="Look">
        <div className="st-pad st-fields">
          <div className="st-field"><div className="st-fh"><h4>Skin tone</h4><span>{label(shown.skin)}</span></div>
            <div className="st-swatches" role="group" aria-label="Skin tone">
              {Object.entries(SKIN_TONES).map(([k, hex]) => (
                <button key={k} type="button" className="st-swatch" style={{ "--sw": hex }} aria-pressed={shown.skin === k} aria-label={label(k)} title={label(k)} disabled={busy} onClick={() => setField("skin")(k)}><Icon name="check" size={16} weight="bold" /></button>
              ))}
            </div>
          </div>
          <div className="st-field"><div className="st-fh"><h4>Hairstyle</h4><span>{label(shown.hair)}</span></div>
            <div className="st-chips" role="group" aria-label="Hairstyle">
              {HAIR[g].map((k) => <button key={k} type="button" aria-pressed={shown.hair === k} disabled={busy} onClick={() => setField("hair")(k)}>{label(k)}</button>)}
            </div>
          </div>
          <div className="st-field"><div className="st-fh"><h4>Height</h4><span>{HEIGHT_LABEL[shown.height]}</span></div>
            <Segmented label="Height" value={shown.height} onPick={setField("height")} options={HEIGHTS.map((k) => [k, HEIGHT_LABEL[k]])} disabled={busy} />
          </div>
        </div>
      </Group>

      <Group title="Clothes" foot="Clothes come from Offishall Stores. Everything you buy is yours for good, and you can change outfits here or in the store whenever you like.">
        <div className="st-pad">
          <p className="st-wearing"><Icon name="shirt" size={16} weight="fill" /> Wearing: <b>{!w ? "…" : worn ? names(worn) : "Your starter outfit"}</b></p>
          {bodyChanging && <Note icon="lockS">Save your body change first. Your clothes are chosen for the body you have saved.</Note>}
          {!w && !loadFailed && <p className="st-muted">Loading your wardrobe…</p>}
          {loadFailed && <div className="st-retry"><p>Your wardrobe did not load.</p><button type="button" onClick={loadWardrobe}>Try again</button></div>}
          {w && !bodyChanging && (mine.length === 0 ? (
            <p className="st-muted">You do not own any clothes yet. Buy some at Offishall Stores and they will appear here.</p>
          ) : (<>
            {sections.map(([title, list]) => list.length > 0 && (
              <div key={title} className="st-field"><div className="st-fh"><h4>{title}</h4></div>
                <div className="st-chips" role="group" aria-label={title}>
                  {list.map((it) => <button key={it.id} type="button" aria-pressed={isPicked(it)} disabled={wearBusy} onClick={() => choose(it)}>{it.name}</button>)}
                </div>
              </div>
            ))}
            {fit && !fit.ok && <Note icon="alert">{fit.reason}</Note>}
            <Status s={wearMsg} />
            <div className="st-btns">
              <button type="button" className="go" disabled={wearBusy || !wearDirty} onClick={() => dress({ action: "equip", ids: fit.ids }, `You are now wearing ${names(fit.ids)}.`)}>Wear this outfit</button>
              <button type="button" disabled={wearBusy || !worn} onClick={() => dress({ action: "starter" }, "You are back in your starter outfit.")}>Starter outfit</button>
            </div>
          </>))}
          <button type="button" className="st-wide" onClick={() => onOpenApp?.("offishall")}><Icon name="bag" size={18} weight="fill" /> Open Offishall Stores</button>
        </div>
      </Group>

      <div className="st-bar" data-show={dirty || status ? "1" : undefined}>
        <Status s={status} />
        {dirty && (
          <div className="st-btns">
            <button type="button" disabled={busy} onClick={() => { setStaged(null); setStatus(null); }}>Cancel</button>
            <button type="button" className="go" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save appearance"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

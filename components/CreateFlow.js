// components/CreateFlow.js
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "@/lib/toast";
import { SKIN_TONES, HAIR, OUTFITS, FABRICS, ACCENTS, cleanLook, label } from "@/lib/look.js";

const CharacterViewer = dynamic(() => import("./CharacterViewer"), { ssr: false, loading: () => <div className="stage" style={{ height: "46vh" }} aria-busy="true" /> });
// What each trait really does in the game rules.
const TRAITS = [["Party Animal", "Parties hit different. You gain more popularity from nights out."], ["Introvert", "You recover more energy resting, but nights out cost more energy and win less popularity."],
  ["Extrovert", "Friends come easily. More popularity from parties, and chats and flirting go better."], ["Shana", "Always a plan. Better odds on risky hustles, and a higher appetite for risk."]];
const STEPS = ["Look", "Personality", "Faculty"];

export default function CreateFlow({ meta, busy, onSubmit }) {
  const [step, setStep] = useState(0), [name, setName] = useState(""), [gender, setGender] = useState("F"), [look, setLook] = useState(() => cleanLook(null, "F"));
  const [traits, setTraits] = useState([]), [facultyId, setFacultyId] = useState("");
  const nameOk = /^[A-Za-z0-9 _.-]{3,20}$/.test(name.trim()), set = (k, v) => setLook((l) => ({ ...l, [k]: v }));
  const pickGender = (g) => { setGender(g); setLook((l) => cleanLook(l, g)); };
  const toggle = (t) => setTraits((a) => (a.includes(t) ? a.filter((x) => x !== t) : a.length >= 2 ? [...a.slice(1), t] : [...a, t]));
  const [nameSeen, setNameSeen] = useState(false);
  // Why the current step can't continue yet (empty when it can). Shown as a toast when the player tries.
  const blocked = step === 0 ? (!name.trim() ? "Enter a name for your character." : !nameOk ? "That name isn't valid. Use 3 to 20 letters, numbers, spaces, dots, dashes or underscores." : "")
    : step === 1 ? (traits.length < 1 ? "Choose at least one trait to continue." : "") : (!facultyId ? "Choose a faculty to continue." : "");
  const stop = () => { if (!blocked) return false; setNameSeen(true); toast.error(blocked, { id: "create-invalid" }); return true; };
  const next = () => { if (!stop()) setStep(step + 1); };
  const finish = () => { if (!stop()) submit(); };
  const submit = () => onSubmit({ name: name.trim(), gender, facultyId: Number(facultyId), personalities: traits, look });
  const Chips = ({ items, k }) => (<div className="chips">{items.map((v) => <button key={v} type="button" aria-pressed={look[k] === v} className={look[k] === v ? "on" : ""} onClick={() => set(k, v)}>{label(v)}</button>)}</div>);
  const Swatches = ({ map, k, name: nm }) => (<div className="swatches" role="group" aria-label={nm}>{Object.entries(map).map(([key, hex]) => <button key={key} type="button" className="swatch" aria-label={label(key)} aria-pressed={look[k] === key} style={{ background: hex }} onClick={() => set(k, key)} />)}</div>);

  return (
    <div className="create">
      <CharacterViewer look={look} gender={gender} />
      <div>
        <div className="steps" aria-hidden="true">{STEPS.map((s, i) => <i key={s} className={i <= step ? "done" : ""} />)}</div>
        <p className="mut num" aria-live="polite">Step {step + 1} of {STEPS.length}</p>
        {step === 0 && (<section className="card" aria-labelledby="look-h">
          <h2 id="look-h">Make your look</h2>
          <p><label>Name<input type="text" value={name} maxLength={20} autoComplete="off" aria-invalid={nameSeen && name.length > 0 && !nameOk} aria-describedby="name-h" onBlur={() => name.length > 0 && setNameSeen(true)} onChange={(e) => setName(e.target.value)} placeholder="e.g. tolu_ife" /></label>
            <span id="name-h" className="field-help">3 to 20 letters, numbers, spaces, dots, dashes or underscores. This is your name in the game.</span></p>
          <h3>Body</h3><div className="row">{[["F", "Woman"], ["M", "Man"]].map(([g, l]) => <button key={g} type="button" aria-pressed={gender === g} className={gender === g ? "on" : ""} onClick={() => pickGender(g)}>{l}</button>)}</div>
          <h3 style={{ marginTop: 16 }}>Skin tone</h3><Swatches map={SKIN_TONES} k="skin" name="Skin tone" />
          <h3 style={{ marginTop: 16 }}>Hairstyle</h3><Chips items={HAIR[gender]} k="hair" />
          <h3 style={{ marginTop: 16 }}>Outfit</h3><Chips items={OUTFITS} k="outfit" />
          <h3 style={{ marginTop: 16 }}>Fabric</h3><Chips items={FABRICS} k="fabric" />
          <h3 style={{ marginTop: 16 }}>Colour</h3><Swatches map={ACCENTS} k="accent" name="Outfit colour" />
        </section>)}
        {step === 1 && (<section className="card" aria-labelledby="tr-h"><h2 id="tr-h">Choose up to 2 traits for {name.trim() || "your character"}</h2>
          <div className="row" style={{ marginTop: 12 }}>{TRAITS.map(([t, d]) => <button key={t} type="button" className={"trait" + (traits.includes(t) ? " on" : "")} aria-pressed={traits.includes(t)} onClick={() => toggle(t)}><b>{t}</b><span className="mut">{d}</span></button>)}</div></section>)}
        {step === 2 && (<section className="card" aria-labelledby="fa-h"><h2 id="fa-h">What do you study?</h2>
          <p className="mut">Your faculty decides your courses, your lecturers and how hard exams feel.</p>
          <div className="chips" style={{ marginTop: 12 }}>{meta?.faculties?.map((f) => <button key={f.id} type="button" aria-pressed={String(facultyId) === String(f.id)} className={String(facultyId) === String(f.id) ? "on" : ""} onClick={() => setFacultyId(f.id)}>{f.name}</button>)}</div>
          {!meta?.faculties?.length && <p className="mut">Loading faculties...</p>}</section>)}
        <div className="row" style={{ marginTop: 12 }}>
          {step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}
          {step < 2 ? <button type="button" className="go" onClick={next}>Next</button>
            : <button type="button" className="go" disabled={busy} onClick={finish}>{busy ? "Rolling your life..." : "Reveal my life"}</button>}
        </div>
      </div>
    </div>
  );
}
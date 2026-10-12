// components/CreateFlow.js
"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import Loader from "./Loader";
import { Icon } from "./Icon";
import { toast } from "@/lib/toast";
import {
  SKIN_TONES,
  HAIR,
  OUTFITS,
  COLORS,
  cleanLook,
  label,
} from "@/lib/look.js";
import { FACULTIES } from "@/lib/faculties.js";
import "./create-flow.css";

const CharacterViewer = dynamic(() => import("./CharacterViewer"), {
  ssr: false,
  loading: () => (
    <div className="stage" style={{ height: "100%" }} aria-busy="true" />
  ),
});

// What each trait really does in the game rules.
const TRAITS = [
  [
    "Party Animal",
    "party",
    "Parties hit different. You gain more popularity from nights out.",
  ],
  [
    "Introvert",
    "moon",
    "You recover more energy resting, but nights out cost more energy and win less popularity.",
  ],
  [
    "Extrovert",
    "talk",
    "Friends come easily. More popularity from parties, and chats and flirting go better.",
  ],
  [
    "Shana",
    "focus",
    "Always a plan. Better odds on risky hustles, and a higher appetite for risk.",
  ],
];
const STEPS = ["Look", "Personality", "Faculty"];
const DIFFICULTY = Object.fromEntries(FACULTIES); // game number, about 0.8 to 1.3
const feel = (d) =>
  d >= 1.3
    ? ["Toughest exams", 3]
    : d >= 1.1
      ? ["Demanding exams", 2]
      : ["Gentler exams", 1];
const short = (n) => n.replace(/^Faculty of /, "");

export default function CreateFlow({ meta, busy, onSubmit }) {
  const [step, setStep] = useState(0),
    [dir, setDir] = useState(1),
    [name, setName] = useState(""),
    [gender, setGender] = useState("F"),
    [look, setLook] = useState(() => cleanLook(null, "F"));
  const [traits, setTraits] = useState([]),
    [facultyId, setFacultyId] = useState(""),
    [nameSeen, setNameSeen] = useState(false);
  const nameOk = /^[A-Za-z0-9 _.-]{3,20}$/.test(name.trim()),
    set = (k, v) => setLook((l) => ({ ...l, [k]: v }));
  const pickGender = (g) => {
    setGender(g);
    setLook((l) => cleanLook(l, g));
  };
  const toggle = (t) =>
    setTraits((a) =>
      a.includes(t)
        ? a.filter((x) => x !== t)
        : a.length >= 2
          ? [...a.slice(1), t]
          : [...a, t],
    );
  // Why the current step can't continue yet (empty when it can). Shown as a toast when the player tries.
  const blocked =
    step === 0
      ? !name.trim()
        ? "Enter a name for your character."
        : !nameOk
          ? "That name isn't valid. Use 3 to 20 letters, numbers, spaces, dots, dashes or underscores."
          : ""
      : step === 1
        ? traits.length < 1
          ? "Choose at least one trait to continue."
          : ""
        : !facultyId
          ? "Choose a faculty to continue."
          : "";
  const stop = () => {
    if (!blocked) return false;
    setNameSeen(true);
    toast.error(blocked, { id: "create-invalid" });
    return true;
  };
  const go = (to) => {
    setDir(to > step ? 1 : -1);
    setStep(to);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const next = () => {
    if (!stop()) go(step + 1);
  };
  const finish = () => {
    if (!stop())
      onSubmit({
        name: name.trim(),
        gender,
        facultyId: Number(facultyId),
        personalities: traits,
        look,
      });
  };

  const Chips = ({ items, k }) => (
    <div className="cf-chips">
      {items.map((v) => (
        <button
          key={v}
          type="button"
          className="cf-chip"
          aria-pressed={look[k] === v}
          onClick={() => set(k, v)}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
  const Swatches = ({ map, k, name: nm }) => (
    <div className="cf-swatches" role="group" aria-label={nm}>
      {Object.entries(map).map(([key, hex]) => (
        <button
          key={key}
          type="button"
          className="cf-swatch"
          title={label(key)}
          aria-label={label(key)}
          aria-pressed={look[k] === key}
          style={{ "--sw": hex }}
          onClick={() => set(k, key)}
        >
          <Icon name="check" size={16} weight="bold" />
        </button>
      ))}
    </div>
  );
  const Field = ({ title, value, children }) => (
    <div className="cf-field">
      <div className="cf-fieldhead">
        <h3>{title}</h3>
        {value && <span className="mut">{value}</span>}
      </div>
      {children}
    </div>
  );
  const nameState = !name ? "idle" : nameOk ? "ok" : nameSeen ? "bad" : "idle";

  return (
    <div className="cf">
      <aside className="cf-stage" aria-label="Character preview">
        <CharacterViewer look={look} gender={gender} />
        <div className="cf-caption">
          <b>{name.trim() || "Your character"}</b>
          <span className="mut">
            {gender === "F" ? "Woman" : "Man"}, {label(look.hair).toLowerCase()}{" "}
            hair, {label(look.outfit).toLowerCase()} outfit
          </span>
        </div>
      </aside>

      <div className="cf-panel">
        <ol className="cf-steps" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              data-state={i < step ? "done" : i === step ? "now" : "todo"}
              aria-current={i === step ? "step" : undefined}
            >
              <button
                type="button"
                disabled={i >= step}
                onClick={() => go(i)}
                aria-label={i < step ? `Back to ${s}` : s}
              >
                <span className="cf-dot">
                  {i < step ? (
                    <Icon name="check" size={14} weight="bold" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span className="cf-stepname">{s}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="cf-body" key={step} data-dir={dir}>
          {step === 0 && (
            <section aria-labelledby="look-h">
              <h2 id="look-h">Make your look</h2>
              <div className="cf-field">
                <label className="cf-label" htmlFor="cf-name">
                  Name
                </label>
                <div className="cf-namebox" data-state={nameState}>
                  <input
                    id="cf-name"
                    type="text"
                    value={name}
                    maxLength={20}
                    autoComplete="off"
                    aria-invalid={nameState === "bad"}
                    aria-describedby="cf-name-h"
                    onBlur={() => name.length > 0 && setNameSeen(true)}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. tolu_ife"
                  />
                  <span className="cf-namestate" aria-hidden="true">
                    {nameState === "ok" && (
                      <Icon name="check" size={18} weight="bold" />
                    )}
                    {nameState === "bad" && <Icon name="warn" size={18} />}
                  </span>
                </div>
                <span
                  id="cf-name-h"
                  className={"field-help" + (nameState === "bad" ? " bad" : "")}
                >
                  3 to 20 letters, numbers, spaces, dots, dashes or underscores.
                  Other players see this name.
                </span>
              </div>
              <Field title="Body">
                <div className="cf-seg" role="group" aria-label="Body">
                  {[
                    ["F", "Woman"],
                    ["M", "Man"],
                  ].map(([g, l]) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={gender === g}
                      onClick={() => pickGender(g)}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </Field>
              <Field title="Skin tone" value={label(look.skin)}>
                <Swatches map={SKIN_TONES} k="skin" name="Skin tone" />
              </Field>
              <Field title="Hairstyle" value={label(look.hair)}>
                <Chips items={HAIR[gender]} k="hair" />
              </Field>
              <Field title="Outfit" value={label(look.outfit)}>
                <Chips items={OUTFITS} k="outfit" />
              </Field>
              <Field title="Shirt colour" value={label(look.top)}>
                <Swatches map={COLORS} k="top" name="Shirt colour" />
              </Field>
              <Field title="Trouser or skirt colour" value={label(look.bottom)}>
                <Swatches
                  map={COLORS}
                  k="bottom"
                  name="Trouser or skirt colour"
                />
              </Field>
            </section>
          )}

          {step === 1 && (
            <section aria-labelledby="tr-h">
              <div className="cf-titlerow">
                <h2 id="tr-h">
                  How does {name.trim() || "your character"} move?
                </h2>
                <span className="cf-count num" aria-live="polite">
                  {traits.length} of 2
                </span>
              </div>
              <p className="mut">
                Choose up to two traits. Picking a third replaces your first.
              </p>
              <div className="cf-traits">
                {TRAITS.map(([t, icon, d]) => (
                  <button
                    key={t}
                    type="button"
                    className="cf-trait"
                    aria-pressed={traits.includes(t)}
                    onClick={() => toggle(t)}
                  >
                    <span className="cf-tico">
                      <Icon name={icon} size={22} />
                    </span>
                    <b>{t}</b>
                    <span className="mut">{d}</span>
                    <span className="cf-tick" aria-hidden="true">
                      <Icon name="check" size={14} weight="bold" />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section aria-labelledby="fa-h">
              <h2 id="fa-h">What do you study?</h2>
              <p className="mut">
                Your faculty decides your courses, your lecturers and how hard
                exams feel.
              </p>
              {!meta?.faculties?.length ? (
                <Loader
                  label="Loading faculties"
                  size={36}
                  className="lo-inline"
                />
              ) : (
                <div className="cf-faculties">
                  {meta.faculties.map((f) => {
                    const [txt, n] = feel(DIFFICULTY[f.name] ?? 1);
                    const on = String(facultyId) === String(f.id);
                    return (
                      <button
                        key={f.id}
                        type="button"
                        className="cf-fac"
                        aria-pressed={on}
                        onClick={() => setFacultyId(f.id)}
                      >
                        <b>{short(f.name)}</b>
                        <span className="cf-diff">
                          <span
                            className="cf-meter"
                            data-n={n}
                            aria-hidden="true"
                          >
                            <i />
                            <i />
                            <i />
                          </span>
                          <span className="mut">{txt}</span>
                        </span>
                        <span className="cf-tick" aria-hidden="true">
                          <Icon name="check" size={14} weight="bold" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}
        </div>

        <div className="cf-bar">
          {step > 0 && (
            <button
              type="button"
              className="cf-back"
              onClick={() => go(step - 1)}
            >
              <Icon name="back" size={18} /> Back
            </button>
          )}
          {step < 2 ? (
            <button type="button" className="go cf-next" onClick={next}>
              Next <Icon name="next" size={18} />
            </button>
          ) : (
            <button
              type="button"
              className="go cf-next"
              disabled={busy}
              onClick={finish}
            >
              {busy ? (
                <>Rolling your life…</>
              ) : (
                <>
                  <Icon name="dice" size={20} /> Roll my life
                </>
              )}
            </button>
          )}
        </div>
        {step === 2 && (
          <p className="cf-fine mut">
            Your family is drawn once. You can't reroll it.
          </p>
        )}
      </div>
    </div>
  );
}

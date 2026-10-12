// components/AuthModal.js
"use client";
import "./auth-modal.css";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { call, notifyError } from "@/lib/client";
import { toast } from "@/lib/toast";
import { Icon } from "@/components/Icon";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/; // same rule the server applies
const EXIT_MS = 190;
const COPY = {
  signup: {
    title: "Create your account",
    sub: "Next, you'll pick your look and get dealt a life.",
    cta: "Start my life",
    busy: "Creating your account…",
    pw: "Create a password",
  },
  login: {
    title: "Welcome back",
    sub: "Pick up your story where you left off.",
    cta: "Log in",
    busy: "Logging in…",
    pw: "Your password",
  },
};
const DONE_LABEL = "You're in";
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), a[href], select, textarea, [tabindex]:not([tabindex="-1"])';

/* ---------- small pieces ---------- */
function Svg({ size = 20, children }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
const MailIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="14" rx="3.5" />
    <path d="m5 8.5 7 5 7-5" />
  </Svg>
);
const LockIcon = () => (
  <Svg>
    <rect x="4.5" y="10.5" width="15" height="10" rx="3" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Svg>
);

/** Height-animated show/hide. Hidden content is `inert`, so it can't be focused or read. */
function Collapse({ open, bleed = false, children }) {
  return (
    <div
      className="am-collapse"
      data-open={open ? "true" : "false"}
      inert={!open}
    >
      <div className={bleed ? "am-collapse-in am-bleed" : "am-collapse-in"}>
        {children}
      </div>
    </div>
  );
}

function strengthOf(pw) {
  if (!pw) return { level: 0, label: "" };
  if (pw.length < 8) return { level: 1, label: "Too short" };
  let pts = 0;
  if (pw.length >= 12) pts++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) pts++;
  if (/\d/.test(pw)) pts++;
  if (/[^A-Za-z0-9]/.test(pw)) pts++;
  if (pts <= 1) return { level: 2, label: "Okay" };
  if (pts === 2) return { level: 3, label: "Good" };
  return { level: 4, label: "Strong" };
}

function PasswordInput({
  id,
  inputRef,
  value,
  onChange,
  onBlur,
  autoComplete,
  placeholder,
  invalid,
  valid,
  describedBy,
  visible,
  onToggle,
  readOnly,
  name,
}) {
  return (
    <div className="am-control">
      <span className="am-lead">
        <LockIcon />
      </span>
      <input
        ref={inputRef}
        id={id}
        name={name}
        className="am-input am-has-trail"
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        readOnly={readOnly}
        aria-required="true"
        aria-invalid={invalid}
        data-valid={valid || undefined}
        aria-describedby={describedBy || undefined}
      />
      <button
        type="button"
        className="am-eye"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        onClick={onToggle}
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={20} />
      </button>
    </div>
  );
}

/* ---------- the modal ---------- */
export default function AuthModal({ initialMode = "signup", onClose }) {
  const router = useRouter();
  const uid = useId();
  const id = (k) => `${uid}-${k}`;

  const [mode, setMode] = useState(initialMode);
  const [f, setF] = useState({
    email: "",
    password: "",
    confirm: "",
    isAdult: false,
    remember: true,
  });
  const [touched, setTouched] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [vis, setVis] = useState({ pw: false, cf: false });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [closing, setClosing] = useState(false);
  const [shake, setShake] = useState(false);

  const dialogRef = useRef(null),
    emailRef = useRef(null),
    pwRef = useRef(null),
    cfRef = useRef(null),
    ageRef = useRef(null);
  const tabRefs = useRef({});
  const mounted = useRef(true);
  const lock = useRef(false),
    closingRef = useRef(false),
    timer = useRef(0),
    closeCb = useRef(onClose);

  const isSignup = mode === "signup";
  const c = COPY[mode];
  const locked = busy || done;

  useEffect(() => {
    closeCb.current = onClose;
  }, [onClose]);
  useEffect(() => {
    lock.current = busy || done;
  }, [busy, done]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (lock.current || closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    timer.current = window.setTimeout(() => closeCb.current?.(), EXIT_MS);
  }, []);

  // Lock page scroll, move focus in, and hand focus back to whatever opened the modal.
  useEffect(() => {
    const opener = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    emailRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = prevOverflow;
      if (opener instanceof HTMLElement && document.contains(opener))
        opener.focus({ preventScroll: true });
    };
  }, []);

  // Esc closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll(FOCUSABLE)].filter(
        (el) => !el.closest("[inert]"),
      );
      if (!items.length) return;
      const first = items[0],
        last = items[items.length - 1],
        active = document.activeElement;
      if (!root.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [requestClose]);

  /* validation: reward early, punish late (errors show after blur or a submit attempt) */
  const email = f.email.trim();
  const errors = {
    email: !email
      ? "Enter your email address."
      : !EMAIL_RE.test(email)
        ? "Enter a valid email address, like you@example.com."
        : "",
    password: isSignup
      ? f.password.length < 8
        ? "Use at least 8 characters."
        : ""
      : !f.password
        ? "Enter your password."
        : "",
    confirm: !isSignup
      ? ""
      : !f.confirm
        ? "Confirm your password."
        : f.confirm !== f.password
          ? "Passwords don't match."
          : "",
    age:
      isSignup && !f.isAdult ? "Confirm you're 18 or older to continue." : "",
  };
  // Messages are shown as toasts (on submit). The fields themselves only carry a quiet invalid state:
  // red border after a typed-but-wrong value is left, never for an untouched empty field.
  const filled = {
    email: !!email,
    password: !!f.password,
    confirm: !!f.confirm,
  };
  const marked = (k) => !!errors[k] && (attempted || (touched[k] && filled[k]));
  const matches = isSignup && !!f.confirm && f.confirm === f.password;
  const s = strengthOf(f.password);
  const helpOpen = isSignup && !f.password;

  const touch = (k) => () =>
    setTouched((t) => (t[k] ? t : { ...t, [k]: true }));
  const edit = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setF((p) => ({ ...p, [k]: v }));
    if (e.target.type === "checkbox" && k === "isAdult")
      setTouched((t) => ({ ...t, age: true }));
  };

  const bump = () => {
    setShake(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setShake(true)));
  };

  function switchMode(next, opts = {}) {
    if (locked || next === mode) return;
    setMode(next);
    setTouched({});
    setAttempted(false);
    setVis({ pw: false, cf: false });
    if (opts.focusTab)
      requestAnimationFrame(() => tabRefs.current[next]?.focus());
    if (opts.focusPassword) requestAnimationFrame(() => pwRef.current?.focus());
  }
  const onTabKey = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? "signup"
        : e.key === "End"
          ? "login"
          : isSignup
            ? "login"
            : "signup";
    switchMode(next, { focusTab: true });
  };

  async function submit(e) {
    e.preventDefault();
    if (locked) return;
    setAttempted(true);
    const firstBad = [
      ["email", emailRef],
      ["password", pwRef],
      ["confirm", cfRef],
      ["age", ageRef],
    ].find(([k]) => errors[k]);
    if (firstBad) {
      toast.error(errors[firstBad[0]], { id: "auth-invalid" });
      firstBad[1].current?.focus();
      bump();
      return;
    }
    setBusy(true);
    const body = isSignup
      ? { email, password: f.password, isAdult: true }
      : { email, password: f.password, remember: f.remember };
    const res = await call(isSignup ? "/api/signup" : "/api/login", body);
    if (res.failed) {
      if (mounted.current) {
        setBusy(false);
        bump();
      }
      if (res.status === 409) {
        toast.error(res.error ?? "That email is already registered.", {
          duration: 8000,
          action: {
            label: "Log in instead",
            onClick: () => {
              if (mounted.current) switchMode("login", { focusPassword: true });
            },
          },
        });
      } else notifyError(res, "We couldn't sign you in. Please try again.");
      return;
    }
    setDone(true);
    toast.success(
      isSignup
        ? "Account created successfully."
        : "Welcome back. You're logged in.",
    );
    router.push("/play");
  }

  return (
    <div
      ref={dialogRef}
      className="am-screen"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-labelledby={id("title")}
      aria-describedby={id("sub")}
    >
      <aside className="am-aside" aria-hidden="true">
        <span className="am-brand">
          life<i>in</i>oau
        </span>
        <div className="am-pitch">
          <p className="am-pitch-title">
            Live your OAU story with real people.
          </p>
          <p className="am-pitch-sub">
            Pick a look, get dealt a life, and see how far you go from your
            first lecture to your last.
          </p>
        </div>
      </aside>
      <div className="am-main">
        <div className="am-bar">
          <span className="am-brand am-brand-sm">
            life<i>in</i>oau
          </span>
          <button
            type="button"
            className="am-x"
            aria-label="Close"
            onClick={requestClose}
            disabled={locked}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
        <div
          className="am-col"
          data-shake={shake || undefined}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget && e.animationName === "am-shake")
              setShake(false);
          }}
        >
          <header className="am-head" key={mode}>
            <h2 id={id("title")} className="am-title">
              {c.title}
            </h2>
            <p id={id("sub")} className="am-sub">
              {c.sub}
            </p>
          </header>

          <div
            className="am-tabs"
            role="tablist"
            aria-label="Account"
            data-mode={mode}
          >
            <span className="am-thumb" aria-hidden="true" />
            {[
              ["signup", "Create account"],
              ["login", "Log in"],
            ].map(([m, label]) => (
              <button
                key={m}
                ref={(el) => {
                  tabRefs.current[m] = el;
                }}
                type="button"
                role="tab"
                id={id("tab-" + m)}
                className="am-tab"
                aria-selected={mode === m}
                aria-controls={id("panel")}
                tabIndex={mode === m ? 0 : -1}
                disabled={locked}
                onClick={() => switchMode(m)}
                onKeyDown={onTabKey}
              >
                {label}
              </button>
            ))}
          </div>

          <form
            id={id("panel")}
            role="tabpanel"
            aria-labelledby={id("tab-" + mode)}
            className="am-form"
            onSubmit={submit}
            noValidate
          >
            <div className="am-field">
              <label className="am-label" htmlFor={id("email")}>
                Email
              </label>
              <div className="am-control">
                <span className="am-lead">
                  <MailIcon />
                </span>
                <input
                  ref={emailRef}
                  id={id("email")}
                  name="email"
                  className="am-input"
                  type="email"
                  inputMode="email"
                  autoComplete={isSignup ? "email" : "username"}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={f.email}
                  onChange={edit("email")}
                  onBlur={touch("email")}
                  readOnly={locked}
                  aria-required="true"
                  aria-invalid={marked("email")}
                />
              </div>
            </div>

            <div className="am-field">
              <label className="am-label" htmlFor={id("pw")}>
                Password
              </label>
              <PasswordInput
                id={id("pw")}
                name="password"
                inputRef={pwRef}
                value={f.password}
                onChange={edit("password")}
                onBlur={touch("password")}
                autoComplete={isSignup ? "new-password" : "current-password"}
                placeholder={c.pw}
                invalid={marked("password")}
                describedBy={helpOpen ? id("pw-help") : ""}
                visible={vis.pw}
                onToggle={() => setVis((v) => ({ ...v, pw: !v.pw }))}
                readOnly={locked}
              />
              <Collapse open={isSignup && f.password.length > 0}>
                <div className="am-meter" data-level={s.level}>
                  <div className="am-bars" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="am-strength" aria-live="polite">
                    {s.label}
                  </span>
                </div>
              </Collapse>
              <Collapse open={helpOpen}>
                <p id={id("pw-help")} className="am-help">
                  At least 8 characters.
                </p>
              </Collapse>
            </div>

            <Collapse open={isSignup} bleed>
              <div className="am-field">
                <label className="am-label" htmlFor={id("cf")}>
                  Confirm password
                </label>
                <PasswordInput
                  id={id("cf")}
                  name="confirmPassword"
                  inputRef={cfRef}
                  value={f.confirm}
                  onChange={edit("confirm")}
                  onBlur={touch("confirm")}
                  autoComplete="new-password"
                  placeholder="Type it again"
                  invalid={marked("confirm")}
                  valid={matches}
                  visible={vis.cf}
                  onToggle={() => setVis((v) => ({ ...v, cf: !v.cf }))}
                  readOnly={locked}
                />
              </div>
            </Collapse>

            <Collapse open={isSignup} bleed>
              <div className="am-field">
                <label
                  className="am-check"
                  data-invalid={marked("age") ? "true" : undefined}
                >
                  <input
                    ref={ageRef}
                    type="checkbox"
                    name="isAdult"
                    checked={f.isAdult}
                    onChange={edit("isAdult")}
                    onBlur={touch("age")}
                    disabled={locked}
                    aria-invalid={marked("age")}
                  />
                  <span className="am-box" aria-hidden="true">
                    <Icon name="check" size={16} weight="bold" />
                  </span>
                  <span>I am 18 or older</span>
                </label>
              </div>
            </Collapse>

            <Collapse open={!isSignup} bleed>
              <div className="am-field">
                <label className="am-check">
                  <input
                    type="checkbox"
                    name="remember"
                    checked={f.remember}
                    onChange={edit("remember")}
                    disabled={locked}
                  />
                  <span className="am-box" aria-hidden="true">
                    <Icon name="check" size={16} weight="bold" />
                  </span>
                  <span>Keep me logged in on this device</span>
                </label>
              </div>
            </Collapse>

            <div className="am-actions">
              <button
                type="submit"
                className="am-submit"
                data-state={done ? "done" : busy ? "busy" : "idle"}
                disabled={locked}
                aria-busy={busy || undefined}
              >
                {done ? (
                  <>
                    <span className="am-pop">
                      <Icon name="check" size={20} weight="bold" />
                    </span>
                    {DONE_LABEL}
                  </>
                ) : busy ? (
                  <>
                    <span className="am-spin" aria-hidden="true" />
                    {c.busy}
                  </>
                ) : (
                  c.cta
                )}
              </button>
            </div>
          </form>

          <p className="am-foot">
            {isSignup ? "Already have an account?" : "New to lifeinoau?"}{" "}
            <button
              type="button"
              className="am-link"
              disabled={locked}
              onClick={() => switchMode(isSignup ? "login" : "signup")}
            >
              {isSignup ? "Log in" : "Create an account"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

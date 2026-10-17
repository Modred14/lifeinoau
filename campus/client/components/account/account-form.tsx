"use client";

import { useState, type FormEvent } from "react";
import { passwordProblem, usernameProblem, type AccountView } from "@campuslife/shared/account";
import { authErrorMessage, createAccount, hasDeviceSave, lastUsername, signIn } from "@campus/lib/api/auth";
import { GameIcon } from "../GameIcon";
import { PASSWORD_HINT, PASSWORD_PROBLEMS, USERNAME_PROBLEMS } from "./copy";
import { PasswordField } from "./password-field";
import { UsernameField } from "./username-field";

export type AccountMode = "sign-in" | "create";

const COPY = {
  "sign-in": { tab: "Sign in", submit: "Sign in", busy: "Signing in…" },
  create: { tab: "Create account", submit: "Create account", busy: "Creating account…" },
  password: "Password",
  forgot: "Forgot password?",
  deviceSave: "The progress saved on this device moves into your new account.",
};
const MODES: AccountMode[] = ["sign-in", "create"];

interface Props {
  mode: AccountMode;
  onMode: (mode: AccountMode) => void;
  onForgot: () => void;
  onSignedIn: (account: AccountView, recoveryCode?: string) => void;
}

export function AccountForm({ mode, onMode, onForgot, onSignedIn }: Props) {
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const creating = mode === "create";
  const copy = COPY[mode];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (creating) {
      const nameProblem = usernameProblem(username);
      const passProblem = passwordProblem(password, username);
      if (nameProblem || passProblem) return setError(nameProblem ? USERNAME_PROBLEMS[nameProblem] : PASSWORD_PROBLEMS[passProblem ?? "short"]);
    }
    setBusy(true);
    setError(undefined);
    try {
      if (creating) {
        const { recoveryCode, ...account } = await createAccount(username, password);
        onSignedIn(account, recoveryCode);
      } else {
        onSignedIn(await signIn(username, password));
      }
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="start-card" onSubmit={submit}>
      <div className="start-tabs" role="tablist" aria-label="Account">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={m === mode}
            className={m === mode ? "start-tab active" : "start-tab"}
            onClick={() => {
              setError(undefined);
              onMode(m);
            }}
          >
            {COPY[m].tab}
          </button>
        ))}
      </div>
      <UsernameField value={username} onChange={setUsername} showHint={creating} />
      <PasswordField id="password" label={COPY.password} value={password} onChange={setPassword} autoComplete={creating ? "new-password" : "current-password"} hint={creating ? PASSWORD_HINT : undefined} />
      {creating && hasDeviceSave() && <p className="start-saved">{COPY.deviceSave}</p>}
      {error && <p className="start-error" role="alert">{error}</p>}
      <button className="btn start-enter" type="submit" disabled={busy || !username || !password}>
        {busy ? copy.busy : copy.submit}
        <GameIcon name="arrow" />
      </button>
      {!creating && (
        <button type="button" className="link-btn start-link" onClick={onForgot}>
          {COPY.forgot}
        </button>
      )}
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { passwordProblem, type AccountView } from "@campuslife/shared/account";
import { authErrorMessage, lastUsername, resetPassword } from "@campus/lib/api/auth";
import { GameIcon } from "../GameIcon";
import { PASSWORD_HINT, PASSWORD_PROBLEMS } from "./copy";
import { PasswordField } from "./password-field";
import { UsernameField } from "./username-field";

const COPY = {
  title: "Reset password",
  code: "Recovery code",
  codePlaceholder: "XXXX-XXXX-XXXX-XXXX-XXXX",
  codeHint: "The code you saved when you created your account.",
  password: "New password",
  submit: "Set new password",
  busy: "Saving…",
  back: "Back to sign in",
};
const CODE_INPUT_MAX = 40;

export function ResetForm({ onBack, onSignedIn }: { onBack: () => void; onSignedIn: (account: AccountView, recoveryCode: string) => void }) {
  const [username, setUsername] = useState(lastUsername);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password, username);
    if (problem) return setError(PASSWORD_PROBLEMS[problem]);
    setBusy(true);
    setError(undefined);
    try {
      const { recoveryCode, ...account } = await resetPassword(username, code, password);
      onSignedIn(account, recoveryCode);
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="start-card" onSubmit={submit}>
      <div className="start-card-head">
        <h2>{COPY.title}</h2>
        <GameIcon name="key" />
      </div>
      <UsernameField value={username} onChange={setUsername} />
      <div className="start-name-field">
        <label htmlFor="recovery-code">{COPY.code}</label>
        <div className="start-input-wrap">
          <GameIcon name="key" />
          <input
            id="recovery-code"
            name="recovery-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, CODE_INPUT_MAX))}
            placeholder={COPY.codePlaceholder}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="recovery-code-hint"
          />
        </div>
        <small id="recovery-code-hint" className="start-hint">{COPY.codeHint}</small>
      </div>
      <PasswordField id="new-password" label={COPY.password} value={password} onChange={setPassword} autoComplete="new-password" hint={PASSWORD_HINT} />
      {error && <p className="start-error" role="alert">{error}</p>}
      <button className="btn start-enter" type="submit" disabled={busy || !username || !code || !password}>
        {busy ? COPY.busy : COPY.submit}
        <GameIcon name="arrow" />
      </button>
      <button type="button" className="link-btn start-link" onClick={onBack}>
        {COPY.back}
      </button>
    </form>
  );
}

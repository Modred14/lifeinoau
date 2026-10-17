"use client";

import { useState } from "react";
import { PASSWORD_MAX_LENGTH } from "@campuslife/shared/account";
import { GameIcon } from "../GameIcon";

const COPY = { show: "Show password", hide: "Hide password" };

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
}

export function PasswordField({ id, label, value, onChange, autoComplete, hint }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="start-name-field">
      <label htmlFor={id}>{label}</label>
      <div className="start-input-wrap">
        <GameIcon name="lock" />
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={PASSWORD_MAX_LENGTH}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button type="button" className="password-toggle" aria-label={visible ? COPY.hide : COPY.show} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          <GameIcon name={visible ? "eyeOff" : "eye"} />
        </button>
      </div>
      {hint && <small id={`${id}-hint`} className="start-hint">{hint}</small>}
    </div>
  );
}

"use client";

import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PREFIX, cleanUsernameInput } from "@campuslife/shared/account";

const COPY = {
  label: "Username",
  placeholder: "tolu_04",
  hint: `${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} letters, numbers or underscores. This is the name other students see.`,
};

export function UsernameField({ value, onChange, showHint = false }: { value: string; onChange: (value: string) => void; showHint?: boolean }) {
  return (
    <div className="start-name-field">
      <label htmlFor="username">{COPY.label}</label>
      <div className="start-input-wrap">
        <span className="start-at" aria-hidden="true">{USERNAME_PREFIX}</span>
        <input
          id="username"
          name="username"
          value={value}
          onChange={(e) => onChange(cleanUsernameInput(e.target.value))}
          placeholder={COPY.placeholder}
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          aria-describedby={showHint ? "username-hint" : undefined}
        />
      </div>
      {showHint && <small id="username-hint" className="start-hint">{COPY.hint}</small>}
    </div>
  );
}

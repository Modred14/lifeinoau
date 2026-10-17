"use client";

import { useState } from "react";
import { GameIcon } from "../GameIcon";

const COPY = {
  title: "Save your recovery code",
  body: "This code is the only way to reset your password if you forget it. Write it down or save it somewhere safe. We can't show it again.",
  copy: "Copy code",
  copied: "Copied",
  failed: "Couldn't copy. Write it down instead.",
  done: "I've saved it",
};

export function RecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <section className="start-card" aria-labelledby="recovery-title">
      <div className="start-card-head">
        <h2 id="recovery-title">{COPY.title}</h2>
        <GameIcon name="key" />
      </div>
      <p className="start-saved">{COPY.body}</p>
      <output className="recovery-code">{code}</output>
      <button type="button" className="btn btn-ghost" onClick={copy}>
        <GameIcon name={status === "copied" ? "check" : "copy"} />
        {status === "copied" ? COPY.copied : COPY.copy}
      </button>
      {status === "failed" && <p className="start-error" role="alert">{COPY.failed}</p>}
      <button type="button" className="btn start-enter" onClick={onDone}>
        {COPY.done}
        <GameIcon name="arrow" />
      </button>
    </section>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
// Import the narrow subpath (not the package index) so the Colyseus schema
// code stays out of the start screen's initial bundle.
import { formatHandle, type AccountView } from "@campuslife/shared/account";
import { authErrorMessage, fetchAccount, lastUsername, signOut } from "@campus/lib/api/auth";
import { SITE_NAME } from "@campus/lib/site";
import { AccountForm, type AccountMode } from "./account/account-form";
import { RecoveryCode } from "./account/recovery-code";
import { ResetForm } from "./account/reset-form";
import { StudentForm, type StudentDetails } from "./account/student-form";
import { Brand } from "./Brand";
import { GameIcon } from "./GameIcon";
import "./account/account.css";

export interface EnterDetails {
  /** The player's handle, with the @. */
  name: string;
  school: string;
  level: string;
  department: string;
  fresh: boolean;
}

type Step =
  | { kind: "checking" }
  | { kind: "failed"; message: string }
  | { kind: "signed-out"; form: AccountMode | "reset" }
  | { kind: "recovery"; account: AccountView; code: string }
  | { kind: "ready"; account: AccountView };

const COPY = {
  checking: "Checking your account…",
  retry: "Try again",
  welcome: "Welcome back",
  continue: "Continue your life",
  fresh: "Start a new life",
  signOut: "Sign out",
  saveNote: "Your progress saves to your account.",
  footer: "Multiplayer campus life",
};

export function StartScreen({ onEnter, error }: { onEnter: (details: EnterDetails) => void; error?: string }) {
  const [step, setStep] = useState<Step>({ kind: "checking" });
  const [fresh, setFresh] = useState(false);

  const check = useCallback(() => {
    setStep({ kind: "checking" });
    fetchAccount()
      .then((account) => setStep(account ? { kind: "ready", account } : { kind: "signed-out", form: lastUsername() ? "sign-in" : "create" }))
      .catch((err: unknown) => setStep({ kind: "failed", message: authErrorMessage(err) }));
  }, []);

  useEffect(check, [check]);

  function signedIn(account: AccountView, code?: string) {
    setFresh(false);
    setStep(code ? { kind: "recovery", account, code } : { kind: "ready", account });
  }

  function leaveAccount() {
    setStep({ kind: "checking" });
    signOut()
      .then(() => setStep({ kind: "signed-out", form: "sign-in" }))
      .catch((err: unknown) => setStep({ kind: "failed", message: authErrorMessage(err) }));
  }

  function enter(account: AccountView, details?: StudentDetails) {
    onEnter({ name: formatHandle(account.username), school: details?.school ?? "", level: details?.level ?? account.level ?? "", department: details?.department ?? "", fresh: !!details && fresh });
  }

  return (
    <main className="start game-start">
      <div className="start-world" aria-hidden="true">
        <img className="start-art" src="/campus/brand/campus-scene.webp" alt="" width={1440} height={960} fetchPriority="high" />
      </div>
      <div className="start-menu">
        <header className="start-identity" aria-label={SITE_NAME}>
          <h1 className="start-logo"><Brand /></h1>
        </header>

        {step.kind === "checking" && (
          <div className="start-card start-checking" role="status">
            <p className="start-saved">{COPY.checking}</p>
            <span className="loading-track" aria-hidden="true" />
          </div>
        )}

        {step.kind === "failed" && (
          <div className="start-card">
            <p className="start-error" role="alert">{step.message}</p>
            <button type="button" className="btn" onClick={check}>{COPY.retry}</button>
          </div>
        )}

        {step.kind === "signed-out" && step.form === "reset" && <ResetForm onBack={() => setStep({ kind: "signed-out", form: "sign-in" })} onSignedIn={signedIn} />}

        {step.kind === "signed-out" && step.form !== "reset" && (
          <AccountForm mode={step.form} onMode={(form) => setStep({ kind: "signed-out", form })} onForgot={() => setStep({ kind: "signed-out", form: "reset" })} onSignedIn={signedIn} />
        )}

        {step.kind === "recovery" && <RecoveryCode code={step.code} onDone={() => setStep({ kind: "ready", account: step.account })} />}

        {step.kind === "ready" && step.account.hasSave && !fresh && (
          <section className="start-card" aria-labelledby="welcome-title">
            <div className="start-card-head">
              <h2 id="welcome-title">{COPY.welcome}</h2>
              <GameIcon name="wave" />
            </div>
            <p className="start-handle">{formatHandle(step.account.username)}</p>
            <button type="button" className="btn start-enter" onClick={() => enter(step.account)}>
              {COPY.continue}
              <GameIcon name="arrow" />
            </button>
            <div className="start-links">
              <button type="button" className="link-btn start-link" onClick={() => setFresh(true)}>{COPY.fresh}</button>
              <button type="button" className="link-btn start-link" onClick={leaveAccount}>{COPY.signOut}</button>
            </div>
          </section>
        )}

        {step.kind === "ready" && (!step.account.hasSave || fresh) && (
          <>
            <StudentForm handle={formatHandle(step.account.username)} wipes={fresh} onKeepSave={() => setFresh(false)} onSubmit={(details) => enter(step.account, details)} />
            {!fresh && <button type="button" className="link-btn start-link" onClick={leaveAccount}>{COPY.signOut}</button>}
          </>
        )}

        {error && step.kind !== "checking" && (
          <p className="start-error start-join-error" role="alert">
            {error}
          </p>
        )}
        <p className="start-save-note"><GameIcon name="wallet" />{COPY.saveNote}</p>
        <div className="start-footer"><GameIcon name="people" /><span>{COPY.footer}</span></div>
      </div>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MarketError, type RiderQueue } from "@campuslife/shared/market/orders";
import { MarketRequestError, getRiderQueue, marketErrorMessage } from "@campus/lib/api/market";
import { RiderOrder } from "./rider-order";
import "./rider.css";

const POLL_MS = 10_000;
const COPY = {
  title: "Rider orders",
  loading: "Loading orders…",
  signedOut: "Sign in to OAU Life first, then come back to this page.",
  signIn: "Go to sign in",
  notRider: "This page is for riders. Ask the OAU Life team to add your account.",
  mine: "My deliveries",
  noneMine: "You have no deliveries in progress.",
  open: "New orders",
  noneOpen: "No new orders right now. This page checks again every few seconds.",
  refresh: "Refresh",
};

type State = { kind: "loading" } | { kind: "ready"; queue: RiderQueue } | { kind: "blocked"; code: "signed_out" | "forbidden" } | { kind: "error"; message: string };

export function RiderBoard() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(async () => {
    try {
      setState({ kind: "ready", queue: await getRiderQueue() });
    } catch (err) {
      if (err instanceof MarketRequestError && (err.code === MarketError.SignedOut || err.code === MarketError.Forbidden)) setState({ kind: "blocked", code: err.code });
      else setState((current) => (current.kind === "ready" ? current : { kind: "error", message: marketErrorMessage(err) }));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <main className="rd">
      <header className="rd-head">
        <h1>{COPY.title}</h1>
        <button type="button" className="rd-btn rd-btn-quiet" onClick={() => void load()}>{COPY.refresh}</button>
      </header>
      {state.kind === "loading" && <p role="status">{COPY.loading}</p>}
      {state.kind === "error" && <p className="rd-error" role="alert">{state.message}</p>}
      {state.kind === "blocked" && state.code === MarketError.SignedOut && (
        <>
          <p>{COPY.signedOut}</p>
          <Link className="rd-btn" href="/">{COPY.signIn}</Link>
        </>
      )}
      {state.kind === "blocked" && state.code === MarketError.Forbidden && <p>{COPY.notRider}</p>}
      {state.kind === "ready" && (
        <>
          <h2>{COPY.mine}</h2>
          {state.queue.mine.length ? <ul className="rd-list">{state.queue.mine.map((o) => <RiderOrder key={o.id} order={o} onChanged={load} />)}</ul> : <p className="rd-muted">{COPY.noneMine}</p>}
          <h2>{COPY.open}</h2>
          {state.queue.open.length ? <ul className="rd-list">{state.queue.open.map((o) => <RiderOrder key={o.id} order={o} onChanged={load} />)}</ul> : <p className="rd-muted">{COPY.noneOpen}</p>}
        </>
      )}
    </main>
  );
}

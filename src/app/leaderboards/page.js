// src/app/leaderboards/page.js
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, naira, notifyError, loggedOut } from "@/lib/client";
import LoadError from "@/components/LoadError";
import Loader from "@/components/Loader";

const TABS = [
  ["forbes", "FORBES"],
  ["cgpa", "CGPA"],
  ["popular", "Popular"],
  ["party", "Party"],
  ["hustler", "Hustlers"],
  ["business", "Business"],
];
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function Boards() {
  const router = useRouter(),
    [key, setKey] = useState("forbes"),
    [b, setB] = useState(null),
    [failed, setFailed] = useState(false),
    [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setB(null);
    setFailed(false);
    call("/api/leaderboard?board=" + key).then((r) => {
      if (!live) return;
      if (r.status === 401) return loggedOut(router);
      if (r.failed) {
        notifyError(r);
        setFailed(true);
        return;
      }
      setB(r);
    });
    return () => {
      live = false;
    };
  }, [key, router, tries]);
  return (
    <>
      <div className="top">
        <h2>{key === "forbes" ? "FORBES OAU" : "Leaderboards"}</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      <div className="row" role="tablist">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={key === k}
            className={key === k ? "on" : ""}
            onClick={() => setKey(k)}
          >
            {l}
          </button>
        ))}
      </div>
      {failed && (
        <LoadError
          title="This board didn't load"
          onRetry={() => setTries((t) => t + 1)}
        />
      )}
      {!b && !failed && <Loader label="Loading leaderboards" />}
      {b?.unavailable && (
        <div className="card">
          <p>{b.unavailable}</p>
        </div>
      )}
      {b && !b.unavailable && (
        <div className="card">
          <b>{b.title}</b>
          {b.note && <p className="mut">{b.note}</p>}
          {b.rows.length ? (
            b.rows.map((r) => (
              <div className="led" key={r.rank + r.name}>
                <span>
                  {MEDAL[r.rank] ?? r.rank + "."} <b>{r.name}</b>
                  {r.graduated && " 🎓"}
                  <br />
                  <span className="mut">
                    {r.class} · {r.faculty}
                    {r.sub && ` · ${r.sub}`}
                  </span>
                  {r.cash != null && (
                    <>
                      <br />
                      <span className="mut">
                        Cash {naira(r.cash)} · Business {naira(r.business)} ·
                        Invested {naira(r.investments)}
                      </span>
                    </>
                  )}
                </span>
                <b className={key === "forbes" ? "cash" : ""}>
                  {r.money ? naira(r.value) : r.value}
                </b>
              </div>
            ))
          ) : (
            <p className="mut">Nobody here yet. Be the first.</p>
          )}
          <p className="mut">
            Updated {new Date(b.updatedAt).toLocaleTimeString()}. Refreshes
            about once a minute.
          </p>
        </div>
      )}
    </>
  );
}
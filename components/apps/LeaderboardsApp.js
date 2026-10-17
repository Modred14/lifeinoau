// components/apps/LeaderboardsApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { useState } from "react";
import { naira } from "@/lib/client";
import { useResource } from "@/lib/gameStore";
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
const MEDAL = { 1: "#d9a441", 2: "#aeb7c4", 3: "#b7794a" };

export default function Boards() {
  // Each board is kept after it has been seen: switching tabs (or reopening the app) shows it at once and refreshes it quietly,
  // instead of blanking the screen and asking the server again every time. A slow answer for one tab can never land on another.
  const [key, setKey] = useState("forbes");
  const { d: b, load, loadFailed: failed } = useResource("/api/leaderboard?board=" + key);
  return (
    <>
      <div className="top">
        <h2>{key === "forbes" ? "FORBES OAU" : "Leaderboards"}</h2>
        <a href="/home">
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
          onRetry={load}
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
                  <i className="rk" style={MEDAL[r.rank] ? { background: MEDAL[r.rank], color: "#10151f" } : undefined}>{r.rank}</i> <b>{r.name}</b>
                  {r.graduated && <span className="mut"> · graduated</span>}
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
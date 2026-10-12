// src/app/achievements/page.js
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { call, notifyError, loggedOut } from "@/lib/client";

export default function Achievements() {
  const router = useRouter(),
    [list, setList] = useState(null),
    [failed, setFailed] = useState(false),
    [tries, setTries] = useState(0);
  useEffect(() => {
    call("/api/achievements").then((r) => {
      if (r.status === 401) return loggedOut(router);
      if (r.failed) {
        notifyError(r);
        setFailed(true);
        return;
      }
      setList(r.achievements);
    });
  }, [router, tries]);
  const got = list?.filter((a) => a.earned).length ?? 0;
  return (
    <>
      <div className="top">
        <h2>Achievements</h2>
        <a href="/play">
          <button>Back to game</button>
        </a>
      </div>
      {failed && (
        <div className="card">
          <p className="mut">Your achievements didn&apos;t load.</p>
          <button
            onClick={() => {
              setFailed(false);
              setTries((t) => t + 1);
            }}
          >
            Try again
          </button>
        </div>
      )}
      {list && (
        <p className="mut">
          {got} of {list.filter((a) => !a.unavailable).length} unlocked
        </p>
      )}
      <div className="row">
        {list?.map((a) => (
          <div
            className="card"
            key={a.key}
            style={{
              flex: "1 1 220px",
              opacity: a.earned ? 1 : 0.6,
              borderColor: a.earned ? "var(--acc)" : undefined,
            }}
          >
            <b>
              {a.earned ? "🏆" : a.unavailable ? "⏳" : "🔒"} {a.title}
            </b>
            <p className="mut">{a.text}</p>
            <p className="mut">
              {a.earned
                ? `Earned in week ${a.earnedWeek}`
                : (a.unavailable ?? "Locked")}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

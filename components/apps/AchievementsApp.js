// components/apps/AchievementsApp.js: lives inside the phone (see components/Phone.js)
"use client";
import { Icon } from "../Icon";
import LoadError from "@/components/LoadError";
import { useResource } from "@/lib/gameStore";

export default function Achievements() {
  // Kept between visits: reopening shows the list at once and refreshes it quietly.
  const { d, load, loadFailed: failed } = useResource("/api/achievements");
  const list = d?.achievements ?? null;
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
        <LoadError
          title="Your achievements didn't load"
          onRetry={load}
        />
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
              <Icon name={a.earned ? "medal" : a.unavailable ? "timer" : "lock"} size={18} weight={a.earned ? "fill" : "regular"} /> {a.title}
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
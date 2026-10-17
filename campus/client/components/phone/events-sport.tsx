import { CampusDropdown } from "../CampusDropdown";
import { useMemo, useState } from "react";
import {
  CUP_NAME,
  DAYS,
  FACULTY_TEAMS,
  LEAGUE_NAME,
  PREDICT,
  SUPPORTED_CLUBS,
  findClub,
  gameTime,
  leagueSeason,
  matchByKey,
  nextPredictable,
  pitchOn,
  seasonOf,
  tableOf,
  type WhatsOnItem,
} from "@campuslife/shared";
import { PiMinusBold, PiPlusBold, PiSoccerBallFill, PiTrophyFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";
import type { Social } from "@campus/game/social/use-social";
import { EventRows } from "./events-rows";
import { hhmm, naira } from "./format";

const FIXTURE_DAYS = 4;
const TABLE_ROWS = 6;
const REFRESH_MINUTES = 5;
const TEXT = {
  club: "Your club",
  pick: "Pick your club",
  pickNote: "Choose once. Extra fun when they win at the viewing centre, and yabs when they lose.",
  choose: "Support",
  fan: (name: string) => `You support ${name}. Fan na for life.`,
  card: "Predict and win",
  cardNote: `Free card, no stake. Exact score wins ${naira(PREDICT.exact)}. Right winner wins ${naira(PREDICT.outcome)}. Cash for ${PREDICT.cashWinsPerWeek} winning cards a week, fun after that. Submit at the fixtures board in a hall viewing centre before kick-off.`,
  submit: "Submit card",
  noMatch: "No match on the card for now.",
  mine: (line: string) => `Your card: ${line}. Result comes at full time.`,
  wins: (count: number) => `Cards won: ${count}`,
  fixtures: "Faculty football",
  noFixtures: "No faculty match in the next few days.",
  table: LEAGUE_NAME,
  cup: (name: string) => `${CUP_NAME} holders this season: ${name}`,
  yours: "your faculty",
  less: "One goal less",
  more: "One goal more",
};

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="ph-row">
      <b>{label}</b>
      <span className="ph-row">
        <button type="button" className="ph-btn ph-btn-quiet" disabled={value <= 0} onClick={() => onChange(value - 1)} aria-label={`${TEXT.less}: ${label}`}>
          <PiMinusBold aria-hidden="true" />
        </button>
        <b className="ph-time" aria-live="polite">
          {value}
        </b>
        <button type="button" className="ph-btn ph-btn-quiet" disabled={value >= PREDICT.maxGoals} onClick={() => onChange(value + 1)} aria-label={`${TEXT.more}: ${label}`}>
          <PiPlusBold aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function ClubCard({ social }: { social: Social }) {
  const [code, setCode] = useState(SUPPORTED_CLUBS[0]?.code ?? "");
  const club = findClub(social.status?.club);
  if (club) return <p className="ph-note">{TEXT.fan(club.name)}</p>;
  return (
    <div className="ph-card">
      <label className="ph-row">
        <b>{TEXT.pick}</b>
        <CampusDropdown label="Football club" value={code} onChange={setCode} options={SUPPORTED_CLUBS.map((club) => ({ value: club.code, label: club.name }))} />
      </label>
      <p className="ph-note">{TEXT.pickNote}</p>
      <button type="button" className="ph-btn" disabled={!code} onClick={() => social.send({ a: "club", code })}>
        {TEXT.choose}
      </button>
    </div>
  );
}

function PredictCard({ social }: { social: Social }) {
  const [home, setHome] = useState(1);
  const [away, setAway] = useState(0);
  const mine = social.status?.predict;
  const held = mine ? matchByKey(mine.key) : undefined;
  const next = nextPredictable(social.time);
  return (
    <div className="ph-card">
      <p className="ph-note">{TEXT.cardNote}</p>
      {mine && held ? (
        <p>
          <PiSoccerBallFill aria-hidden="true" /> {TEXT.mine(`${held.home.name} ${mine.home} to ${mine.away} ${held.away.name}`)}
        </p>
      ) : next ? (
        <>
          <p>
            <b>
              {next.home.name} v {next.away.name}
            </b>
            <br />
            <small>
              {next.competition} · {DAYS[gameTime(next.startTotal).weekday]} {hhmm(next.kickoff)}
            </small>
          </p>
          <Stepper label={next.home.name} value={home} onChange={setHome} />
          <Stepper label={next.away.name} value={away} onChange={setAway} />
          <button type="button" className="ph-btn" onClick={() => social.send({ a: "predict", home, away })}>
            {TEXT.submit}
          </button>
        </>
      ) : (
        <p className="ph-note">{TEXT.noMatch}</p>
      )}
      {social.status && social.status.wins > 0 ? <p className="ph-note">{TEXT.wins(social.status.wins)}</p> : null}
    </div>
  );
}

export function EventsSport({ view, social, onClose }: { view: CampusView; social: Social; onClose: () => void }) {
  const { time, status } = social;
  const slot = Math.floor(time.total / REFRESH_MINUTES);
  const fixtures = useMemo(() => pitchOn(gameTime(slot * REFRESH_MINUTES), FIXTURE_DAYS), [slot]);
  const season = leagueSeason(seasonOf(time.dayIndex));
  const table = tableOf(season.league, time.total).slice(0, TABLE_ROWS);
  const crowned = season.final && time.total >= season.final.endTotal ? FACULTY_TEAMS[season.champion] : undefined;
  const day = (item: WhatsOnItem) => DAYS[gameTime(item.startTotal).weekday].slice(0, 3);
  return (
    <>
      <h3 className="ph-heading">{TEXT.club}</h3>
      <ClubCard social={social} />
      <h3 className="ph-heading">{TEXT.card}</h3>
      <PredictCard social={social} />
      <h3 className="ph-heading">{TEXT.fixtures}</h3>
      <EventRows view={view} items={fixtures} total={time.total} empty={TEXT.noFixtures} day={day} onClose={onClose} />
      <h3 className="ph-heading">{TEXT.table}</h3>
      <ul className="ph-list">
        {table.map((row, i) => (
          <li key={row.team} className={row.team === status?.faculty ? "ph-list-row ph-live" : "ph-list-row"}>
            <span className="ph-time">{i + 1}</span>
            <span className="ph-list-text">
              <b>{FACULTY_TEAMS[row.team].name}</b>
              <small>
                P{row.played} W{row.won} D{row.drawn} L{row.lost}
                {row.team === status?.faculty ? ` · ${TEXT.yours}` : ""}
              </small>
            </span>
            <b>{row.points} pts</b>
          </li>
        ))}
      </ul>
      {crowned ? (
        <p className="ph-note">
          <PiTrophyFill aria-hidden="true" /> {TEXT.cup(crowned.name)}
        </p>
      ) : null}
    </>
  );
}

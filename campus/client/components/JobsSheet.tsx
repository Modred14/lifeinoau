"use client";

/**
 * "Hustle" sheet: the ways to make money on campus, what they pay, and a
 * button that takes you there (riding the shuttle when that's quicker).
 * Loaded lazily so the map data stays out of the start bundle.
 */
import {
  BACKGROUND_INFO,
  BACKGROUNDS,
  DELIVERY_FEE,
  JOB_PAY,
  LOAN_AMOUNT,
  LOAN_REPAY,
  MOTOR_PARK,
  PLACES,
  PLAYER_FARE,
  SKILL_INFO,
  STOP_FARE,
  TUTOR_MIN_STUDY,
  type Point,
} from "@campuslife/shared";
import type { CampusView, Stats } from "@campus/game/CampusView";
import { ContextIcon, GameIcon } from "./GameIcon";
import { GamePanel } from "./GamePanel";
import { HustleJobs } from "./jobs/hustle-jobs";

const placeDoor = (re: RegExp): Point | undefined => PLACES.find((p) => re.test(p.name))?.door;

export default function JobsSheet({ view, stats, background, rider, onClose }: { view: CampusView; stats: Stats | null; background: string; rider: boolean; onClose: () => void }) {
  const jobs: { icon: string; title: string; pay: string; how: string; where: string; target?: Point; locked?: string }[] = [
    {
      icon: "🚐",
      title: "Shuttle driver",
      pay: `₦${STOP_FARE}/passenger at stops, ₦${PLAYER_FARE} from students`,
      how: "Start a shift at the motor park by SUB, drive the route and wait at bus stops.",
      where: "Motor park (SUB)",
      target: MOTOR_PARK,
    },
    {
      icon: "🍲",
      title: "Buka kitchen",
      pay: `₦${JOB_PAY.cook} per shift`,
      how: "Help in the kitchen at the SUB food court or any hall buka.",
      where: "Student Union Building",
      target: placeDoor(/student union/i),
    },
    {
      icon: "📚",
      title: "Tutor",
      pay: `₦${JOB_PAY.tutor} per session`,
      how: "Take the tutorial desk in the library and teach.",
      where: "Hezekiah Oluwasanmi Library",
      target: placeDoor(/oluwasanmi library/i),
      locked: stats && stats.study < TUTOR_MIN_STUDY ? `Needs ${TUTOR_MIN_STUDY} study points (you have ${stats.study})` : undefined,
    },
    {
      icon: "🏦",
      title: "Microfinance loan",
      pay: `Borrow ₦${LOAN_AMOUNT.toLocaleString("en-NG")}, repay ₦${LOAN_REPAY.toLocaleString("en-NG")} from job pay`,
      how: "Loan desk inside any bank on Bank Road.",
      where: "OAU Microfinance Bank",
      target: placeDoor(/microfinance/i),
      locked: stats && stats.debt > 0 ? `You still owe ₦${stats.debt.toLocaleString("en-NG")}` : undefined,
    },
  ];

  const go = (target: Point, name: string) => {
    view.goTo(target, name);
    onClose();
  };

  const bg = BACKGROUNDS.includes(background as never) ? BACKGROUND_INFO[background as keyof typeof BACKGROUND_INFO] : undefined;

  return (
    <GamePanel className="sheet jobs" label="Hustle" onClose={onClose}>
      <div className="jobs-head">
        <h2><GameIcon name="work" />Hustle</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close">
          <GameIcon name="close" />
        </button>
      </div>
      {bg && (
        <p className="jobs-bg">
          <ContextIcon symbol={bg.icon} /> <b>{bg.label}</b>: allowance ₦{bg.allowance.toLocaleString("en-NG")} at any ATM.
        </p>
      )}
      {stats && (
        <div className="jobs-skills">
          {(Object.keys(SKILL_INFO) as (keyof typeof SKILL_INFO)[]).map((k) => (
            <span key={k} className="chip">
              <ContextIcon symbol={SKILL_INFO[k].icon} />{SKILL_INFO[k].label} {stats.skills[k]}
            </span>
          ))}
        </div>
      )}
      <ul className="jobs-list">
        <li className="job">
          <span className="job-icon" aria-hidden>
            <GameIcon name="rider" />
          </span>
          <div className="job-body">
            <b>Delivery rider</b>
            <span className="job-pay">₦{DELIVERY_FEE} per delivery</span>
            <small>Go online anywhere. Accept an order, pick it up at the buka, deliver to the student who ordered.</small>
          </div>
          <button
            className="btn job-go"
            onClick={() => {
              view.setRiderDuty(!rider);
              onClose();
            }}
          >
            {rider ? "Go offline" : "Go online"}
          </button>
        </li>
        {jobs.map((j) => (
          <li key={j.title} className="job">
            <span className="job-icon" aria-hidden>
              <ContextIcon symbol={j.icon} />
            </span>
            <div className="job-body">
              <b>{j.title}</b>
              <span className="job-pay">{j.pay}</span>
              <small>{j.locked ?? j.how}</small>
            </div>
            {j.target && (
              <button className="btn job-go" disabled={!!j.locked} onClick={() => go(j.target!, j.where)}>
                Go
              </button>
            )}
          </li>
        ))}
        <HustleJobs view={view} onClose={onClose} />
      </ul>
      <p className="jobs-foot">Skills grow every shift, and higher skill means better pay.</p>
    </GamePanel>
  );
}

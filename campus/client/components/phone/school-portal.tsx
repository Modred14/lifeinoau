"use client";

import { useEffect, useState } from "react";
import { PiCheckCircleFill, PiHourglassMediumFill, PiWarningFill } from "react-icons/pi";
import { REGISTRATION } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import { usePending } from "@campus/components/use-pending";
import { SchoolHostel } from "./school-hostel";

export type Admin = ReturnType<CampusView["getAdmin"]>;
type Go = (target: { x: number; y: number }, name: string) => void;

const POLL_MS = 500;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const CENTRE_NAME = "Business centre";
const TEXT = {
  heading: "Course registration",
  open: (left: string) => `Registration closes Tuesday 18:00. ${left} left. Lectures start Wednesday.`,
  closed: (fine: string) => `Registration closed on Tuesday 18:00. Late registration costs ${fine}.`,
  done: "Registered for this semester",
  doneLate: "Registered late for this semester",
  up: "Portal is up",
  slow: (queue: number) => `Portal is busy. Number ${queue} in the queue`,
  down: "Service unavailable, try again",
  register: "Register courses",
  centre: (cost: string) => `Business centre: run am for me (${cost})`,
  goCentre: "Go to a business centre",
  centreNote: "A business centre kiosk can register you even when the portal is down.",
  penalty: (marks: number) => `No registration: each paper loses ${marks} marks after Tuesday 18:00. Attendance still counts.`,
  carry: "Carry-over",
};

const naira = (amount: number) => `₦${amount.toLocaleString("en-NG")}`;

function span(minutes: number): string {
  const days = Math.floor(minutes / (MINUTES_PER_HOUR * HOURS_PER_DAY));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  if (days > 0) return `${days}d ${hours}h`;
  return hours > 0 ? `${hours}h ${minutes % MINUTES_PER_HOUR}m` : `${minutes}m`;
}

export function useAdmin(view: CampusView): Admin {
  const [admin, setAdmin] = useState<{ key: string; value: Admin }>(() => {
    const value = view.getAdmin();
    return { key: JSON.stringify(value), value };
  });
  useEffect(() => {
    const timer = window.setInterval(() => {
      const value = view.getAdmin();
      const key = JSON.stringify(value);
      setAdmin((current) => (current.key === key ? current : { key, value }));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [view]);
  return admin.value;
}

function PortalState({ portal }: { portal: Admin["portal"] }) {
  if (portal.state === "down") {
    return (
      <span className="ph-tag ph-tag-bad">
        <PiWarningFill aria-hidden="true" /> {TEXT.down}
      </span>
    );
  }
  if (portal.state === "slow") {
    return (
      <span className="ph-tag ph-tag-warn">
        <PiHourglassMediumFill aria-hidden="true" /> {TEXT.slow(portal.queue)}
      </span>
    );
  }
  return (
    <span className="ph-tag">
      <PiCheckCircleFill aria-hidden="true" /> {TEXT.up}
    </span>
  );
}

export function SchoolPortal({ view, go }: { view: CampusView; go: Go }) {
  const admin = useAdmin(view);
  const { portal } = admin;
  const [pending, act] = usePending(admin);
  return (
    <>
      <h3 className="ph-heading">{TEXT.heading}</h3>
      <p className="ph-note">{portal.open ? TEXT.open(span(portal.closesIn)) : TEXT.closed(naira(portal.portalCost))}</p>
      <div className="ph-card ph-course">
        <PortalState portal={portal} />
        {portal.registered ? (
          <span className="ph-tag">
            <PiCheckCircleFill aria-hidden="true" /> {portal.late ? TEXT.doneLate : TEXT.done}
          </span>
        ) : (
          <>
            <button type="button" className="ph-btn" disabled={portal.state !== "up" || pending} onClick={() => act(() => view.sendAdmin({ a: "register" }))}>
              {TEXT.register}
              {portal.portalCost > 0 ? ` (${naira(portal.portalCost)})` : ""}
            </button>
            {portal.nearCentre ? (
              <button type="button" className="ph-btn ph-btn-quiet" disabled={pending} onClick={() => act(() => view.sendAdmin({ a: "centre" }))}>
                {TEXT.centre(naira(portal.centreCost))}
              </button>
            ) : (
              portal.centre && (
                <button type="button" className="ph-btn ph-btn-quiet" onClick={() => portal.centre && go(portal.centre, CENTRE_NAME)}>
                  {TEXT.goCentre}
                </button>
              )
            )}
            <small>{TEXT.centreNote}</small>
          </>
        )}
      </div>
      {!portal.registered && <p className="ph-note">{TEXT.penalty(REGISTRATION.testPenalty)}</p>}
      <ul className="ph-list">
        {portal.courses.map((course) => (
          <li key={course.code} className="ph-list-row">
            <span className="ph-list-text">
              <b>
                {course.code} · {course.units} units
              </b>
              <small>{course.title}</small>
              {course.carry && <span className="ph-tag ph-tag-warn">{TEXT.carry}</span>}
            </span>
          </li>
        ))}
      </ul>
      <SchoolHostel view={view} hostel={admin.hostel} />
    </>
  );
}

"use client";

import type { CampusView } from "@campus/game/CampusView";
import { ContextIcon } from "../GameIcon";
import { useAdmin } from "../phone/school-portal";

type Hustle = ReturnType<CampusView["getAdmin"]>["hustles"][number];

const TEXT = {
  pay: (hustle: Hustle) => (hustle.spec.id === "tray" ? `₦${hustle.spec.basePay} a customer, more at rush hours` : `₦${hustle.spec.basePay.toLocaleString("en-NG")} per shift`),
  facts: (hustle: Hustle) => `${hustle.spec.seconds}s shift · ${hustle.spec.energy} energy · ${hustle.done}/${hustle.spec.dailyShifts} today · ${hustle.spec.skill} ${hustle.skill}`,
  running: (left: number) => `Shift running: ${left}s left`,
  start: "Start",
  go: "Go",
};

export function HustleJobs({ view, onClose }: { view: CampusView; onClose: () => void }) {
  const admin = useAdmin(view);
  return (
    <>
      {admin.hustles.map((hustle) => {
        const running = admin.shift?.id === hustle.spec.id ? admin.shift.left : 0;
        const canStart = hustle.here && !hustle.refusal && !admin.shift;
        return (
          <li key={hustle.spec.id} className="job">
            <span className="job-icon" aria-hidden>
              <ContextIcon symbol={hustle.spec.icon} />
            </span>
            <div className="job-body">
              <b>{hustle.spec.title}</b>
              <span className="job-pay">{TEXT.pay(hustle)}</span>
              <small>{running > 0 ? TEXT.running(running) : (hustle.refusal ?? hustle.spec.how)}</small>
              <small>{TEXT.facts(hustle)}</small>
            </div>
            {canStart ? (
              <button
                className="btn job-go"
                onClick={() => {
                  view.sendAdmin({ a: "hustle", id: hustle.spec.id });
                  onClose();
                }}
              >
                {TEXT.start}
              </button>
            ) : (
              hustle.target && (
                <button
                  className="btn job-go"
                  disabled={!!admin.shift}
                  onClick={() => {
                    if (hustle.target) view.goTo(hustle.target, hustle.spec.where);
                    onClose();
                  }}
                >
                  {TEXT.go}
                </button>
              )
            )}
          </li>
        );
      })}
    </>
  );
}

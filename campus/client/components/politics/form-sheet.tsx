"use client";

import { useState } from "react";
import { DEFAULT_CAMPAIGN_LOOK, UNION_BODIES, UNION_BODY_INFO, facultyLabel, departmentLabel, formPayload, lateForm, refusalText, screenAspirant, type CampaignLook, type UnionBody } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import { IdentityPicker } from "@campus/components/phone/union-identity";
import { usePending } from "@campus/components/use-pending";
import { aspirantOf, naira, racesOf, type Politics } from "./use-politics";

const NO_DEPARTMENT = "Add your department on the start screen to contest faculty and departmental posts.";

function bodyTitle(body: UnionBody, politics: Politics): string {
  const status = politics.status;
  if (body === "faculty") return facultyLabel(status?.faculty ?? "") || UNION_BODY_INFO.faculty.label;
  if (body === "dept") return departmentLabel(status?.department ?? "") || UNION_BODY_INFO.dept.label;
  return UNION_BODY_INFO.sug.label;
}

export function FormSheet({ view, politics, onClose }: { view: CampusView; politics: Politics; onClose: () => void }) {
  const { status, time, send } = politics;
  const aspirant = aspirantOf(view, status);
  const late = lateForm(time);
  const [look, setLook] = useState<CampaignLook>(DEFAULT_CAMPAIGN_LOOK);
  const [pending, act] = usePending(status);
  if (status?.mine) {
    return (
      <>
        <p className="jobs-bg">SUIEC has cleared you. Campaigns open on Tuesday. Check the Union app on your phone for your support in each hall.</p>
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </>
    );
  }
  return (
    <>
      <p className="jobs-bg">
        One form per student each week. You have {naira(aspirant.cash)}.{late ? " Late forms cost more." : ""}
      </p>
      <IdentityPicker look={look} onChange={setLook} />
      {UNION_BODIES.map((body) => {
        const races = racesOf(status, status?.cycle ?? 0, body);
        return (
          <section key={body}>
            <h3 className="jobs-bg">
              <b>{bodyTitle(body, politics)}</b>
            </h3>
            {races.length === 0 && <p className="jobs-bg">{NO_DEPARTMENT}</p>}
            <ul className="jobs-list">
              {races.map(({ post }) => {
                const screening = screenAspirant(post, aspirant, late);
                return (
                  <li key={post.id} className="job">
                    <div className="job-body">
                      <b>{post.title}</b>
                      <span className="job-pay">
                        Form {naira(screening.fee)} · stipend {naira(post.stipend)} a week
                      </span>
                      <small>{screening.ok ? `Office power: ${post.power.label.toLowerCase()}.` : refusalText(post, screening)}</small>
                    </div>
                    <button className="btn job-go" disabled={!screening.ok || !status?.ok || pending} onClick={() => act(() => send(formPayload(post.id, look)))}>
                      Buy form
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}

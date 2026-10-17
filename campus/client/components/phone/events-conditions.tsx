import { ILLNESS_NAME } from "@campuslife/shared";
import { PiBookOpenFill, PiDropFill, PiDropSlashFill, PiEngineFill, PiLightningFill, PiLightningSlashFill, PiShowerFill, PiThermometerFill } from "react-icons/pi";
import type { CampusView } from "@campus/game/CampusView";

const TEXT = {
  heading: "Light and water",
  here: "Where you are",
  campus: "Around campus",
  body: "Your body",
  sick: (name: string) => `${name}. Rest for your bed, buy drugs from the chemist, or go the Campus clinic`,
  resting: (percent: number) => `Bed rest ${percent}% done`,
  unwashed: "You never baff. Fetch water at the standpipe outside your hall",
  nights: (count: number) => `${count} night readings in a row. Sleep small`,
};
const SEVERAL_NIGHTS = 2;
const ON_COLOR = "#d9a520";
const OFF_COLOR = "#6b7280";
const WATER_COLOR = "#2f6fb5";
const SICK_COLOR = "#b5462f";

export function EventsConditions({ view }: { view: CampusView }) {
  const { now, zones, me } = view.conditions.view();
  const LightIcon = now.light === "nepa" ? PiLightningFill : now.light === "generator" ? PiEngineFill : PiLightningSlashFill;
  const dry = now.dry;
  const WaterIcon = dry ? PiDropSlashFill : PiDropFill;
  const body: { key: string; text: string; shower?: boolean }[] = [];
  if (me.illness) body.push({ key: "sick", text: `${TEXT.sick(ILLNESS_NAME[me.illness])}${me.rest > 0 ? `. ${TEXT.resting(Math.round(me.rest * 100))}` : ""}` });
  if (me.unwashed) body.push({ key: "unwashed", text: TEXT.unwashed, shower: true });
  if (me.nights >= SEVERAL_NIGHTS) body.push({ key: "nights", text: TEXT.nights(me.nights) });
  return (
    <section>
      <h3 className="ph-heading">{TEXT.heading}</h3>
      <ul className="ph-list">
        <li className={now.light === "off" ? "ph-list-row ph-live" : "ph-list-row"}>
          <LightIcon aria-hidden="true" style={{ color: now.light === "off" ? OFF_COLOR : ON_COLOR }} />
          <span className="ph-list-text">
            <b>
              {TEXT.here} · {now.zone.name}
            </b>
            <small>{now.lightText}</small>
            {now.waterText ? (
              <small>
                <WaterIcon aria-hidden="true" style={{ color: dry ? OFF_COLOR : WATER_COLOR }} /> {now.waterText}
              </small>
            ) : null}
            {now.readingText ? (
              <small>
                <PiBookOpenFill aria-hidden="true" /> {now.readingText}
              </small>
            ) : null}
          </span>
        </li>
        {body.map((row) => (
          <li key={row.key} className="ph-list-row ph-live">
            {row.shower ? <PiShowerFill aria-hidden="true" style={{ color: WATER_COLOR }} /> : <PiThermometerFill aria-hidden="true" style={{ color: SICK_COLOR }} />}
            <span className="ph-list-text">
              <b>{TEXT.body}</b>
              <small>{row.text}</small>
            </span>
          </li>
        ))}
      </ul>
      <h3 className="ph-heading">{TEXT.campus}</h3>
      <ul className="ph-list">
        {zones.map(({ zone, on, text }) => (
          <li key={zone.id} className="ph-list-row">
            {on ? <PiLightningFill aria-hidden="true" style={{ color: ON_COLOR }} /> : <PiLightningSlashFill aria-hidden="true" style={{ color: OFF_COLOR }} />}
            <span className="ph-list-text">
              <b>{zone.name}</b>
              <small>{text}</small>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

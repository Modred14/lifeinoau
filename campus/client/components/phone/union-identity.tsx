import { CampusDropdown } from "../CampusDropdown";
import "./union.css";
import { CAMPAIGN_COLORS, CAMPAIGN_NICKS, CAMPAIGN_SLOGANS, identityOf, type CampaignLook } from "@campuslife/shared";

const swatch = (color: number) => ({ background: `#${color.toString(16).padStart(6, "0")}` });
const FIELDS: readonly { key: keyof CampaignLook; label: string; options: readonly string[] }[] = [
  { key: "nick", label: "Campaign name", options: CAMPAIGN_NICKS },
  { key: "slogan", label: "Slogan", options: CAMPAIGN_SLOGANS },
  { key: "color", label: "Campaign colour", options: CAMPAIGN_COLORS.map((c) => c.name) },
];

export function IdentityPicker({ look, onChange }: { look: CampaignLook; onChange: (look: CampaignLook) => void }) {
  const identity = identityOf(look);
  return (
    <section className="un-identity">
      <p className="un-poster" style={swatch(identity.color)}>
        <b>Vote &quot;{identity.nick}&quot;</b>
        <small>{identity.slogan}</small>
      </p>
      {FIELDS.map((field) => (
        <label key={field.key} className="un-field">
          <span>{field.label}</span>
          <CampusDropdown label={field.label} className="un-select" value={String(look[field.key])} onChange={(value) => onChange({ ...look, [field.key]: Number(value) })} options={field.options.map((option, index) => ({ value: String(index), label: option }))} />
        </label>
      ))}
    </section>
  );
}

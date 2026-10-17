import { CAMPAIGN, CAMPAIGN_MATERIALS, CAMPAIGN_TRAIN, identityOf, ELECTION_TIMES, FORM_DESK, GATHERING_SITES, RALLY_POINTS, UNION_BODY_INFO, UNION_POSTS, formsOnSale, lateForm, parseRace, refusalText, screenAspirant, weekMinute } from "@campuslife/shared";
import type { CampusView } from "@campus/game/CampusView";
import { aspirantOf, naira, type Politics } from "@campus/components/politics/use-politics";
import { usePending } from "@campus/components/use-pending";
import { UnionBanners } from "./union-banners";
import { UnionOutcome } from "./union-outcome";

function Office({ view, politics, onClose }: { view: CampusView; politics: Politics; onClose: () => void }) {
  const office = politics.status?.office;
  const post = office ? parseRace(office.race)?.post : undefined;
  const [pending, act] = usePending(politics.status);
  if (!office || !post) return null;
  const site = post.power.kind === "gathering" ? GATHERING_SITES[post.power.site] : undefined;
  return (
    <>
      <h3 className="ph-heading">Your office</h3>
      <section className="ph-card ph-order">
        <b>{post.title}</b>
        <small>
          Stipend {naira(post.stipend)} a week. {office.powerUsed ? "You have used your power this week." : site ? `Use your power at ${site.name}.` : "You can use your power once this week."}
        </small>
      </section>
      <div className="ph-sheet-actions">
        {site && !office.powerUsed && (
          <button type="button" className="ph-btn ph-btn-quiet" onClick={() => { view.goTo(site, site.name); onClose(); }}>
            Go there
          </button>
        )}
        <button type="button" className="ph-btn" disabled={office.powerUsed || pending} onClick={() => act(() => politics.send({ a: "power" }))}>
          {post.power.label}
        </button>
      </div>
    </>
  );
}

function Eligibility({ view, politics, onClose }: { view: CampusView; politics: Politics; onClose: () => void }) {
  const { status, time } = politics;
  const aspirant = aspirantOf(view, status);
  const onSale = formsOnSale(time);
  const posts = UNION_POSTS.filter((post) => post.role === "President" && (post.body === "sug" || status?.faculty));
  return (
    <>
      <p className="ph-note">{onSale ? "SUIEC is selling nomination forms at the Student Union Building now." : "You are not contesting this week. SUIEC sells forms on Monday from 8 am to Tuesday noon."}</p>
      <ul className="ph-list">
        {posts.map((post) => {
          const screening = screenAspirant(post, aspirant, lateForm(time));
          return (
            <li key={post.id} className="ph-list-row">
              <span className="ph-list-text">
                <b>{UNION_BODY_INFO[post.body].label} posts</b>
                <small>{screening.ok ? `You pass screening. ${post.title} form: ${naira(screening.fee)}.` : refusalText(post, screening)}</small>
              </span>
            </li>
          );
        })}
      </ul>
      {onSale && (
        <div className="ph-sheet-actions">
          <button type="button" className="ph-btn" onClick={() => { view.goTo(FORM_DESK, "SUIEC desk, SUB"); onClose(); }}>
            Go to the SUIEC desk
          </button>
        </div>
      )}
    </>
  );
}

function Campaign({ politics }: { politics: Politics }) {
  const { status, time, send } = politics;
  const mine = status?.mine;
  const post = mine ? parseRace(mine.race)?.post : undefined;
  const [pending, act] = usePending(status);
  if (!mine || !post) return null;
  const cap = Math.round(CAMPAIGN.hallCap * UNION_BODY_INFO[post.body].scale);
  const selling = weekMinute(time) < ELECTION_TIMES.campaignClose;
  const identity = identityOf(mine.look);
  const train = mine.support[CAMPAIGN_TRAIN.key] ?? 0;
  return (
    <>
      <UnionOutcome politics={politics} />
      <p className="un-poster" style={{ background: `#${identity.color.toString(16).padStart(6, "0")}` }}>
        <b>Vote &quot;{identity.nick}&quot;</b>
        <small>{identity.slogan}</small>
      </p>
      <dl className="ph-stats">
        <div className="ph-card">
          <dd>{mine.effort}</dd>
          <dt>Support for {post.title}</dt>
        </div>
        <div className="ph-card">
          <dd>{mine.spoke ? "Done" : "Thursday"}</dd>
          <dt>Press Night and Debate</dt>
        </div>
      </dl>
      <p className="ph-note">
        Walk to a hall front, tap Campaign here and hold your ground while you speak. Each stop costs {naira(CAMPAIGN.cost)} and some energy. The same hall gives less each time in one day. A rally crowd doubles it, and two candidates at one rally make a campaign train for a bonus.
      </p>
      <h3 className="ph-heading">Support by hall</h3>
      <ul className="ph-list">
        {RALLY_POINTS.map((site) => (
          <li key={site.id} className="ph-list-row">
            <span className="ph-list-text">
              <b>{site.name}</b>
            </span>
            <span className="ph-time">
              {mine.support[site.id] ?? 0}/{cap}
            </span>
          </li>
        ))}
        {train > 0 && (
          <li className="ph-list-row">
            <span className="ph-list-text">
              <b>Campaign train bonus</b>
            </span>
            <span className="ph-time">{train}</span>
          </li>
        )}
      </ul>
      <UnionBanners politics={politics} />
      <h3 className="ph-heading">Campaign materials</h3>
      <ul className="ph-list">
        {CAMPAIGN_MATERIALS.map((item) => {
          const owned = mine.materials.includes(item.id);
          return (
            <li key={item.id} className="ph-list-row">
              <span className="ph-list-text">
                <b>{item.name}</b>
                <small>
                  Reach +{Math.round(item.reach * 100)}% · {naira(item.price)}
                </small>
              </span>
              {owned ? (
                <span className="ph-tag">Bought</span>
              ) : (
                <button type="button" className="ph-btn" disabled={!selling || pending} aria-label={`Buy ${item.name} for ${naira(item.price)}`} onClick={() => act(() => send({ a: "material", item: item.id }))}>
                  Buy
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function UnionMe({ view, politics, onClose }: { view: CampusView; politics: Politics; onClose: () => void }) {
  return (
    <>
      {politics.status?.mine ? <Campaign politics={politics} /> : <Eligibility view={view} politics={politics} onClose={onClose} />}
      <Office view={view} politics={politics} onClose={onClose} />
    </>
  );
}

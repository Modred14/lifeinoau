import {
  AMPHI_PLACE,
  DEBATE_FUN,
  DEBATE_MARK,
  DEBATE_SITE,
  FORM_DESK,
  POLITICS_REACH,
  SUB_UNIT,
  debateOn,
  electionCycle,
  facultyOf,
  identityOf,
  findMaterial,
  findPost,
  formsOnSale,
  interiorAt,
  lateForm,
  pollUnit,
  pollsOpen,
  refusalText,
  screenAspirant,
  unitForFaculty,
  weekMinute,
  ELECTION_TIMES,
  type CampaignLook,
  type GameTime,
} from "@campuslife/shared";
import { nanoid } from "nanoid";
import { naira, toPlayerCandidate, type PoliticsCore } from "./core";
import type { Candidacy, PoliticsPlayer } from "./types";

const CANDIDACY_ID_LENGTH = 12;
const DEBATE_REACH = POLITICS_REACH * 2;
const TEXT = {
  formsClosed: "SUIEC sells forms from Monday 8 am to Tuesday noon at the SUB.",
  goToDesk: "Nomination forms are at the SUIEC desk outside the Student Union Building.",
  needDepartment: "Faculty and departmental posts need your department on your profile.",
  oneForm: "One form per student each week. You already picked one.",
  noForm: "You are not contesting this week. Pick a form at the SUB on Monday.",
  materialOwned: "Your camp already has that.",
  materialClosed: "Campaign materials are for the campaign days only.",
  endorseClosed: "Endorsements close when the polls open.",
  endorsedAlready: "You have endorsed someone this week already.",
  notOnBallot: "That candidate is not on the ballot.",
  ownCamp: "You cannot endorse yourself. Go and campaign.",
  pollsClosed: "Polls open on Friday from 8 am to 4 pm.",
  notYourBallot: "That ballot is not for your faculty or department.",
  votedAlready: "You have voted for this post already. One student, one vote.",
  debateOff: "Press Night and Debate is on Thursday from 7 pm at the Amphi Theatre.",
  notAtAmphi: "Go to the Amphi Theatre for Press Night and Debate.",
  spokeAlready: "You have faced the press already. Leave the stage for others.",
  attendedAlready: "You are already counted in the crowd tonight.",
};

const cgpaOf = (p: PoliticsPlayer) => (p.exams > 0 ? p.gpTotal / p.exams : 0);

export async function buyForm(core: PoliticsCore, id: string, p: PoliticsPlayer, postId: string, look: CampaignLook, t: GameTime) {
  const post = findPost(postId);
  if (!post) return;
  if (!formsOnSale(t)) return core.notice(id, TEXT.formsClosed);
  if (!core.outdoorsNear(p, FORM_DESK)) return core.notice(id, TEXT.goToDesk);
  const ref = core.refFor(p, post);
  if (!ref) return core.notice(id, TEXT.needDepartment);
  const cycle = electionCycle(t);
  if (await core.store.candidacyOf(p.profileId, cycle)) return core.notice(id, TEXT.oneForm);
  const screening = screenAspirant(post, { cgpa: cgpaOf(p), exams: p.exams, malpractice: p.malpractice, rusticated: p.rusticatedUntil > t.total, level: p.level, cash: p.cash }, lateForm(t));
  if (!screening.ok) return core.notice(id, refusalText(post, screening));
  const candidacy: Candidacy = { id: nanoid(CANDIDACY_ID_LENGTH), accountId: p.profileId, cycle, race: ref.race, name: core.host.name(id), support: {}, materials: [], spoke: false, look, stops: {} };
  p.cash -= screening.fee;
  core.host.changed(id);
  let added = false;
  try {
    added = await core.store.addCandidacy(candidacy);
  } finally {
    if (!added) core.refund(p.profileId, screening.fee);
  }
  if (!added) return core.notice(id, TEXT.oneForm);
  core.notice(id, `📝 SUIEC cleared you for ${post.title}. Form fee ${naira(screening.fee)}. Campaigns open Tuesday.`);
  core.host.broadcast(`🗳️ ${candidacy.name} has picked the ${post.title} form as "${identityOf(look).nick}".`);
}

export async function buyMaterial(core: PoliticsCore, id: string, p: PoliticsPlayer, itemId: string, t: GameTime) {
  const item = findMaterial(itemId);
  if (!item) return;
  if (weekMinute(t) >= ELECTION_TIMES.campaignClose) return core.notice(id, TEXT.materialClosed);
  const mine = await core.store.candidacyOf(p.profileId, electionCycle(t));
  if (!mine) return core.notice(id, TEXT.noForm);
  if (mine.materials.includes(item.id)) return core.notice(id, TEXT.materialOwned);
  if (p.cash < item.price) return core.notice(id, `${item.name} cost ${naira(item.price)}. You no get reach.`);
  p.cash -= item.price;
  core.host.changed(id);
  try {
    await core.store.saveCandidacy(mine.id, { materials: [...mine.materials, item.id] });
  } catch (err) {
    core.refund(p.profileId, item.price);
    throw err;
  }
  const effort = toPlayerCandidate({ ...mine, materials: [...mine.materials, item.id] }).effort;
  core.notice(id, `🪧 ${item.name} bought for ${naira(item.price)}. Your reach is up, support now ${effort}.`);
}

export async function endorse(core: PoliticsCore, id: string, p: PoliticsPlayer, postId: string, candidate: string, t: GameTime) {
  const post = findPost(postId);
  const ref = post ? core.refFor(p, post) : undefined;
  if (!ref) return;
  if (weekMinute(t) < ELECTION_TIMES.formsOpen || weekMinute(t) >= ELECTION_TIMES.pollsOpen) return core.notice(id, TEXT.endorseClosed);
  const cycle = electionCycle(t);
  const ballot = await core.ballot(cycle, ref);
  const pick = ballot.find((c) => c.id === candidate);
  if (!pick) return core.notice(id, TEXT.notOnBallot);
  const mine = await core.store.candidacyOf(p.profileId, cycle);
  if (mine?.id === pick.id) return core.notice(id, TEXT.ownCamp);
  if (!(await core.store.endorse(p.profileId, cycle, ref.race, pick.id))) return core.notice(id, TEXT.endorsedAlready);
  core.notice(id, `🤝 You endorsed ${pick.name} for ${ref.post.title}.`);
}

export async function castVote(core: PoliticsCore, id: string, p: PoliticsPlayer, postId: string, candidate: string, t: GameTime) {
  const post = findPost(postId);
  if (!post) return;
  if (!pollsOpen(t)) return core.notice(id, TEXT.pollsClosed);
  const ref = core.refFor(p, post);
  if (!ref) return core.notice(id, TEXT.notYourBallot);
  const unit = post.body === "sug" ? pollUnit(SUB_UNIT) : unitForFaculty(facultyOf(core.departmentOf(p))?.key ?? "");
  if (!core.outdoorsNear(p, unit)) return core.notice(id, `Vote for ${post.title} at the ${unit.name} polling unit.`);
  const cycle = electionCycle(t);
  const pick = (await core.ballot(cycle, ref)).find((c) => c.id === candidate);
  if (!pick) return core.notice(id, TEXT.notOnBallot);
  const informed = (await core.store.marksOf(p.profileId, cycle)).includes(DEBATE_MARK);
  if (!(await core.store.vote(p.profileId, cycle, ref.race, pick.id, informed))) return core.notice(id, TEXT.votedAlready);
  core.notice(id, `🗳️ Vote cast for ${post.title}. ${informed ? "You watched the debate, so it counts extra." : "Results come out at 6 pm."}`);
}

function atDebate(core: PoliticsCore, p: PoliticsPlayer): boolean {
  return interiorAt(p.x, p.y)?.place === AMPHI_PLACE || core.outdoorsNear(p, DEBATE_SITE, DEBATE_REACH);
}

export async function speak(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  if (!debateOn(t)) return core.notice(id, TEXT.debateOff);
  if (!atDebate(core, p)) return core.notice(id, TEXT.notAtAmphi);
  const mine = await core.store.candidacyOf(p.profileId, electionCycle(t));
  if (!mine) return core.notice(id, TEXT.noForm);
  if (mine.spoke) return core.notice(id, TEXT.spokeAlready);
  await core.store.saveCandidacy(mine.id, { spoke: true });
  core.host.cheer(id);
  core.notice(id, "🎤 You faced the press and gave your manifesto. The crowd shouted Gbosa! Support is up.");
  core.host.broadcast(`🎤 ${mine.name} just faced the press at the Amphi Theatre.`);
}

export async function attend(core: PoliticsCore, id: string, p: PoliticsPlayer, t: GameTime) {
  if (!debateOn(t)) return core.notice(id, TEXT.debateOff);
  if (!atDebate(core, p)) return core.notice(id, TEXT.notAtAmphi);
  if (!(await core.store.mark(p.profileId, electionCycle(t), DEBATE_MARK))) return core.notice(id, TEXT.attendedAlready);
  p.fun = Math.min(100, p.fun + DEBATE_FUN);
  core.host.changed(id);
  core.notice(id, "🎭 You watched Press Night and Debate. You are an informed voter now, so your vote counts extra on Friday.");
}

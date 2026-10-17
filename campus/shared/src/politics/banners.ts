import type { BannerArt } from "../banner-art";
import type { GameTime } from "../clock";
import { electionCycle, electionPhase, resultsDeclared } from "./calendar";
import { npcCandidates, type ElectionCandidate } from "./candidates";
import { FACULTIES, FACULTY_HOMES } from "./faculty";
import { ELECTORAL_BODY, SUG_SCOPE, UNION_NAME, findPost, postsOf, type UnionPost } from "./posts";
import { POLL_UNITS } from "./sites";

const INK_LIGHT = 0xffffff;
const INK_DARK = 0x16211b;
const NOTICE_COLOR = 0xf4f1e6;
const NOTICE_ACCENT = 0x1f7a4d;
const GOLD = 0xf2c230;
const HEAD_WEIGHT = 3;
const POSTER_WEIGHT = 1;
const NOTICE_WEIGHT = 2;
const FACULTY_POST = "fac-president";

const field = (cycle: number, post: UnionPost): ElectionCandidate[] => npcCandidates(cycle, post, SUG_SCOPE).filter((c) => !c.disqualified);

function poster(cycle: number, post: UnionPost, c: ElectionCandidate, verb: string): BannerArt {
  return {
    id: `pol-${cycle}-${post.id}-${c.id}-${verb.toLowerCase()}`,
    tone: "campaign",
    title: `${verb} "${c.nick}"`,
    lines: [c.name, `For ${post.role}`, c.slogan],
    footer: c.from,
    color: c.color,
    ink: INK_LIGHT,
    accent: GOLD,
    weight: post.id === "sug-president" ? HEAD_WEIGHT : POSTER_WEIGHT,
  };
}

function facultyPosters(cycle: number): BannerArt[] {
  const post = findPost(FACULTY_POST);
  if (!post) return [];
  return FACULTY_HOMES.flatMap((home) => {
    const faculty = FACULTIES.find((f) => home.faculties.test(f.key));
    const unit = POLL_UNITS.find((u) => u.id === home.unit);
    if (!faculty || !unit) return [];
    return npcCandidates(cycle, post, faculty.key)
      .filter((c) => !c.disqualified)
      .map((c) => ({ ...poster(cycle, post, c, "Vote"), id: `pol-${cycle}-${post.id}-${home.unit}-${c.id}`, lines: [c.name, `For President, ${home.name}`, c.slogan], near: unit.place }));
  });
}

function notice(id: string, title: string, lines: string[], weight = NOTICE_WEIGHT): BannerArt {
  return { id, tone: "notice", title, lines, footer: ELECTORAL_BODY, color: NOTICE_COLOR, ink: INK_DARK, accent: NOTICE_ACCENT, weight };
}

export interface KnownHolder {
  post: string;
  name: string;
  color?: number;
}

let known: { cycle: number; holders: readonly KnownHolder[] } = { cycle: -1, holders: [] };

export function setKnownHolders(cycle: number, holders: readonly KnownHolder[]) {
  known = { cycle, holders };
}

function congratulations(cycle: number): BannerArt[] {
  const named = known.cycle === cycle ? known.holders.flatMap((h) => {
    const post = findPost(h.post);
    return post?.body === "sug" ? [{ post, holder: h }] : [];
  }) : [];
  const neutral: BannerArt[] = [
    { id: `pol-${cycle}-won`, tone: "campaign", title: "CONGRATULATIONS", lines: ["To the new executives", UNION_NAME, "The work starts now."], footer: "From Great Ife students", color: NOTICE_ACCENT, ink: INK_LIGHT, accent: GOLD, weight: HEAD_WEIGHT },
    notice(`pol-${cycle}-thanks`, "THANK YOU FOR VOTING", ["Results are on the SUB board", "One student, one vote."]),
    notice(`pol-${cycle}-oath`, "SWEARING-IN", ["Saturday 10 am", "Student Union Building"]),
  ];
  const personal = named.map(({ post, holder }): BannerArt => ({
    id: `pol-${cycle}-${post.id}-won`,
    tone: "campaign",
    title: "CONGRATULATIONS",
    lines: [holder.name, `${post.role}, ${UNION_NAME}`, "The work starts now."],
    footer: "From your supporters",
    color: holder.color ?? NOTICE_ACCENT,
    ink: INK_LIGHT,
    accent: GOLD,
    weight: post.id === "sug-president" ? HEAD_WEIGHT : POSTER_WEIGHT,
  }));
  return [...neutral, ...personal];
}

export function campaignBanners(t: GameTime): BannerArt[] {
  const cycle = electionCycle(t);
  const phase = electionPhase(t);
  const posts = postsOf("sug");
  if (phase === "forms" || phase === "campaign" || phase === "debate") {
    const posters = posts.flatMap((post) => field(cycle, post).map((c) => poster(cycle, post, c, "Vote")));
    const head =
      phase === "forms"
        ? notice(`pol-${cycle}-forms`, "NOMINATION FORMS", ["On sale at the Student Union Building", "Screening follows. Come with your results."])
        : notice(`pol-${cycle}-debate`, "PRESS NIGHT AND DEBATE", ["Come and hear them", "Amphi Theatre. Thursday 7 pm."]);
    return [head, ...posters, ...facultyPosters(cycle)];
  }
  if (phase === "voting" || phase === "counting" || (phase === "results" && !resultsDeclared(t))) {
    return [
      notice(`pol-${cycle}-vote`, "ELECTION DAY", ["Vote at your faculty polling unit", "8 am to 4 pm. One student, one vote."], HEAD_WEIGHT),
      notice(`pol-${cycle}-peace`, "VOTE, NOT FIGHT", [UNION_NAME, "Greatest Ife! Great!"]),
      ...field(cycle, posts[0]).map((c) => poster(cycle, posts[0], c, "Vote")),
    ];
  }
  return congratulations(cycle);
}

export type UnionBody = "sug" | "faculty" | "dept";
export const UNION_BODIES: readonly UnionBody[] = ["sug", "faculty", "dept"];
export const SUG_SCOPE = "all";
export const ELECTORAL_BODY = "SUIEC";
export const UNION_NAME = "Great Ife Students' Union";

export interface UnionBodyInfo {
  label: string;
  short: string;
  scale: number;
  minCgpa: number;
  minTests: number;
  field: [number, number];
  unopposedChance: number;
}

export const UNION_BODY_INFO: Record<UnionBody, UnionBodyInfo> = {
  sug: { label: "Students' Union", short: "SUG", scale: 1, minCgpa: 3, minTests: 1, field: [3, 4], unopposedChance: 0 },
  faculty: { label: "Faculty association", short: "Faculty", scale: 0.5, minCgpa: 2.5, minTests: 1, field: [2, 3], unopposedChance: 0.12 },
  dept: { label: "Departmental association", short: "Dept.", scale: 0.25, minCgpa: 2, minTests: 0, field: [2, 3], unopposedChance: 0.2 },
};

export type GatheringSite = "sub" | "awo" | "anglomoz";
export type OfficePower =
  | { kind: "gathering"; label: string; title: string; notice: string; site: GatheringSite; fun: number }
  | { kind: "relief"; label: string; notice: string; packs: number }
  | { kind: "release"; label: string; notice: string };

export interface UnionPost {
  id: string;
  body: UnionBody;
  role: string;
  title: string;
  fee: number;
  stipend: number;
  power: OfficePower;
}

const congress = (title: string, notice: string, site: GatheringSite = "awo"): OfficePower => ({ kind: "gathering", label: `Call ${title}`, title, notice, site, fun: 14 });
const release = (label: string, notice: string): OfficePower => ({ kind: "release", label, notice });

export const UNION_POSTS: readonly UnionPost[] = [
  { id: "sug-president", body: "sug", role: "President", title: "SUG President", fee: 1500, stipend: 6000, power: congress("Congress", "📣 Congress! The President has called Great Ife to Awo Cafe. Come and talk.") },
  { id: "sug-vp", body: "sug", role: "Vice President", title: "SUG Vice President", fee: 1200, stipend: 4500, power: congress("a town hall", "📣 The Vice President is holding a town hall at the SUB. Bring your hostel complaints.", "sub") },
  { id: "sug-secgen", body: "sug", role: "Secretary General", title: "SUG Sec. Gen.", fee: 1000, stipend: 4000, power: release("Publish the minutes", "📜 The Secretary General has pasted the minutes of the last sitting on the SUB board.") },
  { id: "sug-asg", body: "sug", role: "Assistant Secretary General", title: "SUG Asst. Sec. Gen.", fee: 1000, stipend: 3500, power: release("Send the notice of meeting", "📜 Notice of meeting: the SRC sits this week. Honourables, check the SUB board.") },
  { id: "sug-pro", body: "sug", role: "Public Relations Officer", title: "SUG PRO", fee: 1000, stipend: 4000, power: release("Issue a press release", "📰 Press release from the union: management has agreed to meet the union on light and water.") },
  { id: "sug-socials", body: "sug", role: "Director of Socials and Culture", title: "SUG Dir. of Socials", fee: 1000, stipend: 4000, power: { kind: "gathering", label: "Announce a free-gate show", title: "Free-gate show", notice: "🎤 Free gate! The Director of Socials is putting on a show at the SUB. No gate fee.", site: "sub", fun: 20 } },
  { id: "sug-sports", body: "sug", role: "Director of Sports", title: "SUG Dir. of Sports", fee: 1000, stipend: 4000, power: { kind: "gathering", label: "Call a novelty match", title: "Novelty match warm-up", notice: "⚽ The Director of Sports is picking teams for a novelty match. Meet at Anglo-Moz.", site: "anglomoz", fun: 16 } },
  { id: "sug-finsec", body: "sug", role: "Financial Secretary", title: "SUG Fin. Sec.", fee: 1000, stipend: 4000, power: release("Publish the account", "🧾 The Financial Secretary has published the union account. Every kobo is on the SUB board.") },
  { id: "sug-welfare", body: "sug", role: "Welfare Officer", title: "SUG Welfare Officer", fee: 1000, stipend: 4000, power: { kind: "relief", label: "Share food relief packs", notice: "🍱 The Welfare Officer is sharing food relief packs. Students nearby got one each.", packs: 1 } },
  { id: "fac-president", body: "faculty", role: "President", title: "Faculty President", fee: 600, stipend: 2000, power: congress("a faculty congress", "📣 Faculty congress at the SUB. Your faculty president wants to hear from you.", "sub") },
  { id: "fac-gensec", body: "faculty", role: "General Secretary", title: "Faculty Gen. Sec.", fee: 500, stipend: 1500, power: release("Paste the faculty notice", "📜 A faculty association notice is up: faculty week planning starts now.") },
  { id: "fac-finsec", body: "faculty", role: "Financial Secretary", title: "Faculty Fin. Sec.", fee: 500, stipend: 1500, power: release("Publish faculty dues", "🧾 A faculty association has published how the dues were spent.") },
  { id: "dept-president", body: "dept", role: "President", title: "Dept. President", fee: 300, stipend: 1000, power: congress("a departmental meeting", "📣 Departmental meeting at the SUB. Your dept. president is taking questions.", "sub") },
  { id: "dept-gensec", body: "dept", role: "General Secretary", title: "Dept. Gen. Sec.", fee: 300, stipend: 800, power: release("Share past questions", "📚 A departmental Gen. Sec. has shared past questions with the class.") },
  { id: "dept-finsec", body: "dept", role: "Financial Secretary", title: "Dept. Fin. Sec.", fee: 300, stipend: 800, power: release("Publish departmental dues", "🧾 A departmental association has published its dues account.") },
];

export const postsOf = (body: UnionBody): UnionPost[] => UNION_POSTS.filter((p) => p.body === body);
export const findPost = (id: unknown): UnionPost | undefined => (typeof id === "string" ? UNION_POSTS.find((p) => p.id === id) : undefined);
export const officeIndex = (post: UnionPost): number => UNION_POSTS.indexOf(post) + 1;
export const officeTitle = (index: number): string => UNION_POSTS[index - 1]?.title ?? "";

const RACE_SEPARATOR = "@";
export const raceKey = (post: UnionPost, scope: string): string => `${post.id}${RACE_SEPARATOR}${post.body === "sug" ? SUG_SCOPE : scope}`;
export function parseRace(key: string): { post: UnionPost; scope: string } | undefined {
  const at = key.indexOf(RACE_SEPARATOR);
  const post = findPost(key.slice(0, at));
  const scope = key.slice(at + 1);
  return at > 0 && post && scope ? { post, scope } : undefined;
}

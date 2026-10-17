import { MINUTES_PER_DAY } from "../clock";
import { ELECTION_TIMES, ralliesFor, weekClock } from "./calendar";
import { npcCandidates, type ElectionCandidate } from "./candidates";
import { SUG_SCOPE, postsOf, type GatheringSite, type UnionPost } from "./posts";
import { ALUTA_FUN } from "./rules";
import { polPick, polRandom } from "./seed";
import { RALLY_POINTS } from "./sites";

const HOUR = 60;
const ALUTA_CHANCE = 0.6;
const ALUTA_MINUTES = 120;
const ALUTA_DAYS = [0, 1, 2, 5, 6];
const ALUTA_HOURS = [11, 13, 15, 17];
const SCREENING_AT = MINUTES_PER_DAY - 4 * HOUR;
const PETITION_AT = 2 * MINUTES_PER_DAY + 9 * HOUR;
const STEP_DOWN_AT = 3 * MINUTES_PER_DAY + 23 * HOUR;

const CAUSES = [
  "light in the hostels",
  "water in the blocks",
  "the bus queue and transport fare",
  "the Health Centre queue",
  "prices at the buka",
];
const ALUTA_KINDS: readonly { title: string; site: GatheringSite; line: (cause: string) => string }[] = [
  { title: "Hall meeting", site: "awo", line: (cause) => `📣 Hall meeting at Awo Cafe over ${cause}. Any student can speak.` },
  { title: "Sit-out", site: "sub", line: (cause) => `✊ Sit-out at the SUB over ${cause}. Placards and songs only. Aluta continua!` },
  { title: "Solidarity walk", site: "anglomoz", line: (cause) => `✊ Solidarity walk gathers at Anglo-Moz over ${cause}. Greatest Ife!` },
];

export interface Aluta {
  start: number;
  end: number;
  title: string;
  site: GatheringSite;
  notice: string;
  fun: number;
}

export function alutaFor(cycle: number): Aluta | null {
  const rand = polRandom(`aluta:${cycle}`);
  if (rand() >= ALUTA_CHANCE) return null;
  const kind = polPick(rand, ALUTA_KINDS);
  const start = polPick(rand, ALUTA_DAYS) * MINUTES_PER_DAY + polPick(rand, ALUTA_HOURS) * HOUR;
  return { start, end: start + ALUTA_MINUTES, title: kind.title, site: kind.site, notice: kind.line(polPick(rand, CAUSES)), fun: ALUTA_FUN };
}

export interface NewsLine {
  at: number;
  text: string;
}

const sugField = (cycle: number): { post: UnionPost; field: ElectionCandidate[] }[] => postsOf("sug").map((post) => ({ post, field: npcCandidates(cycle, post, SUG_SCOPE) }));

const newsMemo = new Map<number, NewsLine[]>();
const NEWS_MEMO_LIMIT = 4;

export function electionNews(cycle: number): NewsLine[] {
  const known = newsMemo.get(cycle);
  if (known) return known;
  if (newsMemo.size >= NEWS_MEMO_LIMIT) newsMemo.clear();
  const made = writeNews(cycle);
  newsMemo.set(cycle, made);
  return made;
}

function writeNews(cycle: number): NewsLine[] {
  const rand = polRandom(`news:${cycle}`);
  const races = sugField(cycle);
  const out: NewsLine[] = [
    { at: 0, text: "The SRC has formed SUIEC with one member from each faculty. The ban on politics is lifted." },
    { at: ELECTION_TIMES.formsOpen, text: "SUIEC is selling nomination forms at the Student Union Building." },
    { at: ELECTION_TIMES.formsClose, text: "Sale of forms has closed. SUIEC has pasted the cleared list on the SUB board." },
    { at: ELECTION_TIMES.debateStart, text: "Press Night and Debate is on at the Amphi Theatre. Campus journalists are asking the questions." },
    { at: ELECTION_TIMES.pollsOpen, text: "Polls are open. Vote at your faculty polling unit. SUG ballots are at the SUB." },
    { at: ELECTION_TIMES.pollsClose, text: "Polls have closed. Electoral officers are collating unit by unit." },
    { at: ELECTION_TIMES.results, text: "Collation has started at the SUB. Results are coming in unit by unit." },
    { at: ELECTION_TIMES.swearingIn, text: "The new executives have taken the oath. Handover notes are in." },
  ];
  for (const { post, field } of races) {
    for (const c of field) {
      if (c.disqualified) out.push({ at: SCREENING_AT, text: `Screening gist: SUIEC disqualified ${c.name} "${c.nick}" from the ${post.role} race over an incomplete clearance.` });
    }
  }
  const petition = polPick(rand, races);
  const target = polPick(rand, petition.field.filter((c) => !c.disqualified));
  out.push({ at: PETITION_AT, text: `Petition: a rival camp wrote SUIEC about "${target.nick}" pasting posters on a banned wall. SUIEC warned the camp.` });
  const presidency = races[0].field.filter((c) => !c.disqualified);
  if (presidency.length > 2) out.push({ at: STEP_DOWN_AT, text: `Gist from the halls: the "${presidency[presidency.length - 1].nick}" camp is under pressure to step down. They say they are going nowhere.` });
  for (const r of ralliesFor(cycle)) {
    const host = polPick(rand, polPick(rand, races).field);
    out.push({ at: r.start, text: `Rally at ${RALLY_POINTS[r.site]?.name ?? "the halls"}: "${host.nick}" is moving hostel to hostel.` });
  }
  const aluta = alutaFor(cycle);
  if (aluta) out.push({ at: aluta.start, text: aluta.notice.replace(/^\S+\s/, "") });
  return out.sort((a, b) => a.at - b.at);
}

export const newsUntil = (cycle: number, minuteOfWeek: number): NewsLine[] => electionNews(cycle).filter((n) => n.at <= minuteOfWeek).reverse();
export const newsStamp = (line: NewsLine): string => weekClock(line.at);

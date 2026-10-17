import { FACULTIES, departmentsIn, facultyLabel, departmentLabel, facultyOf } from "./faculty";
import { identityOf, type CampaignLook } from "./identity";
import { UNION_BODY_INFO, raceKey, type UnionPost } from "./posts";
import { polPick, polRandom, polShuffle } from "./seed";

const NAMES = [
  "Adewale Okunfolami-Bright", "Folasade Ajirebiowo", "Chukwudi Ezenwakama-Obi", "Halima Dangwarzo-Bello", "Ibukun Olarewanle", "Emeka Nwachinemelu-Odo", "Yetunde Abiolaranti",
  "Sodiq Alagbonsile", "Blessing Etimbukudo", "Kayode Ogunsemilore-Ajao", "Rukayat Olanbiwonnu", "Dare Fakoyejola", "Ngozi Umeakunwa-Ike", "Seun Aderibigbola",
  "Amaka Onyekwelumba", "Bashir Garkuwanda", "Tolu Akinsoyinbola", "Kehinde Oyewumide-Cole", "Ifeoma Nnabuenyika", "Mubarak Sanyaolurin", "Damilola Ojutalayomi",
  "Uche Okwudilimba", "Zainab Abdulkabirat-Sule", "Oluwaseyi Fagbohunmila", "Ebuka Anyaegbunwa", "Morenike Adegbolagun-Ray", "Abdulrahman Dantsohowa", "Titilayo Olorunnisomo-Kay",
  "Obinna Ugwuegbulem-Ani", "Simisola Awoyelure",
];
const NICKS = [
  "Aluta Voice", "Integrity", "Mama Welfare", "Comrade Zobo", "Madam Prudence", "Mouthpiece", "Gbedu", "Skipper", "The Scribe", "Able Deputy", "Iron Lady", "Capacity",
  "Omoluabi", "Due Process", "The Bridge", "Sure Banker", "Compiler", "Learned", "Pipette", "Action Point", "Senator", "Ojogbon", "The Ledger", "Baba Awo",
  "Queen Moremi", "Fearless", "Mandate", "Mr Transparency", "Small But Mighty", "Hon. KK",
];
const SLOGANS = [
  "Welfare first. No stories.", "Light. Water. Transport. I will follow it up.", "A union that answers to congress.", "Every kobo accounted for.",
  "You will hear it from the union first.", "Great shows. Fair gate fees.", "Fix the pitch. Revive the hall league.", "Minutes on time. Records open.",
  "Ready to work from day one.", "Safe hostels. Working clinics.", "Service, not noise.", "Not a promise. A plan.", "One union. One voice.", "Tested and trusted.",
  "The welfare of students is not for sale.", "Vote competence.", "From the masses, for the masses.", "Let the work speak.", "Labs that work.", "Past questions for all.",
];
const COLORS = [0x1f7a4d, 0x1d4f91, 0xb5462f, 0x7341c9, 0xd9a520, 0x0f766e, 0xbe185d, 0x374151];
const PARTS = ["Part 2", "Part 3", "Part 4"];
const NPC_SUPPORT: [number, number] = [150, 450];
const DISQUALIFY_CHANCE = 0.14;
const DISQUALIFY_MIN_FIELD = 3;

export interface ElectionCandidate {
  id: string;
  race: string;
  name: string;
  nick: string;
  slogan: string;
  color: number;
  from: string;
  base: number;
  npc: boolean;
  disqualified: boolean;
  faculty?: string;
}

export function npcCandidates(cycle: number, post: UnionPost, scope: string): ElectionCandidate[] {
  const race = raceKey(post, scope);
  const info = UNION_BODY_INFO[post.body];
  const rand = polRandom(`field:${cycle}:${race}`);
  const unopposed = rand() < info.unopposedChance;
  const size = unopposed ? 1 : info.field[0] + Math.floor(rand() * (info.field[1] - info.field[0] + 1));
  const names = polShuffle(rand, NAMES);
  const nicks = polShuffle(rand, NICKS);
  const slogans = polShuffle(rand, SLOGANS);
  const colors = polShuffle(rand, COLORS);
  const out: ElectionCandidate[] = [];
  for (let i = 0; i < size; i++) {
    const home = homeOf(post, scope, rand);
    out.push({
      id: `n${i}`,
      race,
      name: names[i],
      nick: nicks[i],
      slogan: slogans[i],
      color: colors[i],
      from: `${home.label}, ${polPick(rand, PARTS)}`,
      base: Math.round((NPC_SUPPORT[0] + rand() * (NPC_SUPPORT[1] - NPC_SUPPORT[0])) * info.scale),
      npc: true,
      disqualified: false,
      faculty: home.faculty,
    });
  }
  if (size >= DISQUALIFY_MIN_FIELD && rand() < DISQUALIFY_CHANCE) out[Math.floor(rand() * size)].disqualified = true;
  return out;
}

function homeOf(post: UnionPost, scope: string, rand: () => number): { label: string; faculty: string } {
  if (post.body === "dept") return { label: departmentLabel(scope) || "Departmental student", faculty: facultyOf(scope)?.key ?? "" };
  const key = post.body === "faculty" ? scope : polPick(rand, FACULTIES).key;
  const departments = departmentsIn(key);
  return { label: departments.length ? polPick(rand, departments) : facultyLabel(key) || "Faculty student", faculty: key };
}

export const raceIsUnopposed = (candidates: readonly ElectionCandidate[]): boolean => candidates.filter((c) => !c.disqualified).length === 1;

export interface PlayerCandidate {
  id: string;
  race: string;
  name: string;
  effort: number;
  look?: CampaignLook;
}

const PLAYER_HOME = "On campus now";

export function ballotFor(cycle: number, post: UnionPost, scope: string, players: readonly PlayerCandidate[]): ElectionCandidate[] {
  const race = raceKey(post, scope);
  const live: ElectionCandidate[] = players
    .filter((p) => p.race === race)
    .map((p) => ({ id: p.id, race, name: p.name, ...identityOf(p.look), from: PLAYER_HOME, base: p.effort, npc: false, disqualified: false }));
  return [...npcCandidates(cycle, post, scope), ...live];
}

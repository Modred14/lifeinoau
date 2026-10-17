import type { GameTime } from "../clock";
import { makeArt, type ArtEntry, type PaletteName } from "./art";
import { hash3, pick } from "./seed";

export const FAITH: readonly ArtEntry[] = [
  makeArt("faith", "living-stream", "Living Stream Campus Fellowship", ["Sunday service 8am", "Come as you are"], "purple", { footer: "Amphi Theatre", weight: 1.5 }),
  makeArt("faith", "covenant-heirs", "Covenant Heirs Fellowship", ["Bible study, Wednesday 6pm"], "blue", { footer: "AUD I", days: [0, 1, 2] }),
  makeArt("faith", "house-of-mercy", "House of Mercy Students Assembly", ["Night vigil this Friday", "10pm till dawn"], "black", { footer: "Bring a friend", days: [2, 3, 4], weight: 2 }),
  makeArt("faith", "unity-circle", "Unity Muslim Students Circle", ["Jumat lecture, Friday 1pm", "Topic: Seeking knowledge"], "green", { footer: "Central Mosque", days: [2, 3, 4], weight: 2 }),
  makeArt("faith", "graceway-choir", "Graceway Choir auditions", ["Saturday 4pm", "All voice parts welcome"], "teal", { footer: "Religious Ground", days: [3, 4, 5] }),
  makeArt("faith", "daybreak", "Daybreak Catholic Students", ["Morning mass 6am daily"], "white", { footer: "Chapel on Religious Ground Road" }),
  makeArt("faith", "freshers-service", "Freshers welcome service", ["This Sunday, 9am", "Free breakfast after"], "orange", { footer: "Living Stream Campus Fellowship", days: [4, 5, 6], weight: 2 }),
  makeArt("faith", "tahajjud", "Tahajjud night", ["Thursday, 11pm", "Sisters section available"], "green", { footer: "Unity Muslim Students Circle", days: [1, 2, 3] }),
  makeArt("faith", "praise-night", "Campus Praise Night", ["Saturday 6pm", "Five choirs, one stage"], "pink", { footer: "Open field beside the SUB", days: [3, 4, 5], weight: 2 }),
  makeArt("faith", "exam-prayers", "Prayer for exam success", ["Every Monday 6am", "Thirty minutes only"], "sky", { footer: "Covenant Heirs Fellowship", days: [5, 6, 0] }),
];

export const SPORT: readonly ArtEntry[] = [
  makeArt("sport", "athletics", "Join the athletics team", ["Trials every Tuesday 5pm"], "red", { footer: "Sports Centre track" }),
  makeArt("sport", "gym", "Gym open 6am to 8pm", ["N500 per session", "N4,000 for the month"], "black", { footer: "Sports Centre" }),
  makeArt("sport", "basketball", "3 on 3 basketball", ["Saturday 4pm", "Register your team by Friday"], "orange", { footer: "Sports Centre court", days: [2, 3, 4, 5] }),
  makeArt("sport", "chess", "Chess club meets Thursday", ["5pm at the SUB foyer", "Boards provided"], "white", { footer: "Great Ife Chess Club", days: [1, 2, 3] }),
  makeArt("sport", "jogging", "Morning jog, 6am", ["Start at the Sports Centre gate", "Free for everybody"], "teal", { footer: "Keep Fit Club" }),
  makeArt("sport", "table-tennis", "Table tennis open", ["Singles knockout", "Winner takes N10,000"], "blue", { footer: "Hall common rooms", days: [4, 5, 6] }),
];

const TEAMS: readonly string[] = ["Awo Lions", "Fajuyi Rocks", "Angola Stars", "Moz United", "ETF Rangers", "Alumni FC", "PG Elders", "Moremi Queens"];
const KICK_OFFS: readonly string[] = ["4pm", "5pm"];
const FIXTURE_PALETTES: readonly PaletteName[] = ["green", "red", "blue", "yellow"];
const FIXTURES_PER_DAY = 2;
const FIXTURE_WEIGHT = 2;

export function fixtures(t: GameTime): ArtEntry[] {
  const out: ArtEntry[] = [];
  for (let k = 0; k < FIXTURES_PER_DAY; k++) {
    const home = Math.floor(hash3(t.dayIndex, k, 81) * TEAMS.length);
    const away = (home + 1 + Math.floor(hash3(t.dayIndex, k, 82) * (TEAMS.length - 1))) % TEAMS.length;
    out.push(
      makeArt("sport", `fixture-${t.dayIndex}-${k}`, `${TEAMS[home]} vs ${TEAMS[away]}`, [`Today, ${KICK_OFFS[k % KICK_OFFS.length]}`, "Inter hall football"], pick(FIXTURE_PALETTES, hash3(t.dayIndex, k, 83)), {
        footer: "Sports Centre main pitch",
        near: /oau sports centre/i,
        weight: FIXTURE_WEIGHT,
      }),
    );
  }
  return out;
}

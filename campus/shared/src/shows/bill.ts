import type { ShowKind } from "./types";

export type MomentId = "dobale" | "wild" | "stage" | "light" | "hype" | "ovation" | "award" | "crown" | "tiebreak" | "encore" | "altar" | "question";

export interface KindSpec {
  label: string;
  emoji: string;
  titles: readonly string[];
  acts: readonly string[];
  fees: readonly number[];
  fun: number;
  colors: readonly number[];
  dance: boolean;
  opener?: MomentId;
  moments: readonly MomentId[];
}

const BANDS = ["Dayo Blaze", "Sista Temi", "Kola Keys", "Mayowa Vibes", "DJ Kopa Sound", "The Ogba Boys", "Zainab Soul", "Lil Risky", "Ada Strings", "Omo Iya Ila Band", "T-Gboro Crew"];
const COMEDIANS = ["MC Jollof Pikin", "Baba Handout", "Aunty Carry-Over"];
const GOSPEL = ["Minister Ife Praise", "The Chapel Voices", "Bro. Segun Tambourine"];
const LECTURERS = ["Prof. Abiodun Fakorede", "Prof. Nkechi Anozie", "Dr. Musa Danladi"];
const TROUPE = ["Dramatic Arts 300 Level", "Dramatic Arts Final Year Cast", "The Pit Theatre Troupe"];
const HOSTS = ["MC Tobi Gbedu", "Aunty Bisi Compere", "Seyi Mic Man", "Lady Dupe Spotlight"];

export const MOMENT_TEXT: Record<MomentId, { text: string; fun: number }> = {
  dobale: { text: "🙇 Crowd dey shout DOBALE! {act} don prostrate. Show don start.", fun: 6 },
  wild: { text: "🔥 The crowd don go wild. Everybody dey on their feet.", fun: 5 },
  stage: { text: "🎤 {act} don call one student come stage. The whole place dey hail.", fun: 5 },
  light: { text: "💡 Light don go. Wait small... generator don kick in. Show continues.", fun: 2 },
  hype: { text: "📣 Awo, are you there? Moremi, make some noise!", fun: 4 },
  ovation: { text: "👏 Standing ovation. The cast dey bow.", fun: 5 },
  award: { text: "🏆 Most Sociable award don land. One table dey shout pass.", fun: 4 },
  crown: { text: "👑 The judges don pick the top five. Tension everywhere.", fun: 4 },
  tiebreak: { text: "🧠 Tie breaker! The hall quiet like exam hall.", fun: 4 },
  encore: { text: "🎶 One more song! {act} don come back for encore.", fun: 5 },
  altar: { text: "🙌 Everybody dey their feet. Praise don enter another level.", fun: 5 },
  question: { text: "🙋 Question time. One fresher don ask the question everybody fear.", fun: 3 },
};

export const KINDS: Record<ShowKind, KindSpec> = {
  concert: {
    label: "Live concert", emoji: "🎤", titles: ["Ogba Femi Fest", "Great Ife Unplugged", "Road 1 Live", "Campus Jamz Night"], acts: BANDS,
    fees: [500, 800, 1000], fun: 1.3, colors: [0xb5179e, 0x7209b7, 0xd00000], dance: true, opener: "dobale", moments: ["wild", "stage", "light", "hype", "encore"],
  },
  comedy: {
    label: "Comedy night", emoji: "😂", titles: ["Laff Clinic", "Carry-Over Comedy Jam", "Laugh Wan Kill Me"], acts: COMEDIANS,
    fees: [300, 400], fun: 1.1, colors: [0xf77f00, 0xe85d04], dance: false, opener: "dobale", moments: ["stage", "light", "hype", "wild"],
  },
  play: {
    label: "Stage play", emoji: "🎭", titles: ["The Crown and the Cowrie", "Wahala Dey for Hostel", "The Gods Are Still Watching", "Midnight at Road 7"], acts: TROUPE,
    fees: [300, 400, 500], fun: 0.9, colors: [0x6a040f, 0x3c096c], dance: false, moments: ["ovation", "light"],
  },
  gospel: {
    label: "Gospel concert", emoji: "🙌", titles: ["In His Courts", "Praise Night", "Songs of the Season", "Campus Worship Encounter"], acts: GOSPEL,
    fees: [0], fun: 1.0, colors: [0x1d4ed8, 0x0f766e], dance: true, moments: ["altar", "light", "encore"],
  },
  movie: {
    label: "Movie night", emoji: "🎬", titles: ["Movie Under the Stars", "Nolly Night", "Projector Night"], acts: ["Film Club", "Cine Ife"],
    fees: [100], fun: 0.8, colors: [0x14213d, 0x283618], dance: false, moments: ["light"],
  },
  dinner: {
    label: "Dinner and awards", emoji: "🍽️", titles: ["Faculty of Law Dinner and Awards", "Technology Night of Honours", "Social Sciences Dinner", "Pharmacy Dinner and Awards"], acts: HOSTS,
    fees: [1500], fun: 1.2, colors: [0x1b1b1e, 0x4a0e0e], dance: false, moments: ["award", "light", "award"],
  },
  carnival: {
    label: "Cultural night", emoji: "🥁", titles: ["Cultural Night: Ile Wa", "Carnival Night", "Battle of the Halls"], acts: ["Ife Dance Troupe", "Talking Drum Ensemble", "T-Gboro Crew"],
    fees: [200], fun: 1.1, colors: [0x2d6a4f, 0xbc6c25], dance: true, moments: ["hype", "wild", "light"],
  },
  freshers: {
    label: "Freshers' welcome", emoji: "🎉", titles: ["Freshers' Night: Jambite Welcome", "Jambite Rush Party"], acts: ["DJ Kopa Sound", "The Ogba Boys", "Lil Risky"],
    fees: [0, 300], fun: 1.3, colors: [0x0077b6, 0xff006e], dance: true, moments: ["hype", "wild", "stage", "light"],
  },
  talent: {
    label: "Talent hunt", emoji: "🌟", titles: ["Great Ife Talent Night", "Campus Star Search", "Open Mic Showdown"], acts: HOSTS,
    fees: [150, 200], fun: 1.0, colors: [0x9d4edd, 0xff9e00], dance: true, moments: ["stage", "wild", "light"],
  },
  pageant: {
    label: "Pageant", emoji: "👑", titles: ["Face of Great Ife", "Mr and Miss Fresher", "Queen of the Halls"], acts: HOSTS,
    fees: [300, 500], fun: 1.0, colors: [0xc9184a, 0x7b2cbf], dance: false, moments: ["crown", "light", "wild"],
  },
  lecture: {
    label: "Public lecture", emoji: "🎓", titles: ["Inaugural Lecture", "Alumni Homecoming Lecture", "Career Fair and Tech Talk"], acts: LECTURERS,
    fees: [0], fun: 0.3, colors: [0x1e3a5f, 0x344e41], dance: false, moments: ["question"],
  },
  quiz: {
    label: "Quiz and debate final", emoji: "🧠", titles: ["Inter-Faculty Quiz Final", "Great Debate Final", "Hall Quiz Showdown"], acts: ["Quiz Master Kunle", "Debate Society", "Moderator Amaka"],
    fees: [0], fun: 0.7, colors: [0x005f73, 0x9b2226], dance: false, moments: ["tiebreak", "question"],
  },
};

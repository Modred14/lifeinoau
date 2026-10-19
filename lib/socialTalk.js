// lib/socialTalk.js
// Names and things to say for the student NPCs who fill the open spaces. Pure (no 3D library, no database), so the scene, the page and the tests share it.
// These people are scenery: they are never real players, they are never saved, and what they say has no effect on the game.
const FIRST = ["Tolu", "Ayo", "Chioma", "Emeka", "Funke", "Ibrahim", "Kemi", "Segun", "Ngozi", "Dayo", "Bola", "Uche", "Zainab", "Femi", "Amaka", "Tunde", "Halima", "Yemi", "Chidi", "Sade", "Bisi", "Musa", "Ife", "Kunle", "Titi", "Obi", "Lara", "Wale", "Nkechi", "Damola"];
const LAST = ["A.", "B.", "C.", "D.", "E.", "F.", "I.", "J.", "K.", "L.", "M.", "N.", "O.", "S.", "T.", "Y."];
const GREET = ["Hey! How far?", "Good day! Which department are you?", "Ah, a new face. How is school treating you?", "Hi! Have you eaten today?", "Hello o! Are you rushing to class too?", "Hey, nice to see you out here!", "How body? The week has been long, abeg.", "Hi! You look like someone with a CGPA plan."];
const CHAT = ["Did you hear the lecture is moved to the big theatre?", "The jollof at the canteen is not what it used to be.", "I am just here waiting for my next class.", "Revision season is coming. Let us start early this time.", "This place is the best spot on campus in the evening.", "I heard a lecturer is setting a surprise test.", "Do you know a good place to print?"];

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
/** The same name for the same seed, every time. */
export const studentName = (seed) => { const h = hash(seed); return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}`; };
/** What they say when you greet them (varies by person and by how many times you have greeted them). */
export const greetLine = (seed, n = 0) => GREET[(hash(seed) + n) % GREET.length];
export const chatLine = (seed, n = 0) => CHAT[(hash(seed + "c") + n) % CHAT.length];
export const NPC_LINES = { GREET, CHAT };

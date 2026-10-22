// tests/settings.test.mjs
// Settings and profile rules: preference validation, changing gender without losing the look, school halls, name rules. Pure Node, no database.
import { cleanSettings, SETTING_DEFAULTS, settingsOf, sameSettings } from "../lib/settings.js";
import { adaptLook, cleanLook, HAIR, OUTFITS, SKIN_TONES, COLORS, lookKey, defaultLook } from "../lib/look.js";
import { hostelForGender, genderChangeBlock, nameError, cleanName, NAME_RE } from "../lib/profileRules.js";
import { allowedHostels, schoolHalls } from "../lib/rules.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

// ---- preferences ----
chk("no saved settings means all defaults", JSON.stringify(settingsOf({ settings: null })) === JSON.stringify(SETTING_DEFAULTS) && JSON.stringify(settingsOf({})) === JSON.stringify(SETTING_DEFAULTS));
chk("a partial patch changes only what it names", (() => { const s = cleanSettings({ audio: { music: false } }); return s.audio.music === false && s.audio.sfx === true && s.gameplay.nameTags === true; })());
chk("a patch is merged onto what is already saved", (() => { const s1 = cleanSettings({ accessibility: { largeText: true } }); const s2 = cleanSettings({ audio: { sfx: false } }, s1); return s2.accessibility.largeText === true && s2.audio.sfx === false; })());
chk("unknown groups and keys are dropped", (() => { const s = cleanSettings({ admin: { god: true }, audio: { hack: 1 } }); return !("admin" in s) && !("hack" in s.audio); })());
chk("wrong types are ignored, not stored", (() => { const s = cleanSettings({ audio: { music: "yes", musicVolume: "loud" }, gameplay: { interiorView: "sideways" } }); return s.audio.music === true && s.audio.musicVolume === 100 && s.gameplay.interiorView === "follow"; })());
chk("volumes are clamped to 0-100 and rounded", (() => { const a = cleanSettings({ audio: { musicVolume: 999, sfxVolume: -5 } }).audio, b = cleanSettings({ audio: { musicVolume: 33.6 } }).audio; return a.musicVolume === 100 && a.sfxVolume === 0 && b.musicVolume === 34; })());
chk("junk input of any shape gives the defaults", [null, undefined, 5, "x", [], [1]].every((j) => sameSettings(j, SETTING_DEFAULTS)));
chk("sameSettings tells a real difference", !sameSettings({ privacy: { searchable: false } }, SETTING_DEFAULTS));

// ---- changing gender keeps the look ----
const woman = cleanLook({ skin: "espresso", hair: "gele", outfit: "owambe", top: "navy", bottom: "khaki", height: "tall", acc: ["bag", "necklace"] }, "F");
const asMan = adaptLook(woman, "M");
chk("the result is always a valid look for the new gender", JSON.stringify(cleanLook(asMan, "M")) === JSON.stringify(asMan) && HAIR.M.includes(asMan.hair));
chk("skin, outfit, colours and height are kept", asMan.skin === "espresso" && asMan.outfit === "owambe" && asMan.top === "navy" && asMan.bottom === "khaki" && asMan.height === "tall");
chk("a woman's hair that men do not have becomes the nearest match, not a reset", asMan.hair === "classic" && adaptLook({ ...woman, hair: "long" }, "M").hair === "locs" && adaptLook({ ...woman, hair: "ponytail" }, "M").hair === "braids");
chk("hair both genders have is kept", adaptLook({ ...woman, hair: "afro" }, "M").hair === "afro" && adaptLook({ ...asMan, hair: "locs" }, "F").hair === "locs");
chk("accessories map to their equivalent", JSON.stringify(asMan.acc) === JSON.stringify(["backpack", "chain"]) && JSON.stringify(adaptLook(asMan, "F").acc) === JSON.stringify(["bag", "necklace"]));
chk("man to woman and back keeps everything that exists for both", (() => { const m = cleanLook({ skin: "amber", hair: "braids", outfit: "office", top: "white", bottom: "black", height: "short" }, "M"); const back = adaptLook(adaptLook(m, "F"), "M"); return lookKey(back, "M") === lookKey(m, "M"); })());
chk("any garbage still gives a valid look", [null, undefined, 3, "x", { hair: "<script>", skin: {} }].every((j) => ["M", "F"].every((g) => { const l = adaptLook(j, g); return HAIR[g].includes(l.hair) && OUTFITS.includes(l.outfit) && l.skin in SKIN_TONES && l.top in COLORS; })));
chk("the look key tells genders apart", lookKey(woman, "F") !== lookKey(woman, "M"));

// ---- school halls follow the gender ----
const HALLS = { M: schoolHalls("M"), F: schoolHalls("F") };
chk("every male hall maps to a female hall and back to itself", HALLS.M.every((h) => HALLS.F.includes(hostelForGender(h, "F")) && hostelForGender(hostelForGender(h, "F"), "M") === h));
chk("a hall for the right gender does not move", HALLS.M.every((h) => hostelForGender(h, "M") === h) && HALLS.F.every((h) => hostelForGender(h, "F") === h));
chk("a private home never changes", ["Ojaja", "Off-campus", null].every((h) => hostelForGender(h, "F") === h && hostelForGender(h, "M") === h));
chk("a class that could live in a hall can live in its pair", ["LAPO", "MAPO", "NEPO"].every((c) => allowedHostels(c, "M", 200).every((h) => !HALLS.M.includes(h) || allowedHostels(c, "F", 200).includes(hostelForGender(h, "F")))));
chk("the big halls pair with the big halls", hostelForGender("Angola", "F") === "Mozambique" && hostelForGender("Mozambique", "M") === "Angola");

// ---- who may switch ----
chk("nothing blocks a plain player", genderChangeBlock({}) === null);
chk("sleeping, a romantic bond or a pregnancy each block it, with a reason", ["sleeping", "romantic", "pregnant"].every((k) => typeof genderChangeBlock({ [k]: true }) === "string"));

// ---- names ----
chk("name rules match character creation", nameError("tolu_ife") === null && nameError("ab") && nameError("a".repeat(21)) && nameError("bad<name>") && nameError("") && NAME_RE.test("Tolu Ife"));
chk("names are trimmed and stripped of control characters", cleanName("  tolu\u0000x  ") === "tolu x" && cleanName(null) === "");

process.exit(bad ? 1 : 0);

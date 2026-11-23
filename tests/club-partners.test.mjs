// tests/club-partners.test.mjs: the dance partners on the floor of ALL THREE clubs.
// Plan level (real interiors compiled in Node): two women per club, dancing in place, standing on that club's own floor, in the open (not inside furniture or a wall),
// near the club's dance ring, and not stacked on top of each other or on the ambient dancers. Source level: the scene's prompt/step/end wiring is present.
// Not covered (needs a browser): how the two-character dance LOOKS.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js"; import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildInterior } from "../lib3d/interiors/index.js"; import { activityHubs } from "../lib3d/interiors/activityHubs.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map(); for (const l of LANDMARKS) all.set(l.id, l); for (const p of d.places) all.set(p.id, p);
const inBox = (s, x, z, m) => Math.abs(x - s.x) < s.w / 2 + m && Math.abs(z - s.z) < s.d / 2 + m;
for (const id of ["club_quantum", "club_0203", "club_divas"]) {
  const p = all.get(id), comp = buildInterior(p), npcs = comp.npcs ?? [], partners = npcs.filter((n) => n.partner);
  const ring = activityHubs(comp, classify(id, p.kind).spec).hubs.find((h) => h.act === "dance");
  chk(`${id}: has two or more partners`, partners.length >= 2);
  chk(`${id}: every partner is a woman, dancing in place`, partners.every((n) => n.gender === "F" && n.mode === "dance"));
  const hall = comp.rooms.find((r) => r.id === partners[0]?.room);
  chk(`${id}: partners stand in the club's own main room (${hall?.name})`, partners.every((n) => n.room === hall?.id && n.x > hall.x0 + 1 && n.x < hall.x1 - 1 && n.z > hall.z0 + 1 && n.z < hall.z1 - 1));
  const blocked = partners.filter((n) => (comp.solids ?? []).some((s) => (s.floor ?? 0) === (n.floor ?? 0) && s.y0 < 1.2 && s.y1 > 0.3 && inBox(s, n.x, n.z, 0.35)));
  chk(`${id}: none stands inside furniture or a wall (${blocked.map((n) => `${n.x},${n.z}`).join(" ") || "clear"})`, blocked.length === 0);
  chk(`${id}: each is within ${6} m of the dance ring, so she is easy to find`, partners.every((n) => Math.hypot(n.x - ring.x, n.z - ring.z) < 6));
  const placed = npcs.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.z)); // some crowd members are placed at random when the room loads, so only fixed ones can be checked here
  const others = placed.filter((n) => !n.partner && n.mode === "dance");
  chk(`${id}: not stacked on another placed person (all at least 1.2 m apart)`, partners.every((a) => placed.every((b) => b === a || Math.hypot(a.x - b.x, a.z - b.z) >= 1.2)));
  chk(`${id}: the ambient dancers are still there (${others.length})`, others.length >= 2);
}
const spots = ["club_quantum", "club_0203", "club_divas"].map((id) => buildInterior(all.get(id)).npcs.filter((n) => n.partner).map((n) => `${n.x},${n.z}`).join("|"));
chk("each club keeps its own layout: the partners stand in different places in each", new Set(spots).size === 3);
const sc = fs.readFileSync(new URL("../lib3d/interiors/scene.js", import.meta.url), "utf8");
chk("scene: partners get a 'Dance with' prompt, the activation and the start/end are wired", /action: sp\.n\.partner \? "dancepartner"/.test(sc) && /action === "dancepartner"/.test(sc) && /function startPartner/.test(sc) && /function endPartner/.test(sc));
chk("scene: she walks in close (stepped, not teleported) and faces the player", /if \(p\.partnered\)[\s\S]{0,400}Math\.min\(d - 1\.0, 1\.3 \* dt\)/.test(sc) && /P\.yaw = turnTo\(P\.yaw, Math\.atan2\(q\.x - P\.x/.test(sc));
chk("scene: however the dance ends, she goes back to her own dancing", /if \(partnerSelf && !dance\) endPartner\(\)/.test(sc));
chk("scene: a woman is a woman (explicit gender beats the seed hash)", /gender: n\.gender \?\? \(hashSeed/.test(sc));
console.log(bad ? `\n${bad} check(s) failed` : "\nAll partner checks passed"); process.exit(bad ? 1 : 0);

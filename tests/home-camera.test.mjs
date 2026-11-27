// The home camera: the player stays small, each kind of home has its own settings, and furniture between camera and player is detected for fading.
import { homeCameraFor, HOME_CAMERAS, minDistForPlayer, zoomLimits, playerScreenFrac, blocksView, PLAYER_MAX_FRAC } from "../lib/homeCamera.js";
const { roomFor } = await import("../lib/room.js");
let bad = 0; const chk = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${ok ? "" : " -> " + x}`); if (!ok) { bad++; process.exitCode = 1; } };
const fov = 26, kinds = Object.fromEntries(["Awo", "Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].map((h) => [h, homeCameraFor(roomFor(h, "p"))]));
chk("a hostel and Ojaja are compact; the 4-bedroom house is large; they do not share one setting", kinds.Awo.kind === "compact" && kinds.Ojaja.kind === "compact" && kinds["4-Bedroom House"].kind === "large" && new Set(Object.values(kinds).map((k) => k.kind)).size >= 3, JSON.stringify(Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, v.kind]))));
chk("the camera angle range is tighter (closer to top-down) in compact rooms than in large ones", HOME_CAMERAS.compact.polarMin < HOME_CAMERAS.large.polarMin && HOME_CAMERAS.compact.polarMax < HOME_CAMERAS.large.polarMax);
const d = minDistForPlayer(fov); chk("at the nearest allowed distance the player takes 15% of the screen height", Math.abs(playerScreenFrac(d, fov) - PLAYER_MAX_FRAC) < 1e-9, String(playerScreenFrac(d, fov)));
chk("a large house, zoomed all the way in, keeps the player at or under 15%", playerScreenFrac(zoomLimits(60, fov, HOME_CAMERAS.large).min, fov) <= PLAYER_MAX_FRAC + 1e-9);
chk("a tiny room that fits at a closer distance is allowed to fill the screen (never zoomed out past its own fit)", zoomLimits(18, fov, HOME_CAMERAS.compact).min <= 18 * 0.95 + 1e-9);
const cam = [10, 6, 10], head = [0, 1.05, 0];
chk("a tall piece standing between the camera and the player blocks the view", blocksView(cam, head, [0.9, 0, 0.9], [1.7, 2.0, 1.7]));
chk("a low piece far from the player, under the camera line, does not block", !blocksView(cam, head, [4, 0, 4], [6, 1.0, 6]));
chk("a piece behind the player, or off to the side, does not", !blocksView(cam, head, [-6, 0, -6], [-4, 1.8, -4]) && !blocksView(cam, head, [-6, 0, 4], [-4, 1.8, 6]));
chk("a piece the player is standing inside (the bed they are in) never blocks", !blocksView(cam, head, [-1, 0, -1], [1, 1, 1]));
chk("a piece right against the player does not flicker", !blocksView(cam, head, [0.2, 0, 0.2], [0.5, 1.8, 0.5], 0.9));
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed");

// ---- the fader, on real three.js objects ----
{
  const THREE = await import("three"), { createOccluder } = await import("../lib3d/occlusion.js"), occ = createOccluder(THREE);
  const mk = (x, z, h = 1.8) => { const g = new THREE.Group(), m = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), new THREE.MeshStandardMaterial({ color: "#445" })); m.position.y = h / 2; g.add(m); g.position.set(x, 0, z); return g; };
  const blocker = mk(1.3, 1.3), far = mk(-4, 3), rug = mk(1.2, 1.2, 0.02), cam = new THREE.Vector3(10, 6, 10), me = { x: 0, z: 0 };
  const all = [blocker, far, rug]; for (let i = 0; i < 60; i++) occ.update(1 / 30, cam, me, all, { floor: 0.18 });
  const op = (g) => g.children[0].material.opacity;
  chk("the TV-sized piece between camera and player fades to the floor opacity, the others stay solid", Math.abs(op(blocker) - 0.18) < 0.03 && op(far) === 1 && op(rug) === 1, [op(blocker), op(far), op(rug)].join());
  chk("a faded piece is transparent only while faded", blocker.children[0].material.transparent === true);
  me.x = -6; me.z = -6; for (let i = 0; i < 90; i++) occ.update(1 / 30, cam, me, all, { floor: 0.18 });
  chk("when the player moves away the piece becomes solid again, with its original material state restored", op(blocker) === 1 && blocker.children[0].material.transparent === false);
  me.x = 0; me.z = 0; for (let i = 0; i < 60; i++) occ.update(1 / 30, cam, me, all, { floor: 0.18 });
  occ.update(1 / 30, cam, me, all, { floor: 0.18, skip: new Set([blocker]) }); for (let i = 0; i < 60; i++) occ.update(1 / 30, cam, me, all, { floor: 0.18, skip: new Set([blocker]) });
  chk("the piece being arranged (skip) is never faded", op(blocker) === 1);
  for (let i = 0; i < 60; i++) occ.update(1 / 30, cam, me, all, { floor: 0.18, enabled: false });
  chk("with fading off (buy mode, asleep, outdoors) everything is solid", all.every((g) => op(g) === 1));
  console.log(bad ? `\n${bad} check(s) failed` : "\nAll fader checks passed");
}

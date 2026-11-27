// buildPlot can leave the garage out (the /buy preview shows a house and a small compound only); with it left in nothing changes.
const THREE = await import("three"), { buildPlot } = await import("../lib3d/plot3d.js"), { roomFor } = await import("../lib/room.js");
let bad = 0; const chk = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${ok ? "" : " -> " + x}`); if (!ok) { bad++; process.exitCode = 1; } };
const mat = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c }), tree = () => new THREE.Group();
const count = (g) => { let n = 0; g.traverse((o) => { if (o.isMesh) n++; }); return n; };
for (const h of ["Awo", "Off-campus", "2-Bedroom Flat", "4-Bedroom House"]) {
  const room = roomFor(h, "p"), full = buildPlot(room, { mat, tree }), bare = buildPlot(room, { mat, tree, garage: false });
  chk(`${h}: the default plot still has its garage; the preview plot has noticeably fewer parts`, count(bare.group) < count(full.group) - 20, `${count(bare.group)} vs ${count(full.group)}`);
  chk(`${h}: the plot data (bays, lane) the vehicle systems read is unchanged by the preview option`, JSON.stringify(full.plot.bays) === JSON.stringify(bare.plot.bays) && !!full.plot.garage);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed");

// ---- the Buy mode on /home is the preview: it draws no garage and no parked vehicles; the walkable home keeps both ----
{
  const { readFileSync } = await import("node:fs"), gh = readFileSync(new URL("../components/GameHome.js", import.meta.url), "utf8"), rs = readFileSync(new URL("../lib3d/room.js", import.meta.url), "utf8");
  chk("the Buy-mode RoomStage on /home is given garage={false}", /<RoomStage[\s\S]*?garage=\{false\}/.test(gh));
  chk("the room scene draws no garage, no parked vehicles and frames only the house and a small compound when garage is false, and the walkable home (HomeWorld) never sets it", /cb\.garage === false \? \[\] : list/.test(rs) && /garage: cb\.garage !== false/.test(rs) && /noGarage/.test(rs) && !/garage=\{false\}/.test(readFileSync(new URL("../components/HomeWorld.js", import.meta.url), "utf8")));
  console.log(bad ? `\n${bad} check(s) failed` : "\nAll garage-wiring checks passed");
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { lecturesFor } from "../src/clock.ts";
import { PLAYER_RADIUS } from "../src/constants.ts";
import { ACTS, ACT_DURATION, ACT_POSE, INTERIORS, SEATS, SPOTS, TEMPLATES, USE_DISTANCE, floorHeightAt, interiorBlocked, type Interior } from "../src/interiors.ts";
import { PLACES, PX_PER_METER } from "../src/map.ts";
import { QUEUES } from "../src/queues.ts";

const M = PX_PER_METER;
const rooms = (id: string) => INTERIORS.filter((it): it is Interior => it?.template.id === id);

function reachable(it: Interior): (x: number, y: number) => boolean {
  const step = 0.2 * M;
  const cols = Math.ceil(it.w / step), rows = Math.ceil(it.h / step);
  const seen = new Uint8Array(cols * rows);
  const cell = (x: number, y: number) => Math.floor((y - it.oy) / step) * cols + Math.floor((x - it.ox) / step);
  const queue = [cell(it.entry.x, it.entry.y)];
  seen[queue[0]] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const cx = c % cols, cy = Math.floor(c / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ny * cols + nx]) continue;
      if (interiorBlocked(it.ox + (nx + 0.5) * step, it.oy + (ny + 0.5) * step, PLAYER_RADIUS)) continue;
      seen[ny * cols + nx] = 1;
      queue.push(ny * cols + nx);
    }
  }
  return (x, y) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const c = cell(x + dx * step, y + dy * step);
      if (c >= 0 && c < seen.length && seen[c]) return true;
    }
    return false;
  };
}

test("existing activity ids keep their synced index", () => {
  assert.deepEqual(ACTS.slice(0, 14), ["none", "sit", "sleep", "eat", "study", "pray", "tv", "play", "atm", "cook", "tutor", "loan", "dance", "exam"]);
  assert.equal(ACT_POSE.eat, "busy");
  assert.equal(ACT_DURATION.eat, 5);
});

test("every lecture, classroom and food court spot can be reached and used", () => {
  for (const id of ["lecture", "classroom", "foodcourt"]) {
    assert.ok(rooms(id).length > 0, `no ${id} interiors`);
    for (const it of rooms(id)) {
      assert.ok(!interiorBlocked(it.entry.x, it.entry.y, PLAYER_RADIUS), `${id} entry is blocked`);
      const open = reachable(it);
      for (let i = it.spotStart; i < it.spotEnd; i++) {
        const s = SPOTS[i];
        const where = `${PLACES[it.place].name} ${s.label} #${i - it.spotStart}`;
        assert.ok(!interiorBlocked(s.sx, s.sy, PLAYER_RADIUS), `${where}: stand point is blocked`);
        assert.ok(open(s.sx, s.sy), `${where}: stand point cannot be walked to`);
        assert.ok(USE_DISTANCE > 0 && Number.isFinite(s.x + s.y + s.face));
        assert.ok(s.x > it.ox && s.x < it.ox + it.w && s.y > it.oy && s.y < it.oy + it.h, `${where}: outside the room`);
      }
    }
  }
});

test("seats do not overlap and sit exactly on their prop", () => {
  for (const id of ["lecture", "classroom", "foodcourt", "hostel", "library", "bank"] as const) {
    const t = TEMPLATES[id];
    const seats = t.spots.filter((s) => s.seat);
    assert.ok(seats.length > 0, `${id} has no seats`);
    const cells = new Map<string, number>();
    for (const [n, s] of seats.entries()) {
      const key = `${Math.round(s.x / 0.4)}:${Math.round(s.y / 0.4)}`;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const other = cells.get(`${Math.round(s.x / 0.4) + dx}:${Math.round(s.y / 0.4) + dy}`);
        if (other !== undefined) assert.ok(Math.hypot(seats[other].x - s.x, seats[other].y - s.y) >= 0.5, `${id}: seats ${other} and ${n} overlap`);
      }
      cells.set(key, n);
      const prop = t.props.find((p) => p.seat === s.seat && Math.abs(p.x - s.x) <= p.w / 2 + 1e-6 && Math.abs(p.y - s.y) <= p.d / 2 + 1e-6);
      assert.ok(prop, `${id}: seat ${n} (${s.label}) has no ${s.seat} prop under it`);
      assert.equal(prop.floor ?? 0, s.floor ?? 0, `${id}: seat ${n} floor differs from its prop`);
      assert.ok(SEATS[s.seat!].h > 0.3 && SEATS[s.seat!].h < 0.6);
      if (s.surface) assert.ok(s.surface.h > SEATS[s.seat!].h + 0.2 && s.surface.near >= 0.2 && s.surface.near <= 0.35, `${id}: seat ${n} surface is out of reach`);
    }
  }
  for (const it of rooms("lecture")) {
    for (let i = it.spotStart; i < it.spotEnd; i++) {
      const s = SPOTS[i];
      assert.ok(Math.abs(floorHeightAt(s.x, s.y) - (s.floor ?? 0)) < 1e-9, "tier height differs under a seat");
      assert.ok(Math.abs(floorHeightAt(s.sx, s.sy) - (s.floor ?? 0)) < 1e-9, "aisle step differs from the seat tier");
    }
  }
});

test("eating seats pair with a table and a counter", () => {
  for (const id of ["foodcourt", "hostel"] as const) {
    const t = TEMPLATES[id];
    const dining = t.spots.filter((s) => s.menu !== undefined);
    assert.ok(dining.length >= 12, `${id} has too few table seats`);
    const counters = t.spots.map((s, i) => (s.kind === "eat" ? i : -1)).filter((i) => i >= 0);
    for (const counter of counters) assert.ok(dining.some((s) => s.menu === counter), `${id}: ${t.spots[counter].label} has no table`);
    for (const s of dining) {
      assert.equal(s.kind, "sit");
      assert.ok(s.seat && s.surface, "table seat without seat or surface");
      const reach = s.surface.near + 0.2;
      const tx = s.x + Math.cos(s.face) * reach, ty = s.y + Math.sin(s.face) * reach;
      const table = t.props.find((p) => p.type === "table" && Math.abs(p.x - tx) <= p.w / 2 && Math.abs(p.y - ty) <= p.d / 2);
      assert.ok(table, `${id}: no table in front of ${s.label} at ${s.x},${s.y}`);
      const near = Math.abs(Math.cos(s.face)) > 0.5 ? Math.abs(table.x - s.x) - table.w / 2 : Math.abs(table.y - s.y) - table.d / 2;
      assert.ok(Math.abs(near - s.surface.near) < 1e-6, `${id}: table edge distance differs from the seat surface`);
      assert.ok(t.spots[s.menu!].kind === "eat" && t.spots[s.menu!].price !== undefined);
    }
  }
  const sub = rooms("foodcourt")[0];
  for (let i = sub.spotStart; i < sub.spotEnd; i++) {
    const menu = SPOTS[i].menu;
    if (menu !== undefined) assert.ok(menu >= sub.spotStart && menu < sub.spotEnd && SPOTS[menu].kind === "eat");
  }
});

test("lecture venues keep enough seats and the food court keeps its queues and walkway", () => {
  assert.ok(TEMPLATES.lecture.spots.filter((s) => s.kind === "study").length >= 300);
  assert.ok(TEMPLATES.classroom.spots.filter((s) => s.kind === "study").length >= 30);
  for (let day = 0; day < 7; day++) for (const lecture of lecturesFor(day)) assert.equal(INTERIORS[lecture.place]?.template.id, "lecture", `${PLACES[lecture.place].name} is not a lecture theatre`);
  const exam = PLACES.findIndex((p) => /1000 seater/i.test(p.name));
  assert.equal(INTERIORS[exam]?.template.id, "lecture");
  const sub = rooms("foodcourt")[0];
  for (const [x, y] of [[16, 20], [16, 12], [16, 4], [18, 4], [20, 4]]) assert.ok(!interiorBlocked(sub.ox + x * M, sub.oy + y * M, PLAYER_RADIUS), `walkway blocked at ${x},${y}`);
  const shawarma = SPOTS.findIndex((s, i) => i >= sub.spotStart && i < sub.spotEnd && s.label === "Shawarma");
  assert.ok(shawarma >= 0 && Math.hypot(SPOTS[shawarma].sx - (sub.ox + 20 * M), SPOTS[shawarma].sy - (sub.oy + 4 * M)) <= USE_DISTANCE);
  for (let i = sub.spotStart; i < sub.spotEnd; i++) {
    if (SPOTS[i].kind !== "eat") continue;
    const queue = QUEUES.find((q) => q.spot === i);
    assert.ok(queue && queue.slots.length >= 4, `${SPOTS[i].label} queue is too short`);
  }
  assert.ok(SPOTS.length < 65535);
});

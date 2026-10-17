import assert from "node:assert/strict";
import { test } from "node:test";
import { PLAYER_RADIUS } from "../src/constants.ts";
import { INTERIORS, SEATS, SPOTS, TEMPLATES, USE_DISTANCE, floorHeightAt, interiorBlocked, type Interior } from "../src/interiors.ts";
import { PLACES, PX_PER_METER } from "../src/map.ts";
import { AMPHI, AUDITORIUM, VENUE_PLACE, VIEWING, VIEWING_PLACES, VIEWING_SEAT_LABEL, viewingArea } from "../src/shows.ts";

const M = PX_PER_METER;
const SLOT = { w: 1500, h: 1200 };
const VENUES = ["amphitheatre", "auditorium", "hostel"] as const;
const rooms = (id: string) => INTERIORS.filter((it): it is Interior => it?.template.id === id);

function reachable(it: Interior): (x: number, y: number) => boolean {
  const step = 0.2 * M;
  const cols = Math.ceil(it.w / step);
  const rows = Math.ceil(it.h / step);
  const seen = new Uint8Array(cols * rows);
  const cell = (x: number, y: number) => Math.floor((y - it.oy) / step) * cols + Math.floor((x - it.ox) / step);
  const queue = [cell(it.entry.x, it.entry.y)];
  seen[queue[0]] = 1;
  while (queue.length) {
    const c = queue.pop()!;
    const cx = c % cols;
    const cy = Math.floor(c / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const ny = cy + dy;
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

test("the two venues and every hostel get the right room", () => {
  assert.equal(INTERIORS[VENUE_PLACE.amphi]?.template.id, "amphitheatre");
  assert.equal(INTERIORS[VENUE_PLACE.oduduwa]?.template.id, "auditorium");
  assert.equal(rooms("hostel").length, VIEWING_PLACES.length);
  for (const i of VIEWING_PLACES) assert.equal(INTERIORS[i]?.template.id, "hostel", PLACES[i].name);
});

test("the rooms fit their slot and the entry is free", () => {
  for (const id of VENUES) {
    const t = TEMPLATES[id];
    assert.ok(t.w * M <= SLOT.w - 2 * M && t.d * M <= SLOT.h - 2 * M, `${id} does not fit its slot`);
    for (const it of rooms(id)) assert.ok(!interiorBlocked(it.entry.x, it.entry.y, PLAYER_RADIUS), `${id} entry is blocked`);
    for (const p of t.props) assert.ok(p.x - p.w / 2 >= -1e-6 && p.x + p.w / 2 <= t.w + 1e-6 && p.y - p.d / 2 >= -1e-6 && p.y + p.d / 2 <= t.d + 1e-6, `${id}: ${p.type} leaves the room`);
    for (const l of t.levels) assert.ok(l.w > 0 && l.d > 0 && l.x >= -1e-6 && l.y >= 0 && l.x + l.w <= t.w + 1e-6 && l.y + l.d <= t.d + 1e-6, `${id}: a level leaves the room`);
  }
});

test("every seat can be walked to, stands on its own step and sits on a drawn seat", () => {
  for (const id of VENUES) {
    const t = TEMPLATES[id];
    for (const it of rooms(id)) {
      const open = reachable(it);
      for (let i = it.spotStart; i < it.spotEnd; i++) {
        const s = SPOTS[i];
        const where = `${PLACES[it.place].name} ${s.label} #${i - it.spotStart}`;
        assert.ok(!interiorBlocked(s.sx, s.sy, PLAYER_RADIUS), `${where}: stand point is blocked`);
        assert.ok(open(s.sx, s.sy), `${where}: stand point cannot be walked to`);
        assert.ok(s.x > it.ox && s.x < it.ox + it.w && s.y > it.oy && s.y < it.oy + it.h, `${where}: outside the room`);
        assert.ok(s.sx > it.ox && s.sx < it.ox + it.w && s.sy > it.oy && s.sy < it.oy + it.h, `${where}: stand point outside the room`);
        assert.ok(Math.hypot(s.x - s.sx, s.y - s.sy) < 12 * M && USE_DISTANCE > 0);
        if (!s.seat || s.menu !== undefined || s.kind === "study") continue;
        assert.ok(Math.abs(floorHeightAt(s.x, s.y) - (s.floor ?? 0)) < 1e-9, `${where}: seat is not on its step`);
        assert.ok(Math.abs(floorHeightAt(s.sx, s.sy) - (s.floor ?? 0)) < 1e-9, `${where}: stand point is on another step`);
      }
    }
    const seats = t.spots.filter((s) => s.seat);
    const cells = new Map<string, number>();
    for (const [n, s] of seats.entries()) {
      const gx = Math.round(s.x / 0.4);
      const gy = Math.round(s.y / 0.4);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const other = cells.get(`${gx + dx}:${gy + dy}`);
        if (other !== undefined) assert.ok(Math.hypot(seats[other].x - s.x, seats[other].y - s.y) >= 0.5, `${id}: seats ${other} and ${n} overlap`);
      }
      cells.set(`${gx}:${gy}`, n);
      const prop = t.props.find((p) => p.seat === s.seat && Math.abs(p.x - s.x) <= p.w / 2 + 1e-6 && Math.abs(p.y - s.y) <= p.d / 2 + 1e-6);
      assert.ok(prop, `${id}: seat ${n} (${s.label}) has no ${s.seat} prop under it`);
      assert.equal(prop.floor ?? 0, s.floor ?? 0);
      assert.ok(SEATS[s.seat!].h > 0.3);
    }
  }
});

test("the venues seat hundreds and have a stage with a front row to dance in", () => {
  for (const id of ["amphitheatre", "auditorium"] as const) {
    const t = TEMPLATES[id];
    const seats = t.spots.filter((s) => s.kind === "sit" && s.seat);
    assert.ok(seats.length >= 400 && seats.length <= 700, `${id} has ${seats.length} seats`);
    assert.ok(t.spots.filter((s) => s.kind === "dance").length >= 6);
    assert.ok(t.props.some((p) => p.type === "stage") && t.props.some((p) => p.type === "truss") && t.props.some((p) => p.type === "backdrop"));
    const stage = t.props.find((p) => p.type === "stage")!;
    const it = rooms(id)[0];
    assert.ok(floorHeightAt(it.ox + stage.x * M, it.oy + stage.y * M) > 0.5, `${id} stage is not raised`);
    assert.ok(seats.every((s) => Math.sin(s.face) <= 1e-9), `${id}: a seat faces away from the stage`);
  }
  assert.ok(TEMPLATES.amphitheatre.props.filter((p) => p.type === "speaker").length >= 2);
  assert.ok(TEMPLATES.auditorium.props.some((p) => p.type === "lectern") && TEMPLATES.auditorium.props.some((p) => p.type === "curtain"));
  assert.ok(TEMPLATES.auditorium.props.some((p) => p.type === "counter" && p.label === "Ticket desk"));
  const amphi = TEMPLATES.amphitheatre.spots.filter((s) => s.seat);
  assert.ok(new Set(amphi.map((s) => s.floor)).size === AMPHI.tiers);
  assert.ok(amphi.some((s) => Math.abs(Math.cos(s.face)) > 0.5) && amphi.some((s) => Math.abs(Math.cos(s.face)) < 0.5));
  const hall = TEMPLATES.auditorium.spots.filter((s) => s.seat);
  assert.ok(Math.max(...hall.map((s) => s.floor ?? 0)) >= AUDITORIUM.galleryBase);
});

test("every hostel has a viewing centre and keeps its beds and buka", () => {
  const t = TEMPLATES.hostel;
  const area = viewingArea(t.w);
  const benches = t.spots.filter((s) => s.label === VIEWING_SEAT_LABEL);
  assert.equal(benches.length, VIEWING.rows * VIEWING.seats);
  for (const s of benches) {
    assert.equal(s.kind, "tv");
    assert.ok(s.x > area.x0 + VIEWING.wallOff + VIEWING.wall && s.y > area.screenY + 2);
  }
  assert.ok(t.props.some((p) => p.type === "projector" && Math.abs(p.x - area.mid) < 1e-9));
  assert.ok(t.props.some((p) => p.type === "board" && p.x > area.x0));
  assert.ok(t.npcs.some((n) => n.x > area.x0));
  assert.ok(t.spots.filter((s) => s.kind === "sleep").length >= 10);
  assert.ok(t.spots.filter((s) => s.kind === "eat").length >= 2);
  assert.ok(t.spots.filter((s) => s.menu !== undefined).length >= 12);
});

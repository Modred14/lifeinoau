import assert from "node:assert/strict";
import test from "node:test";
import {
  BANNER_CROSS_RULES,
  BANNER_FACE_BUDGET,
  BANNER_KEEP,
  BANNER_KIND_GAP,
  BANNER_KINDS,
  BANNER_SIZES,
  BANNER_SPACING,
  BANNER_SPOTS,
  BANNER_ZONES,
  LINES,
  MAX_BANNER_SPOTS,
  MINUTES_PER_DAY,
  PLACES,
  PX_PER_METER,
  ROADS,
  STALLS,
  VEHICLE_SPECS,
  assignBanners,
  bannerFeed,
  bannerFootprint,
  boardNotices,
  distSqToSegment,
  gameTime,
  isBlocked,
  nearBuilding,
  nearestCarriageway,
  noticeBoardNear,
  planBanners,
  type BannerArt,
  type PlacedArt,
} from "@campuslife/shared";

const M = PX_PER_METER;
const SLACK = 0.9;
const day = (d: number, minute = 600) => gameTime(d * MINUTES_PER_DAY + minute);
const week = [0, 1, 2, 3, 4, 5, 6].map((d) => day(70 + d));
const feet = BANNER_SPOTS.flatMap((s) => bannerFootprint(s).map((p) => ({ s, p })));

test("the plan is the same every time and a sensible size", () => {
  assert.deepEqual(planBanners(), BANNER_SPOTS);
  assert.ok(BANNER_SPOTS.length >= 120 && BANNER_SPOTS.length <= MAX_BANNER_SPOTS, `${BANNER_SPOTS.length} spots`);
  for (const kind of BANNER_KINDS) assert.ok(BANNER_SPOTS.some((s) => s.kind === kind), `no ${kind}`);
  BANNER_SPOTS.forEach((s, i) => {
    assert.equal(s.id, i);
    assert.ok(PLACES[s.place], "spot knows its nearest place");
    assert.ok(BANNER_ZONES.includes(s.zone));
    assert.equal(s.slots, BANNER_SIZES[s.kind].slots);
  });
});

test("the SUB, the gate road and hostel fronts are the busy spots", () => {
  const count = (zone: string) => BANNER_SPOTS.filter((s) => s.zone === zone).length;
  assert.ok(count("union") >= 20, `union ${count("union")}`);
  assert.ok(count("gate") >= 12, `gate ${count("gate")}`);
  assert.ok(count("hostel") >= 30, `hostel ${count("hostel")}`);
  assert.ok(count("road") < count("union"));
  assert.ok(BANNER_SPOTS.filter((s) => s.kind === "billboard").every((s) => s.zone === "gate"));
});

test("nothing stands on a road or a path", () => {
  for (const { s, p } of feet) {
    const margin = BANNER_SIZES[s.kind].margin * SLACK * M;
    for (const r of ROADS)
      for (let i = 0; i + 3 < r.pts.length; i += 2) {
        const reach = r.width / 2 + margin;
        assert.ok(distSqToSegment(p.x, p.y, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) >= reach * reach, `${s.kind} ${s.id} is on a ${r.kind}`);
      }
  }
});

test("nothing stands in a building or blocks a walker", () => {
  for (const { s, p } of feet) {
    assert.ok(!nearBuilding(p.x, p.y, BANNER_SIZES[s.kind].wall * SLACK * M), `${s.kind} ${s.id} touches a building`);
    assert.ok(!isBlocked(p.x, p.y), `${s.kind} ${s.id} stands on something solid`);
  }
});

test("doors, bus stops and stalls stay clear", () => {
  const clear = [
    ...PLACES.map((p) => ({ at: p.door, r: BANNER_KEEP.door })),
    ...LINES.flatMap((l) => l.stops.map((st) => ({ at: st.kerb, r: BANNER_KEEP.kerb }))),
    ...STALLS.map((st) => ({ at: { x: st.x, y: st.y }, r: BANNER_KEEP.stall })),
    ...STALLS.map((st) => ({ at: { x: st.npc.x, y: st.npc.y }, r: BANNER_KEEP.seller })),
  ];
  for (const { s, p } of feet) for (const c of clear) assert.ok(Math.hypot(c.at.x - p.x, c.at.y - p.y) >= c.r * M - 1e-6, `${s.kind} ${s.id} crowds a door, stop or stall`);
});

test("spots keep their distance from each other", () => {
  for (let i = 0; i < BANNER_SPOTS.length; i++)
    for (let j = i + 1; j < BANNER_SPOTS.length; j++) {
      const a = BANNER_SPOTS[i];
      const b = BANNER_SPOTS[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y) / M;
      assert.ok(d >= BANNER_SPACING.gap + (a.span + b.span) / 2 - 1e-6, `${a.kind} ${i} and ${b.kind} ${j} overlap`);
      if (a.kind === b.kind) assert.ok(d >= BANNER_KIND_GAP[a.kind] - 1e-6, `two ${a.kind} banners ${d.toFixed(1)} m apart`);
    }
});

test("cross banners only span wide roads and clear the tallest vehicle", () => {
  const tallest = Math.max(...Object.values(VEHICLE_SPECS).map((v) => v.size[2]));
  assert.ok(BANNER_SIZES.cross.lift >= tallest + BANNER_CROSS_RULES.vehicleHeadroom, "a bus would hit the banner");
  const cross = BANNER_SPOTS.filter((s) => s.kind === "cross");
  assert.ok(cross.length >= 6);
  for (const s of cross) {
    const road = nearestCarriageway(s.x, s.y, Math.cos(s.face), Math.sin(s.face));
    assert.ok(road && road.distance < M, "cross banner is not centred on a road");
    assert.ok(road.width >= BANNER_CROSS_RULES.minRoadWidth * M, `road only ${road.width / M} m wide`);
    assert.ok(s.span >= road.width / M + BANNER_CROSS_RULES.setback * 2 - 1e-6);
    assert.ok(Math.abs(Math.cos(s.face) * road.dx + Math.sin(s.face) * road.dy) > 0.99, "banner is not square to the road");
  }
});

test("there is art to show on every weekday and plenty of it across a week", () => {
  const all = new Map<string, BannerArt>();
  for (const t of week) {
    const feed = bannerFeed(t);
    assert.ok(feed.length >= 40, `only ${feed.length} on weekday ${t.weekday}`);
    assert.equal(new Set(feed.map((a) => a.id)).size, feed.length);
    for (const a of feed) all.set(a.id, a);
  }
  assert.ok(all.size >= 60, `${all.size} distinct pieces`);
  for (const tone of ["notice", "advert", "faith", "sport"]) assert.ok([...all.values()].some((a) => a.tone === tone), `no ${tone}`);
  for (const a of all.values()) {
    const text = [a.title, ...a.lines, a.footer ?? ""].join(" ");
    assert.ok(!/[–—]/.test(text), `dash in ${a.id}`);
    assert.ok(a.title.length > 0 && a.title.length <= 60, `title of ${a.id}`);
    assert.ok(a.weight > 0 && a.color !== a.ink);
  }
  assert.notDeepEqual(bannerFeed(week[0]).map((a) => a.id), bannerFeed(week[5]).map((a) => a.id));
});

test("each spot gets art that suits it, the same all day and different tomorrow", () => {
  const feed = bannerFeed(day(70, 420));
  const morning = assignBanners(BANNER_SPOTS, feed, day(70, 420));
  const night = assignBanners(BANNER_SPOTS, feed, day(70, 1380));
  const tomorrow = assignBanners(BANNER_SPOTS, bannerFeed(day(71)), day(71));
  const ids = (a: PlacedArt[][]) => a.map((list) => list.map((x) => x.id));
  assert.deepEqual(ids(morning), ids(night));
  assert.notDeepEqual(ids(morning), ids(tomorrow));
  BANNER_SPOTS.forEach((s, i) => {
    assert.equal(morning[i].length, s.slots, `${s.kind} ${i}`);
    assert.equal(new Set(morning[i]).size, s.slots, "a board repeats a poster");
    for (const art of morning[i]) {
      assert.ok(!art.kinds || art.kinds.includes(s.kind), `${art.id} on a ${s.kind}`);
      if (art.id === "notice-lights-out") assert.equal(s.zone, "hostel");
    }
  });
  const shapes = new Map<string, Set<string>>();
  BANNER_SPOTS.forEach((s, i) => {
    const shape = BANNER_SIZES[s.kind].shape;
    if (!shape) return;
    const set = shapes.get(shape) ?? new Set<string>();
    shapes.set(shape, set);
    for (const art of morning[i]) set.add(art.id);
  });
  for (const [shape, set] of shapes) assert.ok(set.size <= BANNER_FACE_BUDGET[shape as keyof typeof BANNER_FACE_BUDGET], `${shape} uses ${set.size} faces`);
});

test("campaign posters take over most boards and many flex banners", () => {
  const t = day(72);
  const campaign: BannerArt[] = Array.from({ length: 30 }, (_, k) => ({ id: `campaign-test-${k}`, tone: "campaign", title: `Vote Candidate ${k}`, lines: ["For President"], color: 0x1f7a4d, ink: 0xffffff, accent: 0xf2c230, weight: 1 }));
  const picked = assignBanners(BANNER_SPOTS, [...bannerFeed(t), ...campaign], t);
  const share = (kind: string) => {
    const arts = BANNER_SPOTS.flatMap((s, i) => (s.kind === kind ? picked[i] : []));
    return arts.filter((a) => a.tone === "campaign").length / arts.length;
  };
  assert.ok(share("board") > 0.6, `boards ${share("board")}`);
  assert.ok(share("flex") > 0.35 && share("flex") < 0.8, `flex ${share("flex")}`);
});

test("a notice board can be read up close", () => {
  const board = BANNER_SPOTS.find((s) => s.kind === "board");
  assert.ok(board);
  assert.equal(noticeBoardNear(board.x + M, board.y)?.spot.id, board.id);
  assert.equal(noticeBoardNear(board.x + 40 * M, board.y + 40 * M, 2 * M), null);
  const titles = boardNotices(board, day(70));
  assert.ok(titles.length >= 4 && titles.every((x) => x.length > 0));
  assert.deepEqual(titles, boardNotices(board, day(70, 1200)));
});

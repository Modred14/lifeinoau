// lib3d/minimap.js
// The flat 2D map used during a trip: the little map at the top (it turns so you always travel "up"), and the full preview you get by tapping it,
// which shows the whole way like a phone map app does: a thick line when you are driving, a dotted line when you are walking.
// Both draw from one picture of the campus painted once. Browser only (canvas). Coordinates are map metres, x east, z south.

const MPP = 2; // metres per pixel of the painted picture
let cached = null;

/** Paints roads, buildings, water and green areas of the whole campus once (about 1650 x 900 pixels). */
export function paintBase(data, net, graph = null) {
  if (cached && cached.data === data && cached.graph === graph) return cached;
  // the expressway runs well past the campus, so the picture grows to take it in
  const ex = graph?.expressway, pad = 120; let ax0 = net.x0, az0 = net.z0, ax1 = net.x1, az1 = net.z1;
  if (ex) for (const [x, z] of ex.deck) { ax0 = Math.min(ax0, x - pad); ax1 = Math.max(ax1, x + pad); az0 = Math.min(az0, z - pad); az1 = Math.max(az1, z + pad); }
  const x0 = ax0, z0 = az0, w = Math.ceil((ax1 - x0) / MPP), h = Math.ceil((az1 - z0) / MPP), c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), tr = (pts) => { g.beginPath(); pts.forEach((p, i) => { const x = (p[0] - x0) / MPP, y = (p[1] - z0) / MPP; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); };
  const fill = (list, color) => { g.fillStyle = color; for (const a of list ?? []) { tr(a.pts); g.fill(); } };
  g.fillStyle = "#eceee3"; g.fillRect(0, 0, w, h);
  fill(data.areas?.park, "#cfe3bd"); fill(data.areas?.wood, "#bcd8a8"); fill(data.areas?.sports, "#c6e0b4"); fill(data.areas?.pitch, "#b9dfc3"); fill(data.areas?.parking, "#e1e1dc"); fill(data.areas?.water, "#a8d4e8");
  // roads: a grey casing, then white. With the road graph these are the roads as built (straightened, as wide as they drive); without it, the old map polygons
  if (graph) {
    const path = (e) => { g.beginPath(); const P = e.path, n = Math.max(1, Math.ceil(P.len / 6)), a = {}; for (let i = 0; i <= n; i++) { P.at((P.len * i) / n, a); const x = (a.x - x0) / MPP, y = (a.z - z0) / MPP; i ? g.lineTo(x, y) : g.moveTo(x, y); } };
    const roads = [...graph.edges, ...graph.foots].filter((e) => !e.hw && !(e.mask & 4));
    g.lineCap = "round"; g.lineJoin = "round";
    for (const [grow, col] of [[1.4, "#c4c8cf"], [0, "#ffffff"]]) for (const e of roads) { g.strokeStyle = col; g.lineWidth = Math.max(1.2, (e.foot ? 1.6 : (e.half + (e.foot ? 0 : 0.4)) * 2) / MPP + grow); path(e); g.stroke(); }
    if (ex) { for (const [lw, col] of [[(ex.half * 2) / MPP + 3, "#c9a14a"], [(ex.half * 2) / MPP, "#f3d98b"]]) { g.strokeStyle = col; g.lineWidth = lw; g.lineCap = "butt"; g.beginPath(); ex.deck.forEach((p, i) => { const x = (p[0] - x0) / MPP, y = (p[1] - z0) / MPP; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
      g.lineCap = "round"; for (const r of ex.ramps) { g.strokeStyle = "#f3d98b"; g.lineWidth = (r.half * 2) / MPP; g.beginPath(); r.pts.forEach((p, i) => { const x = (p[0] - x0) / MPP, y = (p[1] - z0) / MPP; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); } }
  } else for (const [lw, col] of [[1.6, "#c4c8cf"], [0, "#ffffff"]]) {
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = "round";
    for (const r of data.roads) { g.beginPath(); for (const ring of [r.pts, ...(r.holes ?? [])]) ring.forEach((p, i) => { const x = (p[0] - x0) / MPP, y = (p[1] - z0) / MPP; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); if (lw) g.stroke(); else g.fill("evenodd"); }
  }
  g.fillStyle = "#d8d0bf"; g.strokeStyle = "#b9b09c"; g.lineWidth = 0.6; for (const b of data.buildings) { tr(b.pts); g.fill(); g.stroke(); }
  cached = { data, graph, canvas: c, x0, z0 };
  return cached;
}

const line = (g, pts, toPx, step = 1) => { g.beginPath(); pts.forEach((p, i) => { if (i % step && i !== pts.length - 1) return; const [x, y] = toPx(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); };
/** The route as a map app draws it: driving = thick solid line with a white edge, walking = a dotted line. */
function drawRoute(g, pts, toPx, mode, scale) {
  if (!pts || pts.length < 2) return;
  g.save(); g.lineCap = "round"; g.lineJoin = "round";
  if (mode === "trek") { g.fillStyle = "#1a73e8"; g.strokeStyle = "#fff"; g.lineWidth = 1.5 * scale; for (let i = 0; i < pts.length; i += Math.max(1, Math.round(6))) { const [x, y] = toPx(pts[i][0], pts[i][1]); g.beginPath(); g.arc(x, y, 3.2 * scale, 0, 7); g.fill(); g.stroke(); } }
  else { line(g, pts, toPx, 2); g.strokeStyle = "#ffffff"; g.lineWidth = 9 * scale; g.stroke(); line(g, pts, toPx, 2); g.strokeStyle = "#1a73e8"; g.lineWidth = 6 * scale; g.stroke(); }
  g.restore();
}
function pin(g, x, y, scale) { g.save(); g.translate(x, y); g.fillStyle = "#e5392f"; g.strokeStyle = "#fff"; g.lineWidth = 2 * scale; g.beginPath(); g.arc(0, -13 * scale, 8 * scale, Math.PI * 0.85, Math.PI * 2.15); g.lineTo(0, 0); g.closePath(); g.fill(); g.stroke(); g.fillStyle = "#fff"; g.beginPath(); g.arc(0, -13 * scale, 3 * scale, 0, 7); g.fill(); g.restore(); }
function you(g, x, y, ang, scale) { g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = "rgba(26,115,232,0.2)"; g.beginPath(); g.arc(0, 0, 14 * scale, 0, 7); g.fill(); g.fillStyle = "#1a73e8"; g.strokeStyle = "#fff"; g.lineWidth = 2.2 * scale; g.beginPath(); g.moveTo(0, -10 * scale); g.lineTo(7 * scale, 8 * scale); g.lineTo(0, 4 * scale); g.lineTo(-7 * scale, 8 * scale); g.closePath(); g.fill(); g.stroke(); g.restore(); }

/**
 * The little map: centred on you, turned so your heading is up. `radius` is how many metres from the centre to the edge.
 * st: { x, z, hx, hz, route (Path or null), mode, dest: { x, z } }
 */
export function drawMini(canvas, base, st, radius = 120) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, k = W / 2 / radius * 1; // px per metre
  g.save(); g.clearRect(0, 0, W, H); g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 1, 0, 7); g.clip(); g.fillStyle = "#eceee3"; g.fillRect(0, 0, W, H);
  const phi = Math.atan2(st.hx, -st.hz); g.translate(W / 2, H / 2); g.rotate(-phi);
  const toPx = (x, z) => [(x - st.x) * k, (z - st.z) * k];
  g.save(); g.scale(MPP * k, MPP * k); g.translate(-(st.x - base.x0) / MPP, -(st.z - base.z0) / MPP); g.imageSmoothingEnabled = true; g.drawImage(base.canvas, 0, 0); g.restore();
  drawRoute(g, st.route?.pts, toPx, st.mode, Math.max(0.6, W / 150));
  if (st.dest) { const [x, y] = toPx(st.dest.x, st.dest.z), d = Math.hypot(x, y), lim = W / 2 - 14; // off the edge: the pin sits on the rim, pointing the way
    const px = d > lim ? (x / d) * lim : x, py = d > lim ? (y / d) * lim : y; g.save(); g.rotate(phi); const c = Math.cos(phi), s = Math.sin(phi); pin(g, px * c - py * s, px * s + py * c, Math.max(0.7, W / 170)); g.restore(); }
  g.restore();
  g.save(); g.translate(W / 2, H / 2); you(g, 0, 0, 0, Math.max(0.7, W / 170)); g.restore();
  g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = 3; g.beginPath(); g.arc(W / 2, H / 2, W / 2 - 1.5, 0, 7); g.stroke();
}

/** The full preview: the whole route fitted on screen, north up. st: { x, z, hx, hz, route, mode, dest, from } */
export function drawPreview(canvas, base, st) {
  const g = canvas.getContext("2d"), W = canvas.width, H = canvas.height, pts = st.route?.pts ?? [[st.x, st.z], [st.dest.x, st.dest.z]];
  let ax = Infinity, bx = -Infinity, az = Infinity, bz = -Infinity; for (const p of [...pts, [st.x, st.z], [st.dest.x, st.dest.z]]) { ax = Math.min(ax, p[0]); bx = Math.max(bx, p[0]); az = Math.min(az, p[1]); bz = Math.max(bz, p[1]); }
  const pad = 0.14, mw = Math.max(80, bx - ax), mh = Math.max(80, bz - az), k = Math.min(W / (mw * (1 + pad * 2)), H / (mh * (1 + pad * 2))), cx = (ax + bx) / 2, cz = (az + bz) / 2, toPx = (x, z) => [W / 2 + (x - cx) * k, H / 2 + (z - cz) * k];
  g.save(); g.fillStyle = "#eceee3"; g.fillRect(0, 0, W, H); g.save(); g.translate(W / 2, H / 2); g.scale(MPP * k, MPP * k); g.translate(-(cx - base.x0) / MPP, -(cz - base.z0) / MPP); g.drawImage(base.canvas, 0, 0); g.restore();
  const sc = Math.max(0.8, W / 700); drawRoute(g, st.route?.pts, toPx, st.mode, sc);
  if (st.from) { const [x, y] = toPx(st.from.x, st.from.z); g.fillStyle = "#fff"; g.strokeStyle = "#1a73e8"; g.lineWidth = 3 * sc; g.beginPath(); g.arc(x, y, 6 * sc, 0, 7); g.fill(); g.stroke(); }
  const [dx, dy] = toPx(st.dest.x, st.dest.z); pin(g, dx, dy, sc * 1.3); const [yx, yy] = toPx(st.x, st.z); you(g, yx, yy, Math.atan2(st.hx, -st.hz), sc * 1.1); g.restore();
}
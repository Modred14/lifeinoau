// lib3d/roadalign.js
// The third stage of the road refinement (lib3d/roadrefine.js calls it after straightening, pruning and reshaping): makes the network read as a planned one.
//   hairpins   a road that doubles back on itself (a U, a loop that goes nowhere) becomes the straight link between its ends, or goes when nothing loses its access
//   refit      a road with S-bends in it is re-laid as a few long straight runs joined by gentle arcs (as few runs as the walls allow)
//   square     where a side road meets a through road at a slant, its last stretch swings round to meet it at a right angle, as a road engineer would draw a tee
// Nothing moves a building, and every change is checked: the new line must stay as clear of walls as the old one was (or 4.2 m, which a car needs), must not wander far from the
// road the map shows, must not cross another road, and the caller's `accessOK()` must still say every place can be reached.
// Pure JS. Metres, x east, z south. `sdf(x, z)` = distance to the nearest wall.
const hyp = Math.hypot;
const TAU = Math.PI * 2;
const plen = (P) => { let t = 0; for (let i = 1; i < P.length; i++) t += hyp(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return t; };
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return hyp(px - ax - dx * t, pz - az - dz * t); };
const polyD = (px, pz, P) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(px, pz, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; };
const wrap = (d) => ((d + Math.PI * 3) % TAU) - Math.PI;

/** Turning along a polyline that is NOT the net change of heading: a corner scores 0 (it all goes one way), an S-bend or a loop scores what it wastes (degrees). */
export function excessTurn(P, resample) {
  const q = resample(P, 8); let signed = 0, abs = 0;
  for (let i = 1; i < q.length - 1; i++) { const d = wrap(Math.atan2(q[i + 1][1] - q[i][1], q[i + 1][0] - q[i][0]) - Math.atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0])); signed += d; abs += Math.abs(d); }
  return ((abs - Math.abs(signed)) * 180) / Math.PI;
}

/** Proper crossing of segments (interiors only, a small margin at the ends so a shared junction does not count). */
function crosses(p, p2, q, q2) {
  const rx = p2[0] - p[0], rz = p2[1] - p[1], sx = q2[0] - q[0], sz = q2[1] - q[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return false;
  const t = ((q[0] - p[0]) * sz - (q[1] - p[1]) * sx) / den, u = ((q[0] - p[0]) * rz - (q[1] - p[1]) * rx) / den; return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
}
const polyCrosses = (P, Q) => { for (let i = 0; i < P.length - 1; i++) for (let j = 0; j < Q.length - 1; j++) if (crosses(P[i], P[i + 1], Q[j], Q[j + 1])) return true; return false; };

/**
 * ctx = { sdf, accessOK(), canDrop(edge), rdp, fillet, resample, radius: {class: m}, log }.  `nodes` and `edges` are the refiner's working arrays (edges carry `__off` when dropped).
 * Returns a report of what was done.
 */
export function alignRoads(nodes, edges, ctx, stages = ["hairpins", "refit", "square"]) {
  const { sdf, accessOK, canDrop, rdp, fillet, resample, radius, log = () => {} } = ctx, rep = { hairpins: { replaced: 0, dropped: 0 }, refit: 0, squared: 0, refused: 0 };
  const live = () => edges.filter((e) => !e.__off && !e.hw && !e.fixed);
  const clr = (P) => { if (!sdf) return Infinity; const L = plen(P), q = resample(P, 3), edge = Math.min(10, L * 0.2); let lo = Infinity, s = 0; for (let i = 0; i < q.length; i++) { if (i) s += hyp(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); if (s < edge || s > L - edge) continue; lo = Math.min(lo, sdf(q[i][0], q[i][1])); } return lo; };
  const hausdorff = (A, B) => { let d = 0; for (const q of resample(A, 3)) d = Math.max(d, polyD(q[0], q[1], B)); for (const q of resample(B, 3)) d = Math.max(d, polyD(q[0], q[1], A)); return d; };
  const clearLine = (a, b, min, skip = 6) => { if (!sdf) return true; const d = hyp(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(d / 2)); for (let i = 0; i <= n; i++) { const s = (d * i) / n; if (s < skip || s > d - skip) continue; if (sdf(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n) < min) return false; } return true; };
  const hitsOthers = (e, P) => { for (const o of live()) { if (o === e) continue; if (polyCrosses(P, o.pts)) return true; } return false; };
  const tryKeep = (e, pts) => { const old = e.pts; e.pts = pts; if (accessOK()) return true; e.pts = old; rep.refused++; return false; };

  // ---------------------------------------------------------------- hairpins and loops
  if (stages.includes("hairpins")) for (const e of live()) {
    const L = plen(e.pts), chord = hyp(e.pts.at(-1)[0] - e.pts[0][0], e.pts.at(-1)[1] - e.pts[0][1]);
    if (L < 25 || !(e.a === e.b || (chord / L < 0.5 && excessTurn(e.pts, resample) > 90))) continue;
    // the straight link between its ends, when it is clear and long enough to be a road
    if (e.a !== e.b && chord >= 15 && clearLine(e.pts[0], e.pts.at(-1), 3.4) && !hitsOthers(e, [e.pts[0], e.pts.at(-1)]) && tryKeep(e, [e.pts[0], e.pts.at(-1)])) { rep.hairpins.replaced++; continue; }
    if (canDrop(e)) { e.__off = true; rep.hairpins.dropped++; }
  }

  // ---------------------------------------------------------------- refit wavy roads as a few long straight runs
  const maxDevOf = { local: 28, collector: 20, arterial: 12 };
  if (stages.includes("refit")) for (const e of live()) {
    const L = plen(e.pts); if (L < 40) continue;
    const dense = resample(e.pts, 2), ex0 = excessTurn(dense, resample); if (ex0 < 18) continue;
    const before = clr(dense), maxDev = maxDevOf[e.cls] ?? 20; let best = null; const why = [];
    for (const eps of [5, 8, 12, 17, 24]) {
      const cand = fillet(rdp(dense, eps), radius[e.cls] ?? 32); if (cand.length < 2) continue; const dv = hausdorff(cand, dense); if (dv > maxDev) { why.push(`eps${eps}:dev${dv.toFixed(0)}`); continue; }
      const need = ex0 >= 60 ? Math.min(before, 3.0) - 0.2 : Math.min(before, 4.2) - 0.35;   // a really wavy road may come a little closer to a wall: the cross-section is narrowed to fit
      if (sdf && clr(cand) < need) { why.push(`eps${eps}:clr${clr(cand).toFixed(1)}<${need.toFixed(1)}`); continue; }
      const ex = excessTurn(cand, resample); if (!best || ex < best.ex - 1e-6) best = { pts: cand, ex };
      if (ex <= 12) break;
    }
    if (best && best.ex < ex0 - 10 && !hitsOthers(e, best.pts) && tryKeep(e, best.pts)) rep.refit++;
    else if (process.env.DBGALIGN) console.error(`refit edge ${e.id} ${e.cls} L${Math.round(L)} ex${Math.round(ex0)} before${before.toFixed(1)} best=${best ? Math.round(best.ex) : "none"} :: ${why.join(" ")}`);
  }

  // ---------------------------------------------------------------- square the tees
  const unitAt = (P, s) => { let acc = 0; for (let i = 0; i < P.length - 1; i++) { const d = hyp(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); if (acc + d >= s || i === P.length - 2) { const t = Math.min(1, Math.max(0, (s - acc) / (d || 1))); return { x: P[i][0] + (P[i + 1][0] - P[i][0]) * t, z: P[i][1] + (P[i + 1][1] - P[i][1]) * t, i }; } acc += d; } return { x: P.at(-1)[0], z: P.at(-1)[1], i: P.length - 2 }; };
  const outward = (e, n) => (e.a === n.id ? e.pts : [...e.pts].reverse());   // the road's points from the node outwards
  const dirOf = (P) => { const a = unitAt(P, Math.min(12, plen(P) * 0.4)), l = hyp(a.x - P[0][0], a.z - P[0][1]) || 1; return [(a.x - P[0][0]) / l, (a.z - P[0][1]) / l]; };
  if (stages.includes("square")) for (const n of nodes) {
    if (n.rim) continue; const arms = live().filter((e) => (e.a === n.id) !== (e.b === n.id)).map((e) => { const P = outward(e, n); return { e, P, d: dirOf(P), L: plen(P) }; });
    if (arms.length < 3 || live().some((e) => e.a === n.id && e.b === n.id)) continue;
    // the through road: the pair of arms closest to a straight line (at least 155 degrees apart), the longer ones if several
    let through = null; for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) { const c = arms[i].d[0] * arms[j].d[0] + arms[i].d[1] * arms[j].d[1]; if (c < -0.906 && (!through || c - 0.0001 * (arms[i].L + arms[j].L) < through.c)) through = { i, j, c: c - 0.0001 * (arms[i].L + arms[j].L) }; }
    if (!through) continue;
    let tx = arms[through.j].d[0] - arms[through.i].d[0], tz = arms[through.j].d[1] - arms[through.i].d[1]; const tl = hyp(tx, tz) || 1; tx /= tl; tz /= tl;
    for (let k = 0; k < arms.length; k++) {
      if (k === through.i || k === through.j) continue; const arm = arms[k], along = arm.d[0] * tx + arm.d[1] * tz, phi = (Math.acos(Math.min(1, Math.abs(along))) * 180) / Math.PI;   // 90 = square on
      if (Math.abs(phi - 90) < 9 || Math.abs(phi - 90) > 62 || arm.L < 36) continue;
      const side = Math.sign(arm.d[0] * -tz + arm.d[1] * tx) || 1, ux = -tz * side, uz = tx * side;       // the perpendicular, on the side the road is on
      const before = clr(resample(arm.P, 2)); let done = false;
      for (const K of [28, 20, 13]) {
        if (K > arm.L * 0.5) continue;
        const join = unitAt(arm.P, Math.min(arm.L - 1, K + 14)), rest = arm.P.slice(join.i + 1);
        const cand = fillet([arm.P[0], [n.x + ux * K, n.z + uz * K], [join.x, join.z], ...rest], Math.max(12, (radius[arm.e.cls] ?? 32) * 0.6)); if (hausdorff(cand.slice(0, Math.ceil(cand.length / 2)), arm.P) > 24) continue;
        if (sdf && clr(cand) < Math.min(before, 4.2) - 0.35) continue;
        const sd = (P) => { let lo = Infinity; for (const q of resample(P, 3)) { if (hyp(q[0] - n.x, q[1] - n.z) > K + 24) break; if (hyp(q[0] - n.x, q[1] - n.z) < 6) continue; lo = Math.min(lo, sdf ? sdf(q[0], q[1]) : Infinity); } return lo; };
        if (sdf && sd(cand) < Math.min(sd(arm.P), 4.2) - 0.35) continue;
        const stored = arm.e.a === n.id ? cand : [...cand].reverse(); if (hitsOthers(arm.e, stored)) continue;
        if (tryKeep(arm.e, stored)) { rep.squared++; arm.P = cand; done = true; break; }
      }
      void done;
    }
  }
  log(`align: ${JSON.stringify(rep)}`);
  return rep;
}
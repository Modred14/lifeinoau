// lib3d/roadshape.js
// The second half of the road refinement (lib3d/roadrefine.js runs it after straightening and pruning): turns what is left into a network of long, straight, connected roads.
//   contract   short links between junctions (roundabouts, the little rings and triangles the map has at big junctions) become one plain crossing
//   merge      a road that is cut in two by a pointless node (two roads meeting end to end at a shallow angle) becomes one long road, straightened again
//   extend     a dead end is carried straight on until it meets another road or leaves the map, so no road stops in the middle of nowhere; if that is blocked
//              it is joined to the nearest road it can reach in a clear straight line; if that is blocked too the stub is dropped (when nothing loses its access)
//   cross      two roads that cross get a junction where they cross
// Pure JS. Metres, x east, z south. `sdf(x, z)` = distance to the nearest wall; `bounds` = { x0, x1, z0, z1 } of the map.
const hyp = Math.hypot;
const plen = (P) => { let t = 0; for (let i = 1; i < P.length; i++) t += hyp(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return t; };
const resample6 = (P) => { const out = []; for (let i = 0; i < P.length - 1; i++) { const d = hyp(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]), n = Math.max(1, Math.ceil(d / 6)); for (let k = 0; k < n; k++) out.push([P[i][0] + ((P[i + 1][0] - P[i][0]) * k) / n, P[i][1] + ((P[i + 1][1] - P[i][1]) * k) / n]); } out.push(P.at(-1)); return out; };
const polyDist = (q, P) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l2 = dx * dx + dz * dz || 1; let t = ((q[0] - P[i][0]) * dx + (q[1] - P[i][1]) * dz) / l2; t = Math.max(0, Math.min(1, t)); d = Math.min(d, hyp(q[0] - P[i][0] - dx * t, q[1] - P[i][1] - dz * t)); } return d; };
const RANK = { local: 0, collector: 1, arterial: 2 };
const higher = (a, b) => ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b);

/** Proper intersection of segments p-p2 and q-q2: { x, z, t, u } (t along p, u along q) or null. Touching at an end counts only inside `eps`. */
function segCross(p, p2, q, q2, eps = 1e-6) {
  const rx = p2[0] - p[0], rz = p2[1] - p[1], sx = q2[0] - q[0], sz = q2[1] - q[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return null;
  const t = ((q[0] - p[0]) * sz - (q[1] - p[1]) * sx) / den, u = ((q[0] - p[0]) * rz - (q[1] - p[1]) * rx) / den;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null; return { x: p[0] + rx * t, z: p[1] + rz * t, t, u };
}
const clearLine = (sdf, a, b, min, skip = 0) => { if (!sdf) return true; const d = hyp(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(d / 2.5)); for (let i = 0; i <= n; i++) { const s = (d * i) / n; if (s < skip || s > d - skip) continue; if (sdf(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n) < min) return false; } return true; };

export function reshapeNetwork(nodes, edges, { sdf = null, bounds = null, straighten = null, canDrop = () => true, keepsAccess = () => true, log = () => {}, stage = () => {} } = {}) {
  const report = { contracted: 0, merged: 0, extended: [], connected: [], dropped: [], crossings: 0 };
  let nextId = Math.max(...edges.map((e) => e.id)) + 1;
  const live = () => edges.filter((e) => !e.__off);
  // an operation that moves roads is undone when it takes a place further from its road than the place was allowed to be
  const snap = () => ({ n: nodes.map((q) => ({ ...q })), e: edges.map((q) => ({ ...q, pts: q.pts.map((p) => p.slice()) })) });
  const restore = (sn) => { nodes.length = 0; for (const q of sn.n) nodes.push({ ...q }); edges.length = 0; for (const q of sn.e) edges.push({ ...q, pts: q.pts.map((p) => p.slice()) }); };
  // the lowest clearance to a wall along an edge, leaving out its two ends (which are junctions)
  const edgeClr = (e) => { if (!sdf) return Infinity; const L = plen(e.pts), edge = Math.min(10, L * 0.2); let lo = Infinity, run = 0; for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i], d = hyp(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 3)); for (let k = 0; k <= n; k++) { const s = run + (d * k) / n; if (s < edge || s > L - edge) continue; lo = Math.min(lo, sdf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)); } run += d; } return lo; };
  const clrOf = (ids) => new Map(live().filter((e) => ids.includes(e.a) || ids.includes(e.b)).map((e) => [e.id, edgeClr(e)]));
  const refused = new Set();   // edges (by id) whose contraction or merge was undone
  const deg = () => { const d = new Map(); for (const e of live()) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); } return d; };
  const newNode = (x, z, rim = false) => { const n = { id: nodes.length, x, z, rim, comp: 0 }; nodes.push(n); return n.id; };
  const snapNode = (x, z, tol = 6) => { let best = null; const d = deg(); for (const n of nodes) { if (!d.get(n.id)) continue; const q = hyp(n.x - x, n.z - z); if (q < tol && (!best || q < best.q)) best = { q, id: n.id }; } return best?.id ?? null; };

  /** Splits edge e at point (x, z), which lies on its segment i: returns the node there (an existing end node when it is within a few metres). */
  function splitAt(e, i, x, z) {
    const na = nodes[e.a], nb = nodes[e.b];
    if (hyp(x - na.x, z - na.z) < 5) return e.a; if (hyp(x - nb.x, z - nb.z) < 5) return e.b;
    const id = newNode(x, z), tail = { ...e, id: nextId++, a: id, pts: [[x, z], ...e.pts.slice(i + 1)] }; delete tail.__off;
    e.pts = [...e.pts.slice(0, i + 1), [x, z]]; e.b = id; edges.push(tail); return id;
  }
  const setEnd = (e, which, n) => { if (which === "a") { e.a = n; e.pts[0] = [nodes[n].x, nodes[n].z]; } else { e.b = n; e.pts[e.pts.length - 1] = [nodes[n].x, nodes[n].z]; } };

  // length of the shortest way from node a to node b that does not use edge `skip` (Infinity when there is none)
  const shortest = (a, b, skip) => {
    const dist = new Map([[a, 0]]), todo = [a], L = live().filter((e) => e !== skip);
    while (todo.length) { todo.sort((p, q) => dist.get(q) - dist.get(p)); const u = todo.pop(), du = dist.get(u); if (u === b) return du; if (du > 600) break;
      for (const e of L) { const v = e.a === u ? e.b : e.b === u ? e.a : -1; if (v < 0) continue; const nd = du + plen(e.pts); if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); todo.push(v); } } }
    return Infinity;
  };
  if (process.env.DBGA) console.error("INITIAL ok?", keepsAccess());
  // two roads between the same two junctions that run side by side are one road (the longer goes); three or more between the same two junctions are never right
  const dedupe = () => {
    for (const e of live()) if (e.a === e.b && canDrop(e)) { e.__off = true; report.dropped.push({ edge: e.id, len: Math.round(plen(e.pts)), why: "loop" }); }   // a road that leaves a junction and comes back to it goes nowhere
    for (let guard = 0; guard < 60; guard++) {
      const groups = new Map(); for (const e of live()) { if (e.a === e.b) continue; const k = Math.min(e.a, e.b) + "-" + Math.max(e.a, e.b); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
      let done = false;
      for (const list of groups.values()) {
        if (list.length < 2) continue; list.sort((p, q) => plen(q.pts) - plen(p.pts));
        for (const e of list) { const others = list.filter((o) => o !== e && !o.__off); if (!others.length) continue; let dev = Infinity; for (const o of others) { let d = 0; for (const q of resample6(e.pts)) d = Math.max(d, polyDist(q, o.pts)); dev = Math.min(dev, d); }
          if ((dev < 14 || list.length >= 3) && canDrop(e)) { e.__off = true; report.dropped.push({ edge: e.id, len: Math.round(plen(e.pts)), why: "parallel" }); done = true; break; } }
        if (done) break;
      }
      if (!done) break;
    }
  };
  dedupe();
  // ---------------------------------------------------------------- contract
  const contractPass = (micro) => {
  for (let guard = 0; guard < 200; guard++) {
    const d = deg(); let best = null;
    for (const e of live()) { if (e.a === e.b) continue; if (Math.max(d.get(e.a) ?? 0, d.get(e.b) ?? 0) < 3 || nodes[e.a].rim || nodes[e.b].rim) continue; const L = plen(e.pts); if (refused.has(e.id)) continue; if (L < (micro ? 22 : 70) && (!best || L < best.L)) best = { e, L }; }
    // a short link that is one side of a small ring (a roundabout, a triangle of road round nothing) goes too
    if (!best) for (const e of live()) { if (e.a === e.b || Math.max(d.get(e.a) ?? 0, d.get(e.b) ?? 0) < 3 || nodes[e.a].rim || nodes[e.b].rim) continue; const L = plen(e.pts); if (micro || refused.has(e.id) || L >= 150 || (best && L >= best.L)) continue; const back = shortest(e.a, e.b, e); if (back + L < 560) best = { e, L }; }
    if (!best) break; const sn = snap(), eid = best.e.id, before = clrOf([best.e.a, best.e.b]); const { e } = best, a = nodes[e.a], b = nodes[e.b], mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, at = !sdf || sdf(mx, mz) >= 2.5 ? [mx, mz] : [a.x, a.z];
    e.__off = true; a.x = at[0]; a.z = at[1];
    for (const o of live()) { if (o.a === b.id) setEnd(o, "a", a.id); if (o.b === b.id) setEnd(o, "b", a.id); if (o.a === a.id) o.pts[0] = [a.x, a.z]; if (o.b === a.id) o.pts[o.pts.length - 1] = [a.x, a.z]; }
    // the ring pieces that were between the two now run from the new junction to itself or twice to the same neighbour: a loop goes, a double road becomes one
    for (const o of live()) if (o.a === o.b && o.a === a.id && plen(o.pts) < 160) o.__off = true;
    const seen = new Map(); for (const o of live()) { if (o.a === o.b || (o.a !== a.id && o.b !== a.id)) continue; const k = Math.min(o.a, o.b) + "-" + Math.max(o.a, o.b), t = seen.get(k); if (!t) { seen.set(k, o); continue; } let dev = 0; for (const q of resample6(o.pts)) dev = Math.max(dev, polyDist(q, t.pts)); if (dev > 14) continue;   // two different roads between the same junctions both stay
    const drop = plen(o.pts) > plen(t.pts) ? o : t; drop.__off = true; seen.set(k, drop === o ? t : o); }
    const hurt = [...clrOf([a.id]).entries()].some(([id, c]) => c < Math.min(2.2, before.get(id) ?? 99) - 0.2);   // a road dragged into a wall
    if (process.env.DBGR && Math.hypot(a.x + 8, a.z - 118) < 30) console.error('CONTRACT near senate', eid, 'hurt', hurt, 'access', hurt ? '-' : keepsAccess());
    if (hurt || !keepsAccess()) { restore(sn); refused.add(eid); if (process.env.DBGA) console.error("after restore ok?", keepsAccess(), "edge", eid); continue; }
    report.contracted++;
  }

  if (process.env.DBGC) report.__t1 = 1;
  };
  contractPass(false);
  stage("contracted");
  // ---------------------------------------------------------------- merge
  for (let guard = 0; guard < 200; guard++) {
    const d = deg(); let done = false;
    for (const n of nodes) {
      if (n.rim || d.get(n.id) !== 2) continue; const inc = live().filter((e) => e.a === n.id || e.b === n.id); if (inc.length !== 2 || inc[0] === inc[1] || inc[0].a === inc[0].b || inc[1].a === inc[1].b) continue;
      const [p, q] = inc, P = p.b === n.id ? p.pts : [...p.pts].reverse(), Q = q.a === n.id ? q.pts : [...q.pts].reverse(), from = p.b === n.id ? p.a : p.b, to = q.a === n.id ? q.b : q.a; if (from === to) continue;
      const u = [P.at(-1)[0] - P.at(-4 < -P.length ? 0 : -4)[0], P.at(-1)[1] - P.at(-4 < -P.length ? 0 : -4)[1]], v = [Q[Math.min(3, Q.length - 1)][0] - Q[0][0], Q[Math.min(3, Q.length - 1)][1] - Q[0][1]];
      const cos = (u[0] * v[0] + u[1] * v[1]) / ((hyp(...u) * hyp(...v)) || 1);
      // two roads that meet at a sharp point with nothing else there (a V) is not a junction anyone can drive through: the longer arm goes
      if (cos < -0.5 && !p.__v) { p.__v = q.__v = true; const gone = plen(p.pts) >= plen(q.pts) ? p : q; if (canDrop(gone)) { gone.__off = true; report.dropped.push({ edge: gone.id, len: Math.round(plen(gone.pts)), why: "V" }); done = true; break; } continue; }
      if (cos < Math.cos((50 * Math.PI) / 180)) continue;       // a real corner stays a node
      const cls = higher(p.cls, q.cls); let pts = [...P, ...Q.slice(1)]; if (refused.has(p.id + "+" + q.id)) continue; const sn = snap();
      if (straighten) { const s = straighten(pts, cls); if (s) pts = s; }
      p.__off = q.__off = true; edges.push({ ...p, id: nextId++, a: from, b: to, pts, cls, w: Math.max(p.w, q.w), clr: Math.min(p.clr ?? 99, q.clr ?? 99), __off: false }); if (!keepsAccess()) { restore(sn); refused.add(p.id + "+" + q.id); done = true; break; } report.merged++; done = true; break;
    }
    if (!done) break;
  }

  stage("merged");
  // ---------------------------------------------------------------- extend dead ends
  const hit = (from, dir, maxD, ownEdge, clearance) => {
    // march along a ray: stop at the first road it meets, at the map edge, or at a wall
    let prev = from; const step = 2.5;
    for (let s = step; s <= maxD; s += step) {
      const cur = [from[0] + dir[0] * s, from[1] + dir[1] * s];
      if (bounds && (cur[0] < bounds.x0 || cur[0] > bounds.x1 || cur[1] < bounds.z0 || cur[1] > bounds.z1)) { const c = [Math.min(bounds.x1, Math.max(bounds.x0, cur[0])), Math.min(bounds.z1, Math.max(bounds.z0, cur[1]))]; return { rim: true, x: c[0], z: c[1], s }; }
      if (sdf && sdf(cur[0], cur[1]) < clearance) return { blocked: true, s };
      if (s > 8) for (const e of live()) { if (e === ownEdge) continue; for (let i = 0; i < e.pts.length - 1; i++) { const c = segCross(prev, cur, e.pts[i], e.pts[i + 1]); if (c) return { e, i, x: c.x, z: c.z, s: s - step + c.t * step }; } }
      prev = cur;
    }
    return { blocked: true, s: maxD };
  };
  for (let pass = 0; pass < 3; pass++) {
    const d = deg(); let any = false;
    for (const n of nodes) {
      if (n.rim || d.get(n.id) !== 1) continue; const e = live().find((x) => x.a === n.id || x.b === n.id); if (!e || e.a === e.b) continue;
      const P = e.a === n.id ? [...e.pts].reverse() : e.pts, back = P[Math.max(0, P.length - 1 - 3)], dx = n.x - back[0], dz = n.z - back[1], l = hyp(dx, dz) || 1, dir = [dx / l, dz / l];
      const clr = e.cls === "local" ? 3.6 : 4.4; let made = null;
      const r = hit([n.x, n.z], dir, 900, e, clr);
      if (r.e) { const target = splitAt(r.e, r.i, r.x, r.z); if (target !== n.id) { edges.push({ id: nextId++, a: n.id, b: target, pts: [[n.x, n.z], [nodes[target].x, nodes[target].z]], w: e.w, clr: e.clr, comp: 0, cls: e.cls, __off: false }); made = { how: "straight", len: Math.round(r.s) }; } }
      else if (r.rim) { const t = newNode(r.x, r.z, true); edges.push({ id: nextId++, a: n.id, b: t, pts: [[n.x, n.z], [r.x, r.z]], w: e.w, clr: e.clr, comp: 0, cls: e.cls, __off: false }); made = { how: "to the map edge", len: Math.round(r.s) }; }
      else {
        // blocked: the nearest road reachable in a clear straight line, not far off the way the road was heading
        let best = null;
        for (const o of live()) { if (o === e) continue; const Lo = plen(o.pts); let acc = 0; for (let i = 0; i < o.pts.length - 1; i++) { const A = o.pts[i], B = o.pts[i + 1], sl = hyp(B[0] - A[0], B[1] - A[1]); for (let s = 0; s < sl; s += 8) { const x = A[0] + ((B[0] - A[0]) * s) / sl, z = A[1] + ((B[1] - A[1]) * s) / sl, dd = hyp(x - n.x, z - n.z); if (dd < 12 || dd > (pass ? 700 : 420)) continue; const ang = Math.acos(Math.max(-1, Math.min(1, ((x - n.x) * dir[0] + (z - n.z) * dir[1]) / dd))); if (ang > (pass ? 3.0 : 2.2)) continue; const score = dd * (1 + ang * 0.6); if (best && score >= best.score) continue; if (!clearLine(sdf, [n.x, n.z], [x, z], pass ? 1.6 : clr, 3)) continue; best = { score, o, i, x, z, dd }; } acc += sl; } void Lo; void acc; }
        if (best) { const target = splitAt(best.o, best.i, best.x, best.z); if (target !== n.id) { edges.push({ id: nextId++, a: n.id, b: target, pts: [[n.x, n.z], [nodes[target].x, nodes[target].z]], w: e.w, clr: e.clr, comp: 0, cls: e.cls, __off: false }); made = { how: "to the nearest road", len: Math.round(best.dd) }; } }
      }
      if (!made) {   // a second try with less room to spare, and a longer reach
        const r2 = hit([n.x, n.z], dir, 900, e, 2.4);
        if (r2.e) { const target = splitAt(r2.e, r2.i, r2.x, r2.z); if (target !== n.id) { edges.push({ id: nextId++, a: n.id, b: target, pts: [[n.x, n.z], [nodes[target].x, nodes[target].z]], w: e.w, clr: e.clr, comp: 0, cls: e.cls, __off: false }); made = { how: "straight", len: Math.round(r2.s) }; } }
        else if (r2.rim) { const t = newNode(r2.x, r2.z, true); edges.push({ id: nextId++, a: n.id, b: t, pts: [[n.x, n.z], [r2.x, r2.z]], w: e.w, clr: e.clr, comp: 0, cls: e.cls, __off: false }); made = { how: "to the map edge", len: Math.round(r2.s) }; }
      }
      if (made) { report[made.how === "to the nearest road" ? "connected" : "extended"].push({ node: n.id, ...made }); any = true; }
      else if (canDrop(e)) { e.__off = true; report.dropped.push({ edge: e.id, len: Math.round(plen(e.pts)) }); any = true; }
    }
    if (!any) break;
  }

  stage("extended");
  // ---------------------------------------------------------------- cross
  for (let guard = 0; guard < 40; guard++) {
    let found = null; const L = live();
    outer: for (let x = 0; x < L.length; x++) for (let y = x + 1; y < L.length; y++) {
      const p = L[x], q = L[y]; for (let i = 0; i < p.pts.length - 1; i++) for (let j = 0; j < q.pts.length - 1; j++) {
        const c = segCross(p.pts[i], p.pts[i + 1], q.pts[j], q.pts[j + 1]); if (!c) continue;
        const near = [p.a, p.b].some((n) => [q.a, q.b].includes(n) && hyp(nodes[n].x - c.x, nodes[n].z - c.z) < 3); if (near) continue;
        found = { p, q, i, j, c }; break outer;
      }
    }
    if (!found) break; const { p, q, i, j, c } = found, m = splitAt(p, i, c.x, c.z);
    // the second road is split at the same node (its segment index may have moved if it was p's tail, so find it again)
    const q2 = q; const jj = q2.pts.findIndex((_, k) => k < q2.pts.length - 1 && segCross([c.x - 0.01, c.z - 0.01], [c.x + 0.01, c.z + 0.01], q2.pts[k], q2.pts[k + 1], 5) !== null); void jj;
    const na = nodes[m]; const tail = { ...q, id: nextId++, a: m, pts: [[na.x, na.z], ...q.pts.slice(j + 1)] }; delete tail.__off; q.pts = [...q.pts.slice(0, j + 1), [na.x, na.z]]; q.b = m; edges.push(tail); report.crossings++;
  }
  // the crossings can leave a knot of tiny links (several roads crossing within a few metres): they are one junction
  dedupe(); refused.clear(); contractPass(true); dedupe(); stage("cleaned");
  return report;
}

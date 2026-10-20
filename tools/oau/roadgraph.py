# tools/oau/roadgraph.py
"""Turns the road POLYGONS of the campus map into a road GRAPH: centrelines, junctions, and how wide each road really is.

    node tools/oau/dump-merged.mjs /tmp/oau-merged.json
    python3 tools/oau/roadgraph.py /tmp/oau-merged.json public/data/oau-roadgraph.json [--debug out.png]
    needs: numpy, scipy, scikit-image   (offline tool only: the game itself loads the JSON this writes)

Why: the map only has road *areas*. Most are 4 m wide (too narrow for two lanes) and nothing says where the middle of a road is, which way it runs
or where it joins another. The game needs that for lanes, junctions, traffic, parking spots and sidewalks. So:
  1. rasterise the road polygons at 1 m (buildings and water cut out),
  2. thin them to a one-pixel skeleton (the centrelines),
  3. trace the skeleton into nodes (junctions, dead ends) and edges (polylines),
  4. prune the little whiskers a thinning always leaves, and merge junctions that are really one,
  5. measure, per edge, the width of the original road and the free space to the nearest building/water.
Everything is metres in the map's own grid (x east, z south). Output is deterministic.
"""
import json, sys, math, hashlib
import numpy as np
from scipy import ndimage as ndi
from skimage.morphology import skeletonize
from skimage.draw import polygon as fill_poly

RES = 1.0          # raster cell, metres
SIMPLIFY = 1.1     # Douglas-Peucker tolerance, metres
MIN_COMPONENT_M = 60.0   # a piece of road shorter than this (in total) is dropped
SPUR_MIN = 9.0     # dead-end branches shorter than max(this, 2 x local half width) are whiskers
RIM = 25.0         # a dead end this close to the edge of the map is a road leaving the map, not a cul-de-sac


def rdp(pts, eps):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); ab = b - a; L = np.hypot(*ab)
    P = np.array(pts[1:-1])
    d = np.hypot(*(P - a).T) if L < 1e-9 else np.abs(ab[0] * (P[:, 1] - a[1]) - ab[1] * (P[:, 0] - a[0])) / L
    i = int(np.argmax(d))
    if d[i] <= eps: return [pts[0], pts[-1]]
    l = rdp(pts[:i + 2], eps); r = rdp(pts[i + 1:], eps); return l[:-1] + r


def chaikin(pts, rounds=2):
    for _ in range(rounds):
        if len(pts) < 3: break
        out = [pts[0]]
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            out += [(a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25), (a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75)]
        out.append(pts[-1]); pts = out
    return pts


def build(d, log=print):
    b = d['bounds']
    x0 = math.floor(b['x0'] - 40); z0 = math.floor(b['z0'] - 40); x1 = math.ceil(b['x1'] + 40); z1 = math.ceil(b['z1'] + 40)
    for bd in d['buildings']:
        for p in bd['pts']: x0 = min(x0, math.floor(p[0] - 10)); x1 = max(x1, math.ceil(p[0] + 10)); z0 = min(z0, math.floor(p[1] - 10)); z1 = max(z1, math.ceil(p[1] + 10))
    nx = int((x1 - x0) / RES); nz = int((z1 - z0) / RES)
    def ring(pts):
        a = np.array(pts); return fill_poly((a[:, 1] - z0) / RES, (a[:, 0] - x0) / RES, (nz, nx))
    road = np.zeros((nz, nx), bool)
    for r in d['roads']:
        m = np.zeros((nz, nx), bool); rr, cc = ring(r['pts']); m[rr, cc] = True
        for h in r.get('holes', []):
            rr, cc = ring(h); m[rr, cc] = False
        road |= m
    solid = np.zeros((nz, nx), bool)
    for bd in d['buildings']:
        rr, cc = ring(bd['pts']); solid[rr, cc] = True
    for w in d.get('water', []):
        rr, cc = ring(w['pts']); solid[rr, cc] = True
        for h in w.get('holes', []): rr, cc = ring(h); solid[rr, cc] = False
    road &= ~solid
    road = ndi.binary_closing(road, np.ones((3, 3), bool))
    # fill only tiny pinholes (under 40 m2); real islands (grass inside a loop of road) stay holes
    holes = ndi.label(~road)[0]; sizes = np.bincount(holes.ravel())
    keep_hole = np.zeros(len(sizes), bool); keep_hole[1:] = sizes[1:] < 40
    road |= keep_hole[holes] & (holes > 0) & ~solid
    lab, n = ndi.label(road, np.ones((3, 3)))
    cnt = np.bincount(lab.ravel()); small = np.where(cnt < 120)[0]; road[np.isin(lab, small[small > 0])] = False
    log('road cells', int(road.sum()), 'grid', nx, nz)

    D = ndi.distance_transform_edt(road)                      # distance (m) to the nearest non-road cell: ~ half width
    clear = ndi.distance_transform_edt(~solid)                # distance to the nearest building / water
    sk = skeletonize(road)
    log('skeleton px', int(sk.sum()))

    # ---- pixel graph ----
    H, W = sk.shape; ys, xs = np.nonzero(sk); P = len(ys)
    idx = -np.ones(sk.shape, np.int64); idx[ys, xs] = np.arange(P)
    adj = [set() for _ in range(P)]
    for k in range(P):
        y, x = ys[k], xs[k]
        for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and idx[yy, xx] >= 0: adj[k].add(int(idx[yy, xx]))
    # a stair-step makes a triangle (a diagonal link beside two straight ones): drop the diagonal so a plain line has degree 2
    for k in range(P):
        for q in list(adj[k]):
            if abs(ys[k] - ys[q]) == 1 and abs(xs[k] - xs[q]) == 1 and any(r in adj[q] and (ys[r] == ys[k] or xs[r] == xs[k]) for r in adj[k] if r != q):
                adj[k].discard(q); adj[q].discard(k)
    deg = np.array([len(a_) for a_ in adj]); special = [k for k in range(P) if deg[k] != 2]
    cluster = {}   # pixels of degree 3+ that touch each other are one junction
    def cl_find(k):
        while cluster.get(k, k) != k: cluster[k] = cluster.get(cluster[k], cluster[k]); k = cluster[k]
        return k
    for k in special:
        cluster.setdefault(k, k)
        if deg[k] >= 3:
            for q in adj[k]:
                if deg[q] >= 3: cluster.setdefault(q, q); cluster[cl_find(q)] = cl_find(k)
    nid_of = {}; members = {}
    for k in special:
        r = cl_find(k); nid_of[k] = nid_of.setdefault(r, len(nid_of)); members.setdefault(nid_of[k], []).append(k)
    seen = np.zeros(P, bool); raw = []; direct = set()
    for k in special:
        for q in adj[k]:
            if q in nid_of and nid_of[q] == nid_of[k]: continue
            if q in nid_of:        # two nodes side by side with no pixel between
                key = tuple(sorted((k, q)))
                if key not in direct: direct.add(key); raw.append((nid_of[k], nid_of[q], [k, q]))
                continue
            if seen[q]: continue
            path = [k]; prev, cur = k, q
            while cur not in nid_of and not seen[cur]:
                seen[cur] = True; path.append(cur); nxt = [r for r in adj[cur] if r != prev]
                if not nxt: break
                prev, cur = cur, nxt[0]
            if cur in nid_of: path.append(cur); raw.append((nid_of[k], nid_of[cur], path))
    for k in range(P):     # rings with no junction at all
        if not seen[k] and k not in nid_of and len(adj[k]) == 2:
            nid = len(members); members[nid] = [k]; nid_of[k] = nid; path = [k]; prev, cur = k, next(iter(adj[k])); seen[k] = True
            while cur != k and not seen[cur]: seen[cur] = True; path.append(cur); nxt = [r for r in adj[cur] if r != prev]; prev, cur = cur, nxt[0]
            path.append(k); raw.append((nid, nid, path))
    log('raw nodes', len(members), 'raw edges', len(raw))

    # ---- nodes and edges in metres ----
    N = {}
    for nid, ms in members.items():
        N[nid] = {'x': float(np.mean([xs[k] for k in ms]) + 0.5) * RES + x0, 'z': float(np.mean([ys[k] for k in ms]) + 0.5) * RES + z0, 'r': float(max(D[ys[k], xs[k]] for k in ms))}
    def mk(a, bb, path):
        pts = [((xs[k] + 0.5) * RES + x0, (ys[k] + 0.5) * RES + z0) for k in path]
        pts[0] = (N[a]['x'], N[a]['z']); pts[-1] = (N[bb]['x'], N[bb]['z'])
        return {'a': a, 'b': bb, 'pts': pts, 'd': [float(D[ys[k], xs[k]]) for k in path], 'c': [float(clear[ys[k], xs[k]]) for k in path]}
    E = [mk(a, bb, p) for a, bb, p in raw]
    def elen(e): return sum(math.hypot(e['pts'][i + 1][0] - e['pts'][i][0], e['pts'][i + 1][1] - e['pts'][i][1]) for i in range(len(e['pts']) - 1))
    def near_rim(n): return (n['x'] < b['x0'] + RIM or n['x'] > b['x1'] - RIM or n['z'] < b['z0'] + RIM or n['z'] > b['z1'] - RIM)

    def degrees():
        dg = {}
        for e in E: dg[e['a']] = dg.get(e['a'], 0) + 1; dg[e['b']] = dg.get(e['b'], 0) + 1
        return dg
    def contract():   # one junction drawn as several close ones: merge them (union-find, one pass)
        par = {n: n for n in N}
        def f(n):
            while par[n] != n: par[n] = par[par[n]]; n = par[n]
            return n
        dg = degrees(); moved = False
        for e in sorted(E, key=elen):
            if e['a'] == e['b'] or dg[e['a']] < 3 or dg[e['b']] < 3: continue
            ra, rb = f(e['a']), f(e['b'])
            if ra == rb: continue
            if elen(e) < max(5.0, 1.2 * max(N[e['a']]['r'], N[e['b']]['r']) + 1.5): par[ra] = rb; moved = True
        if not moved: return False
        groups = {}
        for n in N: groups.setdefault(f(n), []).append(n)
        for root, ms in groups.items():
            if len(ms) > 1:
                N[root] = {'x': sum(N[m]['x'] for m in ms) / len(ms), 'z': sum(N[m]['z'] for m in ms) / len(ms), 'r': max(N[m]['r'] for m in ms)}
        for e in E:
            e['a'], e['b'] = f(e['a']), f(e['b']); e['pts'][0] = (N[e['a']]['x'], N[e['a']]['z']); e['pts'][-1] = (N[e['b']]['x'], N[e['b']]['z'])
        E[:] = [e for e in E if not (e['a'] == e['b'] and elen(e) < 10)]
        for n in [n for n in N if n not in {e['a'] for e in E} | {e['b'] for e in E}]: del N[n]
        return True
    def merge2():     # a node with exactly two roads through it is just a bend: join them
        changed = False
        while True:
            inc = {}
            for i, e in enumerate(E): inc.setdefault(e['a'], []).append(i); inc.setdefault(e['b'], []).append(i)
            hit = next((n for n, l in inc.items() if len(l) == 2 and l[0] != l[1] and E[l[0]]['a'] != E[l[0]]['b'] and E[l[1]]['a'] != E[l[1]]['b']), None)
            if hit is None: return changed
            i, j = inc[hit]; e1, e2 = E[i], E[j]
            if e1['b'] != hit: e1 = {'a': e1['b'], 'b': e1['a'], 'pts': e1['pts'][::-1], 'd': e1['d'][::-1], 'c': e1['c'][::-1]}
            if e2['a'] != hit: e2 = {'a': e2['b'], 'b': e2['a'], 'pts': e2['pts'][::-1], 'd': e2['d'][::-1], 'c': e2['c'][::-1]}
            m = {'a': e1['a'], 'b': e2['b'], 'pts': e1['pts'] + e2['pts'][1:], 'd': e1['d'] + e2['d'][1:], 'c': e1['c'] + e2['c'][1:]}
            E[:] = [e for k, e in enumerate(E) if k not in (i, j)] + [m]; N.pop(hit, None); changed = True
    def prune():      # whiskers: a short dead-end branch off a junction
        dg = degrees(); drop = []
        for k, e in enumerate(E):
            da, db = dg[e['a']], dg[e['b']]
            if (da == 1) == (db == 1): continue
            tip, other = (e['a'], e['b']) if da == 1 else (e['b'], e['a'])
            if dg[other] >= 3 and elen(e) < max(SPUR_MIN, 2.0 * max(N[other]['r'], 1)) and not near_rim(N[tip]): drop.append(k)
        if not drop: return False
        E[:] = [e for k, e in enumerate(E) if k not in set(drop)]
        for n in [n for n in N if n not in {e['a'] for e in E} | {e['b'] for e in E}]: del N[n]
        return True
    for _ in range(40):
        ch = contract(); ch |= merge2(); ch |= prune(); ch |= merge2()
        if not ch: break
    outN_src = N
    used = sorted(N)
    # shim for the finishing step below: it expects lists indexed by node id
    N = {n: N[n] for n in used}
    # ---- finish: simplify, smooth, measure; keep nodes that are used ----
    used = sorted({e['a'] for e in E} | {e['b'] for e in E}); remap = {o: i for i, o in enumerate(used)}
    outN = []
    for o in used:
        n = N[o]; outN.append({'id': remap[o], 'x': round(n['x'], 1), 'z': round(n['z'], 1), 'rim': bool(near_rim(n))})
    outE = []
    for e in E:
        pts = rdp([tuple(p) for p in e['pts']], SIMPLIFY)
        if len(pts) >= 3: pts = chaikin(pts, 2)
        pts[0] = (outN[remap[e['a']]]['x'], outN[remap[e['a']]]['z']); pts[-1] = (outN[remap[e['b']]]['x'], outN[remap[e['b']]]['z'])
        dw = np.array(e['d']); cl = np.array(e['c'])
        # ignore the ends (they sit inside junction blobs, which are wider than the road)
        k = max(1, int(len(dw) * 0.15)); core = dw[k:-k] if len(dw) > 2 * k + 1 else dw; ccl = cl[k:-k] if len(cl) > 2 * k + 1 else cl
        outE.append({'id': 0, 'a': remap[e['a']], 'b': remap[e['b']], 'pts': [[round(float(p[0]), 1), round(float(p[1]), 1)] for p in pts],
                     'w': round(float(2 * np.median(core)), 1), 'clr': round(float(np.percentile(ccl, 5)), 1)})
    # components; main = longest total length
    parent = list(range(len(outN)))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    for e in outE: parent[find(e['a'])] = find(e['b'])
    tot = {}
    def plen(pts): return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
    for e in outE: tot[find(e['a'])] = tot.get(find(e['a']), 0) + plen(e['pts'])
    keepc = {c for c, t in tot.items() if t >= MIN_COMPONENT_M}; main = max(tot, key=tot.get)
    outE = [e for e in outE if find(e['a']) in keepc]
    used = sorted({e['a'] for e in outE} | {e['b'] for e in outE}); remap2 = {o: i for i, o in enumerate(used)}
    cid = {c: i for i, c in enumerate(sorted(keepc, key=lambda c: -tot[c]))}   # component 0 is the main network
    for i, e in enumerate(outE):
        e['comp'] = cid[find(e['a'])]; e['a'] = remap2[e['a']]; e['b'] = remap2[e['b']]; e['id'] = i
    outN = [dict(outN[o], id=remap2[o]) for o in used]
    for n in outN: n['comp'] = next((e['comp'] for e in outE if e['a'] == n['id'] or e['b'] == n['id']), 0)
    log('graph: nodes', len(outN), 'edges', len(outE), 'components', len(cid), 'main length m', round(tot[main]))
    return {'nodes': outN, 'edges': outE, 'sk': sk, 'road': road, 'origin': (x0, z0)}


def main():
    src, dst = sys.argv[1], sys.argv[2]; d = json.load(open(src))
    g = build(d)
    out = {'_file': 'public/data/oau-roadgraph.json (generated by tools/oau/roadgraph.py; do not edit by hand)', 'version': 1,
           'inputHash': d['inputHash'], 'params': {'res': RES, 'simplify': SIMPLIFY, 'spurMin': SPUR_MIN, 'rim': RIM},
           'nodes': g['nodes'], 'edges': g['edges']}
    json.dump(out, open(dst, 'w'), separators=(',', ':'))
    print('wrote', dst, round(len(json.dumps(out, separators=(',', ':'))) / 1024), 'KB')
    if '--debug' in sys.argv:
        from PIL import Image, ImageDraw
        png = sys.argv[sys.argv.index('--debug') + 1]; x0, z0 = g['origin']; S = float(sys.argv[sys.argv.index('--scale') + 1]) if '--scale' in sys.argv else 2
        # crop around the middle of the map
        cx, cz, w, h = (float(v) for v in (sys.argv[sys.argv.index('--crop') + 1:sys.argv.index('--crop') + 5] if '--crop' in sys.argv else (0, 0, 700, 450)))
        im = Image.new('RGB', (int(w * S), int(h * S)), (30, 34, 40)); px = im.load()
        road = g['road']
        for j in range(int(h * S)):
            for i in range(int(w * S)):
                gx = int((cx - w / 2 + i / S - x0) / RES); gz = int((cz - h / 2 + j / S - z0) / RES)
                if 0 <= gz < road.shape[0] and 0 <= gx < road.shape[1] and road[gz, gx]: px[i, j] = (80, 86, 96)
        dr = ImageDraw.Draw(im); T = lambda p: ((p[0] - (cx - w / 2)) * S, (p[1] - (cz - h / 2)) * S)
        for e in g['edges']:
            dr.line([T(p) for p in e['pts']], fill=(90, 220, 140) if e['comp'] == 0 else (240, 180, 60), width=2)
        for n in g['nodes']: t = T((n['x'], n['z'])); dr.ellipse([t[0] - 4, t[1] - 4, t[0] + 4, t[1] + 4], outline=(255, 90, 90), width=2)
        im.save(png)

if __name__ == '__main__': main()
#!/usr/bin/env python3
# tools/oau/import_campus.py
"""Converts the OpenStreetMap campus (campus.json + building-heights.json from the campus-archive branch) into the schema the game already loads
(public/data/oau-campus.json), so roadgraph.py, refine-roads.mjs, the 3D map and every test stay as they are.

    python3 tools/oau/import_campus.py --campus /path/campus.json --heights /path/building-heights.json --old public/data/oau-campus.legacy.json --out public/data/oau-campus.json
    needs: numpy, shapely   (offline tool only)

What it does
  1. units: campus.json is 20 px = 1 m, x east, y south, origin top-left. The output is metres, x east, z south, same origin (z = y).
  2. buildings: every OSM footprint, heights from building-heights.json (Google Open Buildings, CC BY 4.0) else the OSM value.
  3. roads: every `road` polyline is buffered by half its width and unioned into road polygons with holes (the schema roadgraph.py reads). Footpaths (`path`) are left out.
  4. areas: water, parking, field (-> pitch) and grass (-> park).
  5. places: an old place keeps its id and takes the new map's building when the two maps name it alike (EQUIV lists the hand-made matches). The rest are GAME PLACEMENTS: they keep their id, and
     are put where the old position lands under the fitted old->new transform, moved to the nearest spot clear of every building, road, lake, car park and pitch.
Deterministic: same input, same output. Do not hand-edit the output.
"""
import json, sys, math, re, argparse
import numpy as np
from shapely.geometry import Polygon, LineString, Point, box, MultiPolygon
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely import prepared

PX = 20.0
# old place id -> the name of the new map's place that is the same thing
EQUIV = {
    'amphitheatre': 'Amphi Theatre', 'first_bank_lt': 'First Bank Lecture Theare', 'f_technology': 'Faculty of Technology',
    'f_edm': 'New Faculty of Environmental Design and Management', 'senate': 'Senate Building', 'main_bowl': 'Main bowl',
    'h_moremi': 'Moremi Hall', 'h_fajuyi': 'Adekunle Fajuyi Hall of Residence',
}
# game-only places the user wants placed by the transform + a clear-of-buildings check (never matched to a real building)
FORCE_GAME = {'h_pg', 'h_akintola', 'h_ojaja', 'club_quantum', 'club_0203', 'club_divas'}
# the user asked for these to be dropped
DROP = {'pit_theatre', 'bio_gardens', 'zoo'}
# laid out separately (they are rectangles in mapExtras.js GROUNDS) or re-placed by tools/oau/place-billboards.mjs: not handled here
DEFER = {'motion_ground', 'religious_ground', 'church_catholic', 'church_anglican', 'church_pentecostal', 'church_baptist'}

norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())


def pts_m(flat):
    return [(flat[i] / PX, flat[i + 1] / PX) for i in range(0, len(flat), 2)]


def fit(pairs):
    """similarity transform (rotation, uniform scale, shift) old -> new from matched points, robust: refit on the best 85 % three times."""
    A = np.array([complex(*a) for a, _ in pairs]); B = np.array([complex(*b) for _, b in pairs]); M = np.c_[A, np.ones_like(A)]
    s = np.linalg.lstsq(M, B, rcond=None)[0]
    for _ in range(3):
        r = abs(M @ s - B); k = r < np.percentile(r, 85); s = np.linalg.lstsq(M[k], B[k], rcond=None)[0]
    r = abs(M @ s - B)
    return s, float(np.median(r)), float(np.percentile(r, 90))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--campus', required=True); ap.add_argument('--heights', required=True); ap.add_argument('--old', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--report', default=None)
    a = ap.parse_args()
    N = json.load(open(a.campus)); H = json.load(open(a.heights)); O = json.load(open(a.old))
    W, Hh = N['width'] / PX, N['height'] / PX

    # ---- buildings
    heights = H['heights']; B = []
    for i, b in enumerate(N['buildings']):
        pts = [[round(x, 1), round(z, 1)] for x, z in pts_m(b['pts'])]
        poly = Polygon(pts).buffer(0)
        h = heights.get(str(i)); src = 'google-open-buildings-2023' if h is not None else ('osm-height' if b.get('h') else 'default')
        h = float(h if h is not None else (b.get('h') or 5.0))
        B.append({'id': i, 'pts': pts, 'area': int(round(poly.area)), 'h': h, 'hSrc': src, '_name': b.get('name')})
    bpoly = [Polygon(b['pts']).buffer(0) for b in B]; btree = STRtree(bpoly)

    # ---- roads
    cut = []
    for r in N['roads']:
        if r['kind'] != 'road': continue
        cut.append(LineString(pts_m(r['pts'])).buffer(r['w'] / 2.0, cap_style=2, join_style=1, resolution=4))
    road_u = unary_union(cut).simplify(0.3)
    roads = []
    for g in (road_u.geoms if isinstance(road_u, MultiPolygon) else [road_u]):
        if g.area < 20: continue
        roads.append({'pts': [[round(x, 1), round(z, 1)] for x, z in g.exterior.coords[:-1]],
                      'holes': [[[round(x, 1), round(z, 1)] for x, z in h.coords[:-1]] for h in g.interiors if Polygon(h).area >= 4]})
    # ---- set buildings back from roads. OpenStreetMap houses stand right on the kerb; the game's road builder needs the centreline to keep 2.7 m clear of every wall (lib3d/roadgraph.js XS.minDrivableClearance) and
    # drops a road that does not, which splits the network. Every footprint is cut back to max(half the road width + 3 m, 6 m) from each road centreline (the old map got this from hand-made BUILDING_TRIMS).
    # A footprint left under 12 m2 is dropped; one that is cut in two keeps its larger piece. Building ids are renumbered; `remap` carries the OSM index to the new id.
    carve = unary_union([LineString(pts_m(r['pts'])).buffer(max(r['w'] / 2.0 + 3.0, 6.0), cap_style=2, join_style=1, resolution=4) for r in N['roads'] if r['kind'] == 'road'])
    nB, remap, cut_n, drop_n = [], {}, 0, 0
    for b in B:
        poly = Polygon(b['pts']).buffer(0)
        if poly.intersects(carve):
            rest = poly.difference(carve)
            parts = [g for g in (rest.geoms if hasattr(rest, 'geoms') else [rest]) if g.geom_type == 'Polygon' and g.area >= 12]
            if not parts: drop_n += 1; continue
            g = max(parts, key=lambda q: q.area).simplify(0.2)
            if g.area < poly.area - 0.5: cut_n += 1
            b = dict(b, pts=[[round(x, 1), round(z, 1)] for x, z in g.exterior.coords[:-1]], area=int(round(g.area)))
        remap[b['id']] = len(nB); b = dict(b, id=len(nB)); nB.append(b)
    report_carve = {'buildingsCutBack': cut_n, 'buildingsDropped': drop_n, 'kept': len(nB)}
    B = nB; bpoly = [Polygon(b['pts']).buffer(0) for b in B]; btree = STRtree(bpoly)
    # ---- areas
    areas = {'water': [], 'pitch': [], 'sports': [], 'park': [], 'wood': [], 'parking': []}
    kmap = {'water': 'water', 'parking': 'parking', 'field': 'pitch', 'grass': 'park'}
    apoly = []
    for ar in N['areas']:
        k = kmap.get(ar['kind'])
        if not k: continue
        pts = [[round(x, 1), round(z, 1)] for x, z in pts_m(ar['pts'])]; areas[k].append({'pts': pts}); apoly.append(Polygon(pts).buffer(0))
    bounds = {'x0': 0.0, 'x1': round(W, 1), 'z0': 0.0, 'z1': round(Hh, 1)}

    # ---- places
    newp = {norm(p['name']): p for p in N['places']}
    def find(p):
        n = EQUIV.get(p['id']); n = norm(n) if n else norm(p['name'])
        return newp.get(n)
    pairs, matched, game = [], {}, []
    O['places'] = [p for p in O['places'] if p['kind'] != 'billboard' and p['id'] not in DEFER]
    for p in O['places']:
        q = None if p['id'] in FORCE_GAME or p['id'] in DROP else find(p)
        if q is not None:
            matched[p['id']] = q; pairs.append(((p['x'], p['z']), (q['label'][0] / PX, q['label'][1] / PX)))
        elif p['id'] not in DROP: game.append(p)
    tr, med, p90 = fit(pairs)
    T = lambda x, z: (lambda w: (w.real, w.imag))(tr[0] * complex(x, z) + tr[1])
    scale, rot = float(abs(tr[0])), float(np.degrees(np.angle(tr[0])))

    # obstacles for the clear-spot search: buildings, roads, water, parking, pitch
    obst = [(g, 6.0) for g in bpoly] + [(road_u, 6.0)] + [(g, 4.0) for g in apoly]
    obst_geoms = [g for g, _ in obst]; otree = STRtree(obst_geoms); omargin = {id(g): m for g, m in obst}
    frame = box(25, 25, W - 25, Hh - 25)
    def clear(poly, need_road=False):
        if not frame.contains(poly): return False
        if need_road and road_u.distance(poly) > 16: return False   # a building the game sends cars to must be within 16 m of a road (its door needs one)
        for i in otree.query(poly.buffer(8)):
            g = obst_geoms[i]
            if g.distance(poly) < omargin[id(g)]: return False
        return True
    def rect(x, z, w, d, ang=0.0):
        r = box(x - w / 2, z - d / 2, x + w / 2, z + d / 2)
        return r
    def find_spot(x, z, w, d, need_road=False):
        """nearest spot to (x, z) where a w x d rectangle is clear; deterministic spiral over 4 m steps."""
        x = min(max(x, 40), W - 40); z = min(max(z, 40), Hh - 40)
        if clear(rect(x, z, w, d), need_road): return x, z, 0.0
        for rad in range(4, 900, 4):
            n = max(8, int(2 * math.pi * rad / 8))
            for k in range(n):
                t = 2 * math.pi * k / n; cx, cz = x + rad * math.cos(t), z + rad * math.sin(t)
                if clear(rect(cx, cz, w, d), need_road): return cx, cz, float(rad)
        raise RuntimeError('no clear spot near %s,%s' % (x, z))

    # the game's own sizes for extras with a fixed footprint (mapExtras.js BUILDINGS): w, d, h

    places, newb, report = [], [], {'transform': {'scale': round(scale, 4), 'rotDeg': round(rot, 3), 'shift': [round(tr[1].real, 1), round(tr[1].imag, 1)], 'pairs': len(pairs), 'medianErrM': round(med, 1), 'p90ErrM': round(p90, 1)}, 'matched': {}, 'game': {}, 'dropped': sorted(DROP), 'carve': report_carve}
    old_b = {b['id']: b for b in O['buildings']}
    claimed = set()
    for p in O['places']:
        if p['id'] not in matched: continue
        q = matched[p['id']]; bi = remap.get(q.get('building')) if q.get('building') is not None else None; x, z = q['label'][0] / PX, q['label'][1] / PX
        if bi is None:   # the new map gives some places only a label and a door: take the building that contains the label (or door), else the nearest one within 15 m
            for pt in (Point(x, z), Point(q['door'][0] / PX, q['door'][1] / PX) if q.get('door') else None):
                if pt is None: continue
                hit = [i for i in btree.query(pt) if bpoly[i].contains(pt)]
                if not hit:
                    near = sorted((bpoly[i].distance(pt), i) for i in btree.query(pt.buffer(15)))
                    hit = [near[0][1]] if near and near[0][0] <= 15 else []
                if hit: bi = int(hit[0]); break
            if bi is None: report.setdefault('noBuilding', []).append(p['id'])
        rec = {k: v for k, v in p.items() if k not in ('osmLabel', 'offmap', 'unnamed')}
        rec.update({'src': 'osm', 'conf': 'named-in-osm', 'x': round(x, 1), 'z': round(z, 1), 'bid': bi, 'snapPx': 0.0}); places.append(rec)
        if bi is not None: claimed.add(bi); B[bi]['place'] = p['id']
        report['matched'][p['id']] = q['name']
    nid = len(B)
    for p in game:
        ob = old_b.get(p.get('bid')); area = ob['area'] if ob else 400
        if ob:
            xs = [q[0] for q in ob['pts']]; zs = [q[1] for q in ob['pts']]; w, d = max(xs) - min(xs), max(zs) - min(zs)
        else: w, d = 20.0, 14.0
        w = min(max(w, 8), 70); d = min(max(d, 6), 45)
        x, z = T(p['x'], p['z']); cx, cz, moved = find_spot(x, z, w, d, True)
        h = ob['h'] if ob else 8.0
        pts = [[round(cx - w / 2, 1), round(cz - d / 2, 1)], [round(cx + w / 2, 1), round(cz - d / 2, 1)], [round(cx + w / 2, 1), round(cz + d / 2, 1)], [round(cx - w / 2, 1), round(cz + d / 2, 1)]]
        nb = {'id': nid, 'pts': pts, 'area': int(round(w * d)), 'h': float(h), 'hSrc': 'game-placement', 'place': p['id']}
        nb.update({k: ob[k] for k in ('wall', 'roof', 'neon') if ob and k in ob}); newb.append(nb)
        rec = {k: v for k, v in p.items() if k not in ('osmLabel', 'offmap', 'unnamed')}
        rec.update({'src': 'game-placement', 'conf': 'game', 'x': round(cx, 1), 'z': round(cz, 1), 'bid': nid, 'snapPx': 0.0}); places.append(rec)
        report['game'][p['id']] = {'from': [p['x'], p['z']], 'to': [round(cx, 1), round(cz, 1)], 'movedM': round(moved, 0)}
        # this footprint is now an obstacle for the next placement
        g = Polygon(pts); obst_geoms.append(g); omargin[id(g)] = 6.0; otree = STRtree(obst_geoms); nid += 1
    # the two grounds (mapExtras.js GROUNDS, in OLD metres): each moves, with its churches, to the nearest spot clear of everything, padded by 4 m for its apron
    GROUND_RECTS = {'motion': (28, 94, -2, 38), 'religious': (-54, -8, 164, 236)}
    offsets = {}
    for name, (x0, x1, z0, z1) in GROUND_RECTS.items():
        ocx, ocz = (x0 + x1) / 2, (z0 + z1) / 2; tx, tz = T(ocx, ocz); cx, cz, moved = find_spot(tx, tz, (x1 - x0) + 8, (z1 - z0) + 8)
        offsets[name] = [round(cx - ocx, 1), round(cz - ocz, 1)]
        g = box(cx - (x1 - x0) / 2 - 4, cz - (z1 - z0) / 2 - 4, cx + (x1 - x0) / 2 + 4, cz + (z1 - z0) / 2 + 4); obst_geoms.append(g); omargin[id(g)] = 6.0; otree = STRtree(obst_geoms)
        report.setdefault('grounds', {})[name] = {'centre': [round(cx, 1), round(cz, 1)], 'movedFromTransformM': round(moved, 0), 'offset': offsets[name]}
    out = {'_file': 'public/data/oau-campus.json (generated by tools/oau/import_campus.py from the OpenStreetMap campus; do not edit by hand)',
           'meta': {'title': 'OAU campus from OpenStreetMap', 'source': 'OpenStreetMap (campus.json) + Google Open Buildings 2.5D Temporal 2023 (heights)',
                    'attribution': N['attribution'] + '. Building heights: Google Open Buildings 2.5D Temporal, 2023 (CC BY 4.0)',
                    'axes': 'x east, z south, metres; origin top-left of the OSM frame', 'absoluteGeoreference': 'none claimed', 'terrain': 'flat',
                    'generated': N.get('generated'), 'oldToNew': report['transform'], 'groundOffsets': offsets},
           'bounds': bounds,
           'buildings': [{k: v for k, v in b.items() if not k.startswith('_')} for b in B] + newb,
           'roads': roads, 'areas': areas, 'outside': [], 'places': places,
           'gameOnly': O['gameOnly'], 'gate': {'x': round(N['gate']['x'] / PX, 1), 'z': round(N['gate']['y'] / PX, 1), 'angle': N['gate']['angle'], 'span': N['gate']['span']}}
    json.dump(out, open(a.out, 'w'), separators=(',', ':'))
    if a.report: json.dump(report, open(a.report, 'w'), indent=1)
    print('wrote', a.out, '| buildings', len(out['buildings']), 'roads', len(roads), 'places', len(places), '| matched', len(matched), 'game', len(game), '| fit', report['transform'])


if __name__ == '__main__': main()

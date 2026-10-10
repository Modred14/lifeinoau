# tools/oau/vectorize.py
"""tools/oau/vectorize.py

Turns the supplied OpenStreetMap-render screenshot of OAU into vector map data for the 3D campus.

    python3 tools/oau/vectorize.py <osm-screenshot.png> [out.json] [--debug-dir DIR]
    needs: opencv-python, numpy

What it does (and does not do):
  * It reads OSM Carto's standard colours: buildings #d9d0c9, roads #ffffff, parking #eeeeee, pitches #88e0be,
    sports centre #dffce2, park #cdebb0, wooded park #add19e, water #aad3df, campus (landuse=university) #ffffe5.
  * Geometry is the geometry OSM draws in that render. It is NOT surveyed data and it is NOT a download of the OSM database.
  * Scale: the screenshot has no scale bar. We assume it is a 1x web-mercator render at zoom 17 (ground resolution at 7.5 N is
    156543.03 * cos(lat) / 2^17 = 1.184 m per pixel). This was cross-checked against the Main Bowl track (see MAIN_BOWL_CHECK).
    If the screenshot was made at another zoom every distance scales by the same factor.
  * Orientation: north is up (OSM renders are north-up). No rotation is applied.
  * Local coordinates: x grows east, z grows SOUTH, metres, origin at pixel ORIGIN_PX. No absolute latitude/longitude is claimed.
"""
import json, sys, math, os
import numpy as np, cv2

LAT = 7.51833                                    # Wikipedia / project origin, only used for the zoom-17 resolution
M_PER_PX = 156543.03392 * math.cos(math.radians(LAT)) / 2 ** 17
ORIGIN_PX = (1500.0, 600.0)                      # roughly the quadrangle between Oduduwa Hall, the library and the SUB
G3_PER_DISPLAY = 2576 / 2000                     # labels.json stores Google pins in 2000-px-wide display coordinates
MAIN_BOWL_CHECK = "Main Bowl outline measures about 137 x 65 px; a standard 400 m track measures about 157 x 73 m (lane 1) => 1.12 to 1.15 m/px, within 5% of 1.184."

def hexmask(rgb, hexc, tol=4):
    c = np.array([int(hexc[i:i + 2], 16) for i in (1, 3, 5)])
    return (np.abs(rgb - c).sum(axis=2) <= tol).astype(np.uint8) * 255

def to_m(p):
    return [round((p[0] - ORIGIN_PX[0]) * M_PER_PX, 1), round((p[1] - ORIGIN_PX[1]) * M_PER_PX, 1)]

def poly(c, eps):
    a = cv2.approxPolyDP(c, eps, True).reshape(-1, 2).astype(float)
    return a

def similarity(A, B):
    A = np.array(A, float); B = np.array(B, float); ca, cb = A.mean(0), B.mean(0); a = A - ca; b = B - cb
    cr = np.sum(a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]); dt = np.sum(a * b); den = np.sum(a * a)
    th = math.atan2(cr, dt); sc = math.hypot(cr, dt) / den
    R = sc * np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    f = lambda P: (np.array(P, float) - ca) @ R.T + cb
    res = np.linalg.norm(f(A) - B, axis=1)
    return f, sc, math.degrees(th), res

def main():
    args = sys.argv[1:]; dbg = None
    if "--debug-dir" in args: i = args.index("--debug-dir"); dbg = args[i + 1]; del args[i:i + 2]
    src = args[0]; out = args[1] if len(args) > 1 else "public/data/oau-campus.json"
    here = os.path.dirname(os.path.abspath(__file__)); cat = json.load(open(os.path.join(here, "labels.json")))
    im = cv2.imread(src); H, W = im.shape[:2]; rgb = im[:, :, ::-1].astype(int)

    # ---- buildings: OSM fill colour, 1 px grown back (the 1 px outline separates neighbours) ----
    b = hexmask(rgb, "#d9d0c9", 5)
    b = cv2.morphologyEx(b, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    b = cv2.dilate(b, np.ones((3, 3), np.uint8), iterations=1)
    cs, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cs = [c for c in cs if cv2.contourArea(c) >= 28]
    cs.sort(key=lambda c: (round(cv2.boundingRect(c)[1] / 40), cv2.boundingRect(c)[0]))
    blds = []
    for i, c in enumerate(cs):
        p = poly(c, 1.0)
        if len(p) < 3: continue
        area_m2 = cv2.contourArea(c) * M_PER_PX ** 2
        h = 5.0 + ((i * 2654435761) % 3001) / 1000.0     # 5.0 to 8.0 m: "most buildings are within 5 m and 8 m" (Bello et al. 2025, MAGG 3(2) 81-87)
        blds.append({"id": i, "pts": [to_m(q) for q in p], "area": round(area_m2), "h": round(h, 1), "hSrc": "default-5-8m"})
    polys_px = [np.array([[(q[0] / M_PER_PX) + ORIGIN_PX[0], (q[1] / M_PER_PX) + ORIGIN_PX[1]] for q in bd["pts"]], np.float32) for bd in blds]

    # ---- roads (white carriageway) and parking ----
    r = hexmask(rgb, "#ffffff", 2)
    r = cv2.morphologyEx(r, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)); r = cv2.morphologyEx(r, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    cr_, hier = cv2.findContours(r, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE); roads = []
    for i, c in enumerate(cr_):
        if hier[0][i][3] != -1 or cv2.contourArea(c) < 60: continue
        holes = [poly(cr_[j], 1.0) for j in range(len(cr_)) if hier[0][j][3] == i and cv2.contourArea(cr_[j]) >= 20]
        roads.append({"pts": [to_m(q) for q in poly(c, 0.9)], "holes": [[to_m(q) for q in hh] for hh in holes if len(hh) >= 3]})

    def areas(hexc, minA, eps=1.2, tol=6):
        m = hexmask(rgb, hexc, tol); m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        cc, hh = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE); o = []
        for i, c in enumerate(cc):
            if hh[0][i][3] != -1 or cv2.contourArea(c) < minA: continue
            o.append({"pts": [to_m(q) for q in poly(c, eps)]})
        return o
    A = {"water": areas("#aad3df", 400, 2.0), "pitch": areas("#88e0be", 120), "sports": areas("#dffce2", 400, 2.0),
         "park": areas("#cdebb0", 150), "wood": areas("#add19e", 400), "parking": areas("#eeeeee", 60)}

    # campus (landuse=university) vs. outside: bounding polygon of the pale-yellow fill
    cm = hexmask(rgb, "#f2efe9", 3); cc, _ = cv2.findContours(cm, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    outside = [{"pts": [to_m(q) for q in poly(c, 3.0)]} for c in cc if cv2.contourArea(c) > 5000]

    # ---- Google pins -> OSM pixels ----
    pairs = cat["controlPoints"]["pairs"]; f3, sc, rot, res = similarity([p[1] for p in pairs], [p[2] for p in pairs])
    georef = {"googleToOsm": {"scale": round(sc, 4), "rotationDeg": round(rot, 2), "residualPx": {p[0]: round(float(x), 1) for p, x in zip(pairs, res)},
              "rmsM": round(float(np.sqrt(np.mean(res ** 2))) * M_PER_PX, 1)}}

    # ---- places ----
    places = []
    for p in cat["places"]:
        px = list(p["px"])
        if "g3" in p: px = f3([[p["g3"][0] * G3_PER_DISPLAY, p["g3"][1] * G3_PER_DISPLAY]])[0].tolist()
        pt = (float(px[0]), float(px[1])); best, bd_, inside = None, 1e9, False
        if not p.get("offmap") and not p.get("area"):
            for i, pg in enumerate(polys_px):
                d = cv2.pointPolygonTest(pg, pt, True)       # >0 inside
                dd = -d if d > 0 else -d                       # distance to polygon, inside counts as 0
                dist = 0.0 if d >= 0 else -d
                if dist < bd_: bd_, best = dist, i
            limit = 0 if p["src"] != "osm-screenshot" else (45 if p["kind"] == "hostel" else 14)   # Google pins only snap when they fall inside a footprint
            if "pickPx" in p:   # hand-picked footprint for non-convex buildings whose OSM label sits in the notch
                pk = (float(p["pickPx"][0]), float(p["pickPx"][1])); best = min(range(len(polys_px)), key=lambda i: -cv2.pointPolygonTest(polys_px[i], pk, True)); bd_ = 0; limit = 1
            if best is not None and bd_ <= limit: inside = True
        e = {"id": p["id"], "name": p["name"], "kind": p["kind"], "tier": p["tier"], "src": p["src"]}
        e["conf"] = {"osm-screenshot": "named-in-osm-render", "google-screenshot": "approximate"}[p["src"]]
        if inside:
            bd = blds[best]; cx = float(np.mean([q[0] for q in bd["pts"]])); cz = float(np.mean([q[1] for q in bd["pts"]]))
            e.update({"x": round(cx, 1), "z": round(cz, 1), "bid": bd["id"], "snapPx": round(bd_, 1)}); bd["place"] = p["id"]
        else:
            m = to_m(px); e.update({"x": m[0], "z": m[1], "bid": None, "snapPx": None})
        if p.get("unnamed"): e["unnamed"] = True
        if p.get("osmLabel"): e["osmLabel"] = p["osmLabel"]
        if p.get("offmap"): e["offmap"] = True
        places.append(e)

    # heights: published and estimated
    byid = {pl["id"]: pl for pl in places}
    def setH(pid, h, src):
        pl = byid.get(pid)
        if pl and pl["bid"] is not None: blds[pl["bid"]]["h"] = h; blds[pl["bid"]]["hSrc"] = src
    setH("senate", 24.0, "published-MAGG-2025")        # "8 floors of 24 m", Bello et al. 2025
    setH("library", 14.0, "estimate-multistorey")      # "two multi-storey wings" (Wikipedia); floors not published, so this is an estimate

    bounds = {"x0": round((0 - ORIGIN_PX[0]) * M_PER_PX, 1), "x1": round((W - ORIGIN_PX[0]) * M_PER_PX, 1), "z0": round((0 - ORIGIN_PX[1]) * M_PER_PX, 1), "z1": round((H - ORIGIN_PX[1]) * M_PER_PX, 1)}
    data = {"_file": "public/data/oau-campus.json (generated by tools/oau/vectorize.py; do not edit by hand)", "meta": {"title": "OAU campus vectorised from an OpenStreetMap render", "source": "Supplied screenshot of an OpenStreetMap (c) contributors render; Google screenshots for Pit Theatre etc.",
                     "attribution": "Map data (c) OpenStreetMap contributors (ODbL)", "mPerPx": round(M_PER_PX, 4), "scaleCheck": MAIN_BOWL_CHECK, "originPx": ORIGIN_PX,
                     "imageSizePx": [W, H], "axes": "x east, z south, metres", "absoluteGeoreference": "none: the screenshots carry no coordinates, so no latitude/longitude is claimed",
                     "terrain": "flat: no elevation data could be obtained (OAU sits at about 275 m on hilly land per MAGG 2025)", "georef": georef},
            "bounds": bounds, "buildings": blds, "roads": roads, "areas": A, "outside": outside, "places": places, "gameOnly": cat["gameOnly"]}
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    json.dump(data, open(out, "w"), separators=(",", ":"))
    snapped = sum(1 for p in places if p["bid"] is not None)
    print(f"wrote {out}: {os.path.getsize(out) // 1024} KB; buildings {len(blds)}, road polys {len(roads)}, places {len(places)} ({snapped} snapped to a footprint)")
    print("google->osm fit:", georef["googleToOsm"])
    if dbg:
        os.makedirs(dbg, exist_ok=True); o = im.copy()
        for pg in polys_px: cv2.polylines(o, [pg.astype(np.int32)], True, (0, 160, 0), 1)
        for p in places:
            q = (int(p["x"] / M_PER_PX + ORIGIN_PX[0]), int(p["z"] / M_PER_PX + ORIGIN_PX[1]))
            cv2.circle(o, q, 5, (0, 0, 255) if p["bid"] is not None else (255, 0, 255), -1)
            cv2.putText(o, p["id"], (q[0] + 6, q[1] - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 0, 0), 1)
        cv2.imwrite(os.path.join(dbg, "overlay.png"), o)

if __name__ == "__main__": main()
# tools/avatars/build_parts.py
"""
Builds modular parts (clothing, hair) that are skinned to the same skeleton as the bodies from build_base.py.
Run build_base.py first (it writes body_M.npz / body_F.npz and meta files next to the GLBs).

Usage:  python3 tools/avatars/build_parts.py <mpfb2 data dir> <output dir>
Output: <out>/parts/outfit/campus_m.glb, campus_f.glb ; <out>/parts/hair/<style>_<m|f>.glb
Clothing is made by offsetting the body surface, which fits every body shape the base can produce.
"""
import sys, os, json, math
import numpy as np
from PIL import Image
sys.argv = (sys.argv + ["/tmp/mpfb/src/mpfb/data", "/tmp/avatars"])[:3]
import build_base as bb  # noqa: E402
import pygltflib as g  # noqa: E402

DATA, OUT = bb.DATA, bb.OUT
rig = json.load(open(f"{DATA}/rigs/standard/rig.mixamo.json"))["bones"]
NAMES = []
def _add(n):
    if n in NAMES or n == "": return
    _add(rig[n]["parent"]); NAMES.append(n)
for _n in sorted(rig): _add(_n)


def load(gender):
    d = np.load(f"{OUT}/body_{gender}.npz"); m = json.load(open(f"{OUT}/meta_{gender}.json"))
    head = {k: np.array(v) for k, v in m["head"].items()}
    return dict(P=d["P"], N=d["N"], UV=d["UV"], T=d["T"], J=d["J"], W=d["W"], head=head, joints={k: np.array(v) for k, v in m["joints"].items()}, F=gender == "F")


def dominant(B): return np.array([NAMES[i] for i in B["J"][:, 0]])
def has(dom, *subs): return np.array([any(s in d for s in subs) for d in dom])


def fabric_normal(size=512, seed=2, strength=0.35):
    rng = np.random.default_rng(seed); x = np.arange(size)
    weave = np.sin(x[None, :] * 2 * math.pi / 3) * np.sin(x[:, None] * 2 * math.pi / 3) * 0.12
    noise = np.array(Image.fromarray((rng.random((size // 2, size // 2)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC), np.float32) / 255
    h = weave + noise * 0.8; gy, gx = np.gradient(h); nx, ny, nz = -gx * strength, gy * strength, np.ones_like(h); L = np.sqrt(nx * nx + ny * ny + nz * nz)
    return (np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5) * 255


def garment(B, sel, offset, color, name, rough=0.92, warp=None):
    """Takes the body triangles whose vertices are all selected and pushes them out along the normals."""
    T = B["T"]; keep = sel[T].all(1); T2 = T[keep]
    used = np.unique(T2); remap = -np.ones(len(B["P"]), int); remap[used] = np.arange(len(used))
    P = B["P"][used].copy(); N = B["N"][used]
    off = offset[used] if np.ndim(offset) else offset
    P = P + N * (off[:, None] if np.ndim(off) else off)
    if warp is not None: P = warp(P, used)
    return dict(name=name, P=P, N=N.copy(), UV=B["UV"][used], T=remap[T2], J=B["J"][used], W=B["W"][used], color=color, rough=rough)


def merge(a, b):
    n = len(a["P"]); return dict(name=a["name"], P=np.vstack([a["P"], b["P"]]), N=np.vstack([a["N"], b["N"]]), UV=np.vstack([a["UV"], b["UV"]]), T=np.vstack([a["T"], b["T"] + n]), J=np.vstack([a["J"], b["J"]]), W=np.vstack([a["W"], b["W"]]), color=a["color"], rough=a["rough"])


def write_part(path, meshes, normal_map=True):
    G = bb.GLB(); gl = G.gltf; gl.asset = g.Asset(version="2.0", generator="OAU Life avatar parts builder")
    gl.samplers = [g.Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]
    tn = G.image(bb.png_bytes(fabric_normal().astype(np.uint8)), "image/png") if normal_map else None
    head = {n: None for n in NAMES}
    meta_head = {}  # filled from first mesh's owner via global
    nodes, idx = [], {}
    for n in NAMES: idx[n] = len(nodes); nodes.append(g.Node(name=n, children=[]))
    roots = []
    H = path_heads[0]
    for n in NAMES:
        par = rig[n]["parent"]
        if par == "": nodes[idx[n]].translation = H[n].tolist(); roots.append(idx[n])
        else: nodes[idx[n]].translation = (H[n] - H[par]).tolist(); nodes[idx[par]].children.append(idx[n])
    ibm = np.zeros((len(NAMES), 4, 4), np.float32)
    for i, n in enumerate(NAMES): m = np.eye(4); m[:3, 3] = -H[n]; ibm[i] = m.T
    ibm_a = G.acc(ibm.reshape(-1, 16), g.FLOAT, g.MAT4)
    gl.skins = [g.Skin(name="Armature", joints=[idx[n] for n in NAMES], skeleton=roots[0], inverseBindMatrices=ibm_a)]
    scene = list(roots)
    for mi, M in enumerate(meshes):
        gl.materials.append(g.Material(name=M["name"], pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=[float(c) ** 2.2 for c in M["color"]] + [1], metallicFactor=0, roughnessFactor=M["rough"]),
                                       **({"normalTexture": g.NormalMaterialTexture(index=tn, scale=0.5)} if normal_map and M.get("fabric", True) else {})))
        pa = G.acc(M["P"].astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER, True); na = G.acc(M["N"].astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER)
        ua = G.acc(np.stack([M["UV"][:, 0], 1 - M["UV"][:, 1]], 1).astype(np.float32), g.FLOAT, g.VEC2, g.ARRAY_BUFFER)
        ja = G.acc(M["J"].astype(np.uint16), g.UNSIGNED_SHORT, g.VEC4, g.ARRAY_BUFFER); wa = G.acc(M["W"].astype(np.float32), g.FLOAT, g.VEC4, g.ARRAY_BUFFER)
        ia = G.acc(M["T"].astype(np.uint32).reshape(-1), g.UNSIGNED_INT, g.SCALAR, g.ELEMENT_ARRAY_BUFFER)
        gl.meshes.append(g.Mesh(name=M["name"], primitives=[g.Primitive(attributes=g.Attributes(POSITION=pa, NORMAL=na, TEXCOORD_0=ua, JOINTS_0=ja, WEIGHTS_0=wa), indices=ia, material=mi)]))
        scene.append(len(nodes)); nodes.append(g.Node(name=M["name"], mesh=len(gl.meshes) - 1, skin=0))
    gl.nodes = nodes; gl.scenes[0].nodes = scene
    os.makedirs(os.path.dirname(path), exist_ok=True); G.save(path); print(path, os.path.getsize(path) // 1024, "KB", sum(len(m["T"]) for m in meshes), "tris")


path_heads = [None]


# ---------------------------------------------------------------- clothing
def side_arm_t(B, side):
    """Position along the arm (0 shoulder, 1 wrist) and a mask of vertices on that arm."""
    h = B["head"]; s = "Left" if side > 0 else "Right"
    a0, a1 = h[f"mixamorig:{s}Arm"], h[f"mixamorig:{s}Hand"]; d = a1 - a0; L = float(d @ d)
    t = ((B["P"] - a0) @ d) / L; dom = dominant(B)
    arm = has(dom, f"{s}Arm", f"{s}ForeArm", f"{s}Hand")
    return t, arm & (np.sign(B["P"][:, 0]) == side)


def leg_t(B, side):
    h = B["head"]; s = "Left" if side > 0 else "Right"
    top, ank = h[f"mixamorig:{s}UpLeg"], h[f"mixamorig:{s}Foot"]
    t = (top[1] - B["P"][:, 1]) / (top[1] - ank[1]); dom = dominant(B)
    leg = has(dom, f"{s}UpLeg", f"{s}Leg") & (np.sign(B["P"][:, 0]) == side)
    return t, leg, top, ank


def tube_warp(B, base_r, flare, keep=0.0):
    """Turns each leg into a straight, round trouser leg: blends the body's own shape into a circle of radius base_r + flare * t."""
    def warp(Pn, used):
        out = Pn.copy()
        for side in (1, -1):
            t, leg, topj, ank = leg_t(B, side); t = t[used]; m = leg[used]; tc = np.clip(t, 0, 1)
            knee = B["head"][f"mixamorig:{'Left' if side > 0 else 'Right'}Leg"]; tk = (topj[1] - knee[1]) / (topj[1] - ank[1])  # the axis bends through the knee
            axx = np.interp(tc, [0, tk, 1], [topj[0], knee[0], ank[0]]); axz = np.interp(tc, [0, tk, 1], [topj[2], knee[2], ank[2]])
            dx, dz = out[:, 0] - axx, out[:, 2] - axz; r = np.maximum(np.hypot(dx, dz), 1e-6)
            w = np.clip((tc - 0.02) / 0.3, 0, 1) ** 1.2; r_new = np.maximum(r * 1.025, (1 - w) * r * 1.03 + w * (base_r + flare * tc))  # never inside the body
            out[:, 0] = np.where(m, axx + dx / r * r_new, out[:, 0]); out[:, 2] = np.where(m, axz + dz / r * r_new, out[:, 2])
        return out
    return warp


def collar(M, neck_y):
    """Rounds off the neckline: vertices above a smooth curve are pulled down onto it (lower at the front)."""
    P = M["P"]; cut = neck_y + 0.012 - 0.03 * np.clip(P[:, 2] / 0.09, 0, 1) ** 2; P[:, 1] = np.minimum(P[:, 1], cut)


def build_outfit(B):
    F = B["F"]; P = B["P"]; dom = dominant(B); h = B["head"]; y = P[:, 1]
    hips_y, sp_y = h["mixamorig:Hips"][1], h["mixamorig:Spine1"][1]; neck_y = h["mixamorig:Neck"][1]
    torso = has(dom, "Spine", "Shoulder") | (has(dom, "Hips") & (y > hips_y - 0.10)); tL, armL = side_arm_t(B, 1); tR, armR = side_arm_t(B, -1)
    meshes = []
    if not F:
        hem = hips_y - 0.095
        # hoodie: torso + long sleeves to the wrist
        sel = (torso | armL | armR) & (y > hem) & (y < neck_y + 0.012) & ~has(dom, "Hand", "Head", "Neck")
        sel &= ~((armL & (tL > 0.88)) | (armR & (tR > 0.88)))
        off = np.full(len(P), 0.042); off[armL | armR] = 0.034
        hz = garment(B, sel, off, (0.085, 0.09, 0.10), "Hoodie", 0.95)
        hz["P"][:, 1] = np.maximum(hz["P"][:, 1], hem + 0.0)  # straight hem
        collar(hz, neck_y)
        meshes.append(hz)
        # cargo trousers
        sel_t = has(dom, "Hips", "UpLeg", "Leg") & (y < hips_y + 0.03) & ~has(dom, "Foot", "Toe")
        t_, _, _, _ = leg_t(B, 1)
        offs = np.full(len(P), 0.006)
        warp = tube_warp(B, 0.098, 0.012)
        ct = garment(B, sel_t, offs, (0.115, 0.125, 0.14), "Cargo", 0.95, warp)
        # hem at the ankle
        ank_y = h["mixamorig:LeftFoot"][1] + 0.035
        ct["P"][:, 1] = np.maximum(ct["P"][:, 1], ank_y); meshes.append(ct)
    else:
        hem = sp_y + 0.01
        sel = (torso | (armL & (tL < 0.4)) | (armR & (tR < 0.4))) & (y > hem) & (y < neck_y + 0.012) & ~has(dom, "Hand", "Head", "Neck")
        off = np.full(len(P), 0.0075); top = garment(B, sel, off, (0.085, 0.09, 0.10), "CropTop", 0.9); top["P"][:, 1] = np.maximum(top["P"][:, 1], hem); collar(top, neck_y); meshes.append(top)
        sel_t = has(dom, "Hips", "UpLeg", "Leg") & (y < hips_y + 0.075) & ~has(dom, "Foot", "Toe")
        warp = tube_warp(B, 0.104, 0.034)
        jn = garment(B, sel_t, np.full(len(P), 0.008), (0.23, 0.36, 0.52), "Jeans", 0.92, warp)
        ank_y = h["mixamorig:LeftFoot"][1] + 0.03; jn["P"][:, 1] = np.maximum(jn["P"][:, 1], ank_y); meshes.append(jn)
    # sneakers: white upper and a grey sole
    foot = has(dom, "Foot", "Toe") | (has(dom, "Leg") & (y < h["mixamorig:LeftFoot"][1] + 0.03) & ~has(dom, "UpLeg"))
    up = garment(B, foot & (y > 0.02), 0.0085, (0.94, 0.94, 0.93), "SneakerUpper", 0.7)
    so = garment(B, foot & (y < 0.04), 0.0155, (0.55, 0.57, 0.6), "SneakerSole", 0.8); so["P"][:, 1] -= 0.006; so["fabric"] = False
    meshes += [up, so]
    return meshes


# ---------------------------------------------------------------- hair
def icos(n_sub=0):
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]])
    return v, f


def blobs(centers, radii, scales=None, rots=None, color=(0.03, 0.025, 0.025), weights_fn=None, B=None, name="Hair"):
    """Many small low-poly blobs merged into one mesh (curls, braid segments)."""
    v0, f0 = icos(); Ps, Ns, Ts = [], [], []; base = 0
    for i, c in enumerate(centers):
        s = np.array(scales[i] if scales is not None else [1, 1, 1]) * radii[i]
        R = rots[i] if rots is not None else np.eye(3)
        p = (v0 * s) @ R.T + c; n = v0 / s; n = (n @ R.T); n /= np.linalg.norm(n, axis=1, keepdims=True)
        Ps.append(p); Ns.append(n); Ts.append(f0 + base); base += len(v0)
    P = np.vstack(Ps); N = np.vstack(Ns); T = np.vstack(Ts)
    J = np.zeros((len(P), 4), np.uint16); W = np.zeros((len(P), 4), np.float32)
    ih, i2, i1 = NAMES.index("mixamorig:Head"), NAMES.index("mixamorig:Spine2"), NAMES.index("mixamorig:Neck")
    for k in range(len(P)):
        a = weights_fn(P[k]) if weights_fn else 0.0  # 0 = head, 1 = upper back
        J[k, 0], W[k, 0] = ih, 1 - a; J[k, 1], W[k, 1] = i2, a
    return dict(name=name, P=P, N=N, UV=np.zeros((len(P), 2)), T=T, J=J, W=W, color=color, rough=0.85, fabric=False)


def sample_scalp(B, n, seed, region):
    """Random points on the head surface triangles that pass `region(point)`, with outward normals."""
    rng = np.random.default_rng(seed); P, N, T = B["P"], B["N"], B["T"]; dom = dominant(B)
    ok = has(dom, "Head") & np.array([region(p) for p in P]); tri = T[ok[T].all(1)]
    a, b, c = P[tri[:, 0]], P[tri[:, 1]], P[tri[:, 2]]; area = np.linalg.norm(np.cross(b - a, c - a), axis=1); pr = area / area.sum()
    pick = rng.choice(len(tri), n, p=pr); u, v = rng.random(n), rng.random(n); fl = u + v > 1; u[fl], v[fl] = 1 - u[fl], 1 - v[fl]
    ts = tri[pick]; pts = P[ts[:, 0]] + u[:, None] * (P[ts[:, 1]] - P[ts[:, 0]]) + v[:, None] * (P[ts[:, 2]] - P[ts[:, 0]])
    nn = N[ts[:, 0]] + N[ts[:, 1]] + N[ts[:, 2]]; nn /= np.linalg.norm(nn, axis=1, keepdims=True); return pts, nn


def rand_rot(rng): 
    a = rng.normal(size=3); a /= np.linalg.norm(a); th = rng.random() * 6.28; K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]); return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


def hair_parts(B, style):
    h = B["head"]; ey = B["joints"]["joint-l-eye"][1]; F = B["F"]; rng = np.random.default_rng(7); dom = dominant(B)
    def hairline(p):  # above the forehead, and behind/above the ears
        front = ey + 0.062 - 0.075 * np.clip((0.09 - p[2]) / 0.12, 0, 1)
        return p[1] > front and not (abs(p[0]) > 0.075 and p[1] < ey + 0.02)
    out = []
    if style in ("lowcut", "afro"):
        cap = garment(B, has(dom, "Head") & np.array([hairline(p) for p in P_ALL[0]]), 0.0035, (0.03, 0.025, 0.025), "HairCap", 0.9); cap["fabric"] = False; out.append(cap)
        if style == "lowcut":
            pts, nn = sample_scalp(B, 520, 1, lambda p: hairline(p) and p[1] > ey + 0.075)
            C = pts + nn * 0.0045; R = rng.uniform(0.0055, 0.0085, len(C))
            out.append(blobs(C, R, rots=[rand_rot(rng) for _ in C], B=B, name="Curls"))
        else:
            cen = np.array([0.0, ey + 0.06, h["mixamorig:Head"][2] - 0.02]); C, R = [], []
            while len(C) < 1500:
                d = rng.normal(size=3); d /= np.linalg.norm(d); r = 0.165 + rng.random() * 0.012; p = cen + d * np.array([r * 0.98, r * 0.93, r * 0.95])
                if p[1] < ey - 0.015 or (p[2] > 0.06 and p[1] < ey + 0.075) or (abs(p[0]) > 0.09 and p[1] < ey + 0.02): continue
                C.append(p); R.append(rng.uniform(0.011, 0.016))
            out.append(blobs(np.array(C), R, rots=[rand_rot(rng) for _ in C], B=B, name="Curls"))
    elif style == "braids":
        cap = garment(B, has(dom, "Head") & np.array([hairline(p) for p in P_ALL[0]]), 0.003, (0.03, 0.025, 0.025), "HairCap", 0.9); cap["fabric"] = False; out.append(cap)
        # cornrows on top
        pts, nn = sample_scalp(B, 900, 4, lambda p: hairline(p) and p[1] > ey + 0.06)
        order = np.lexsort((pts[:, 2], np.round(pts[:, 0] / 0.012))); pts, nn = pts[order], nn[order]
        C = pts + nn * 0.0035; out.append(blobs(C, np.full(len(C), 0.0052), scales=[[1, 1, 1.5]] * len(C), rots=[rand_rot(rng) * 0 + np.eye(3) for _ in C], B=B, name="Cornrows"))
        # long braids down the back
        neck_y = h["mixamorig:Neck"][1]; hips_y = h["mixamorig:Hips"][1]; end_y = hips_y + 0.12; C2, R2, S2, M2 = [], [], [], []
        back = P_ALL[0]
        def back_z(x, yy):
            m = (np.abs(back[:, 0] - x) < 0.03) & (np.abs(back[:, 1] - yy) < 0.025) & (back[:, 2] < 0.05); return back[m][:, 2].min() if m.any() else -0.09
        n_br = 60
        for i in range(n_br):
            a = math.pi * (0.62 + 0.76 * ((i + rng.random() * 0.5) / n_br)); r = 0.092
            x0, z0 = math.sin(a) * r, math.cos(a) * r - 0.012; y0 = ey + 0.02 - 0.05 * max(0, -math.cos(a)) - 0.02
            L = rng.uniform(0.86, 1.0) * (y0 - end_y); segs = int(L / 0.0105)
            for k in range(segs):
                t = k / segs; yy = y0 - t * L
                x = x0 * (1 + 0.5 * min(1, t * 3)) * (1 - 0.25 * t); zb = back_z(x, yy) - 0.016
                z = min(z0 - 0.04 * min(1, t * 3), zb) if yy < neck_y + 0.03 else z0 - 0.04 * min(1, t * 3)
                C2.append([x + (0.0022 if k % 2 else -0.0022), yy, z]); R2.append(0.0052); S2.append([1, 1.5, 1]); M2.append(np.eye(3))
        def wfn(p): return float(np.clip((neck_y + 0.04 - p[1]) / 0.1, 0, 1))
        out.append(blobs(np.array(C2), R2, scales=S2, rots=M2, weights_fn=wfn, B=B, name="Braids"))
    return out


P_ALL = [None]


def main():
    for gender, tag in (("M", "m"), ("F", "f")):
        B = load(gender); path_heads[0] = B["head"]; P_ALL[0] = B["P"]
        write_part(f"{OUT}/parts/outfit/campus_{tag}.glb", build_outfit(B))
        styles = ["lowcut", "afro"] if gender == "M" else ["braids", "afro"]
        for st in styles: write_part(f"{OUT}/parts/hair/{st}_{tag}.glb", hair_parts(B, st), normal_map=False)


if __name__ == "__main__": main()

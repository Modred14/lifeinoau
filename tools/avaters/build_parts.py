# tools/avaters/build_parts.py
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
_extra = sys.argv[3:4]; sys.argv = (sys.argv + ["/tmp/mpfb/src/mpfb/data", "/tmp/avatars"])[:3]
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


def garment(B, sel, offset, color, name, rough=0.92, warp=None, smooth=0, min_clear=0.0):
    """Takes the body triangles whose vertices are all selected and pushes them out along the normals.
    smooth: Laplacian passes that soften the body's muscle/bone detail so cloth hangs like cloth; min_clear: never closer than this to the skin."""
    T = B["T"]; keep = sel[T].all(1); T2 = T[keep]
    used = np.unique(T2); remap = -np.ones(len(B["P"]), int); remap[used] = np.arange(len(used))
    Pb = B["P"][used].copy(); N = B["N"][used]; T3 = remap[T2]
    off = offset[used] if np.ndim(offset) else offset
    P = Pb + N * (off[:, None] if np.ndim(off) else off)
    if warp is not None: P = warp(P, used)
    if smooth:
        import scipy.sparse as sp
        # weld vertices that share a position (UV-seam duplicates) so the seam is smoothed as one surface and never tears open
        _, wid = np.unique(np.round(Pb / 1e-5).astype(np.int64), axis=0, return_inverse=True); wid = wid.ravel(); nw = wid.max() + 1
        cnt = np.bincount(wid, minlength=nw)[:, None]; Pw = np.zeros((nw, 3)); np.add.at(Pw, wid, P); Pw /= cnt
        e = wid[np.vstack([T3[:, [0, 1]], T3[:, [1, 2]], T3[:, [2, 0]]])]; A = sp.coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nw, nw)); A = ((A + A.T) > 0).astype(float).tocsr()
        deg = np.maximum(np.asarray(A.sum(1)).ravel(), 1)[:, None]
        for _ in range(smooth): Pw = 0.5 * Pw + 0.5 * (A @ Pw) / deg
        P = Pw[wid]
    if min_clear > 0:
        d = ((P - Pb) * N).sum(1); P = P + N * np.maximum(0, min_clear - d)[:, None]
    return dict(name=name, P=P, N=N.copy(), UV=B["UV"][used], T=T3, J=B["J"][used], W=B["W"][used], color=color, rough=rough)


def merge(a, b):
    n = len(a["P"]); return dict(name=a["name"], P=np.vstack([a["P"], b["P"]]), N=np.vstack([a["N"], b["N"]]), UV=np.vstack([a["UV"], b["UV"]]), T=np.vstack([a["T"], b["T"] + n]), J=np.vstack([a["J"], b["J"]]), W=np.vstack([a["W"], b["W"]]), color=a["color"], rough=a["rough"])


def lin(r, g, b):
    """sRGB 0-255 -> linear glTF baseColorFactor (the old build fed sRGB-looking values in as linear, so every garment came out near black)."""
    return [(c / 255.0) ** 2.2 for c in (r, g, b)]


def hair_texture(size=256, seed=11):
    """Tileable hair micro-texture. RGB = strand shading, A = dither noise in [0.5, 1] so that (vertex alpha * A) >= 0.5 gives a
    stochastic, strand-like hairline (vertex alpha 1 = fully covered, 0.5 = bare scalp)."""
    from scipy.ndimage import gaussian_filter
    rng = np.random.default_rng(seed)
    def tile_noise(sig):
        n = gaussian_filter(rng.standard_normal((size, size)), sig, mode="wrap")
        r = n.ravel().argsort().argsort().reshape(n.shape) / (n.size - 1.0)  # rank transform -> uniform
        return r
    u = tile_noise(1.6)
    strand = tile_noise(0.8) * 0.5 + tile_noise(3.0) * 0.5
    rgb = (0.62 + 0.38 * strand)
    a = 0.5 + 0.5 * u
    out = np.stack([rgb, rgb, rgb, a], -1)
    return Image.fromarray((out * 255).astype(np.uint8), "RGBA")


def write_part(path, meshes, normal_map=True):
    G = bb.GLB(); gl = G.gltf; gl.asset = g.Asset(version="2.0", generator="OAU Life avatar parts builder")
    gl.samplers = [g.Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]
    tn = G.image(bb.png_bytes(fabric_normal().astype(np.uint8)), "image/png") if normal_map else None
    th = G.image(bb.png_bytes(hair_texture()), "image/png") if any(M.get("hairtex") for M in meshes) else None
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
        col = lin(*M["color"])  # colours are given as sRGB 0-255
        if M.get("hairtex"):
            mat = g.Material(name=M["name"], pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=col + [1], baseColorTexture=g.TextureInfo(index=th), metallicFactor=0, roughnessFactor=M["rough"]), alphaMode="MASK", alphaCutoff=0.5, doubleSided=True)
        else:
            mat = g.Material(name=M["name"], pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorFactor=col + [1], metallicFactor=0, roughnessFactor=M["rough"]),
                             **({"normalTexture": g.NormalMaterialTexture(index=tn, scale=0.5)} if normal_map and M.get("fabric", True) else {}))
        gl.materials.append(mat)
        pa = G.acc(M["P"].astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER, True); na = G.acc(M["N"].astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER)
        ua = G.acc(np.stack([M["UV"][:, 0], 1 - M["UV"][:, 1]], 1).astype(np.float32) if not M.get("hairtex") else M["UV"].astype(np.float32), g.FLOAT, g.VEC2, g.ARRAY_BUFFER)
        ja = G.acc(M["J"].astype(np.uint16), g.UNSIGNED_SHORT, g.VEC4, g.ARRAY_BUFFER); wa = G.acc(M["W"].astype(np.float32), g.FLOAT, g.VEC4, g.ARRAY_BUFFER)
        ia = G.acc(M["T"].astype(np.uint32).reshape(-1), g.UNSIGNED_INT, g.SCALAR, g.ELEMENT_ARRAY_BUFFER)
        attrs = dict(POSITION=pa, NORMAL=na, TEXCOORD_0=ua, JOINTS_0=ja, WEIGHTS_0=wa)
        if M.get("C") is not None: attrs["COLOR_0"] = G.acc(M["C"].astype(np.float32), g.FLOAT, g.VEC4, g.ARRAY_BUFFER)
        gl.meshes.append(g.Mesh(name=M["name"], primitives=[g.Primitive(attributes=g.Attributes(**attrs), indices=ia, material=mi)]))
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


def tube_warp(B, r_knee, r_hem, blend=0.30):
    """Turns each leg into a straight trouser leg: the body's own shape blends into a round leg whose radius runs knee -> hem.
    The garment is never allowed inside the body (radius >= 1.03 x the body's), so there is no skin poke-through."""
    def warp(Pn, used):
        out = Pn.copy()
        for side in (1, -1):
            t, leg, topj, ank = leg_t(B, side); t = t[used]; m = leg[used]; tc = np.clip(t, 0, 1)
            knee = B["head"][f"mixamorig:{'Left' if side > 0 else 'Right'}Leg"]; tk = (topj[1] - knee[1]) / (topj[1] - ank[1])  # the axis bends through the knee
            axx = np.interp(tc, [0, tk, 1], [topj[0], knee[0], ank[0]]); axz = np.interp(tc, [0, tk, 1], [topj[2], knee[2], ank[2]])
            dx, dz = out[:, 0] - axx, out[:, 2] - axz; r = np.maximum(np.hypot(dx, dz), 1e-6)
            want = np.interp(tc, [0, tk, 1], [r_knee * 1.12, r_knee, r_hem])
            w = np.clip((tc - 0.02) / blend, 0, 1) ** 1.2; r_new = np.maximum(r * 1.03, (1 - w) * r * 1.03 + w * want)
            out[:, 0] = np.where(m, axx + dx / r * r_new, out[:, 0]); out[:, 2] = np.where(m, axz + dz / r * r_new, out[:, 2])
        return out
    return warp


def refine(M, tri_mask):
    """Midpoint-splits the masked triangles (positions, normals, UVs, skin weights), so a cut line can follow a smooth curve."""
    T = M["T"]; sp = T[tri_mask]; keep = T[~tri_mask]; mid = {}; P, N, UV, J, W = [list(M[k]) for k in ("P", "N", "UV", "J", "W")]; new = []
    def mp(a, b):
        k = (min(a, b), max(a, b))
        if k not in mid:
            mid[k] = len(P); P.append((P[a] + P[b]) / 2); n = N[a] + N[b]; N.append(n / max(np.linalg.norm(n), 1e-9)); UV.append((UV[a] + UV[b]) / 2); src = a if W[a][0] >= W[b][0] else b; J.append(J[src]); W.append(W[src])
        return mid[k]
    for a, b, c in sp:
        ab, bc, ca = mp(a, b), mp(b, c), mp(c, a); new += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
    M["P"], M["N"], M["UV"], M["J"], M["W"] = np.array(P), np.array(N), np.array(UV), np.array(J), np.array(W); M["T"] = np.vstack([keep, np.array(new, int).reshape(-1, 3)]) if new else keep
    return M


def collar(M, neck_y):
    """Cuts a round neckline (lower at the front): the band of triangles along the cut is subdivided twice, then everything above the curve is removed."""
    cut_fn = lambda p: neck_y - 0.004 - 0.028 * np.clip(p[:, 2] / 0.09, 0, 1) ** 2
    for _ in range(2):
        P = M["P"]; d = P[:, 1] - cut_fn(P); band = (np.abs(d[M["T"]]).min(1) < 0.02) & ((d[M["T"]] > -0.03).any(1)) & ((d[M["T"]] < 0.03).any(1)); refine(M, band)
    c = M["P"][M["T"]].mean(1); M["T"] = M["T"][c[:, 1] <= cut_fn(c) + 0.0005]


def cut_sleeve(M, B, side, t_cut):
    """Squares off a sleeve at t_cut (0 shoulder .. 1 wrist) by sliding ARM vertices beyond it back along the arm axis (torso vertices are never touched)."""
    h = B["head"]; s = "Left" if side > 0 else "Right"; a0, a1 = h[f"mixamorig:{s}Arm"], h[f"mixamorig:{s}Hand"]; d = a1 - a0; L = float(d @ d)
    t = ((M["P"] - a0) @ d) / L; dom = np.array([NAMES[i] for i in M["J"][:, 0]]); arm = has(dom, f"{s}Arm", f"{s}ForeArm", f"{s}Hand") & (np.sign(M["P"][:, 0]) == side)
    M["P"] = np.where(((t > t_cut) & arm)[:, None], M["P"] - np.outer(t - t_cut, d), M["P"])


def build_outfit(B):
    F = B["F"]; P = B["P"]; dom = dominant(B); h = B["head"]; y = P[:, 1]
    hips_y, sp_y = h["mixamorig:Hips"][1], h["mixamorig:Spine1"][1]; neck_y = h["mixamorig:Neck"][1]
    torso = has(dom, "Spine", "Shoulder") | (has(dom, "Hips") & (y > hips_y - 0.14)); tL, armL = side_arm_t(B, 1); tR, armR = side_arm_t(B, -1)
    meshes = []
    if not F:
        hem = hips_y - 0.045
        # hoodie: torso + long sleeves to the wrist (navy). Selection is a little generous and then trimmed to clean hem / collar / cuff lines.
        sel = (torso | armL | armR | (has(dom, "UpLeg") & (y > hem - 0.05))) & (y > hem - 0.05) & (y < neck_y + 0.06) & ~has(dom, "Hand", "Head")
        sel &= ~((armL & (tL > 0.95)) | (armR & (tR > 0.95)))
        hz = garment(B, sel, np.full(len(P), 0.028), (38, 50, 84), "Hoodie", 0.95, smooth=6, min_clear=0.018)
        hz["P"][:, 1] = np.maximum(hz["P"][:, 1], hem)  # straight hem
        cut_sleeve(hz, B, 1, 0.90); cut_sleeve(hz, B, -1, 0.90)
        collar(hz, neck_y); meshes.append(hz)
        # straight khaki chinos, slightly tapered
        sel_t = has(dom, "Hips", "UpLeg", "Leg") & (y < hips_y + 0.06) & ~has(dom, "Foot", "Toe")
        ct = garment(B, sel_t, np.full(len(P), 0.007), (122, 108, 84), "Chinos", 0.95, tube_warp(B, 0.083, 0.071), smooth=3, min_clear=0.006)
        ank_y = h["mixamorig:LeftFoot"][1] + 0.035
        ct["P"][:, 1] = np.maximum(ct["P"][:, 1], ank_y); ct["P"][:, 1] = np.minimum(ct["P"][:, 1], hips_y + 0.03); meshes.append(ct)
    else:
        hem = sp_y + 0.01
        sel = (torso | (armL & (tL < 0.45)) | (armR & (tR < 0.45))) & (y > hem - 0.05) & (y < neck_y + 0.06) & ~has(dom, "Hand", "Head")
        top = garment(B, sel, np.full(len(P), 0.0075), (52, 52, 58), "CropTop", 0.9, smooth=2, min_clear=0.005); top["P"][:, 1] = np.maximum(top["P"][:, 1], hem)
        cut_sleeve(top, B, 1, 0.34); cut_sleeve(top, B, -1, 0.34); collar(top, neck_y); meshes.append(top)
        sel_t = has(dom, "Hips", "UpLeg", "Leg") & (y < hips_y + 0.10) & ~has(dom, "Foot", "Toe")
        jn = garment(B, sel_t, np.full(len(P), 0.008), (62, 92, 138), "Jeans", 0.92, tube_warp(B, 0.066, 0.070), smooth=2, min_clear=0.005)
        ank_y = h["mixamorig:LeftFoot"][1] + 0.03; jn["P"][:, 1] = np.maximum(jn["P"][:, 1], ank_y); jn["P"][:, 1] = np.minimum(jn["P"][:, 1], hips_y + 0.075); meshes.append(jn)
    # sneakers: white upper and a grey sole
    foot = has(dom, "Foot", "Toe") | (has(dom, "Leg") & (y < h["mixamorig:LeftFoot"][1] + 0.03) & ~has(dom, "UpLeg"))
    up = garment(B, foot & (y > 0.02), 0.0085, (236, 236, 232), "SneakerUpper", 0.7)
    so = garment(B, foot & (y < 0.04), 0.0155, (140, 144, 150), "SneakerSole", 0.8); so["P"][:, 1] -= 0.006; so["fabric"] = False
    meshes += [up, so]
    return meshes


# ---------------------------------------------------------------- hair
# Hair is built against the REAL scalp: rays are cast from inside the skull to find the exact surface, a smooth hairline curve decides where
# hair grows, and every hair mesh is skinned 100% to the Head bone (long braids blend into the upper back), so it can never float or lag.
HAIR_RGB = (46, 36, 31)
HAIR_SHADE = (0.55, 1.0)


def smoothstep(x):
    x = np.clip(x, 0, 1); return x * x * (3 - 2 * x)


def icos(n_sub=0):
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    f = np.array([[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]])
    return v, f


def rand_rot(rng):
    a = rng.normal(size=3); a /= np.linalg.norm(a); th = rng.random() * 6.28; K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]]); return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * K @ K


def fib_sphere(n):
    i = np.arange(n) + 0.5; phi = np.arccos(1 - 2 * i / n); th = math.pi * (1 + 5 ** 0.5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


class Scalp:
    """The head surface as a ray-castable shell plus the hairline (where hair grows)."""
    def __init__(self, B, nape=-0.075):
        P, T = B["P"], B["T"]; dom = dominant(B); self.B = B; ey = self.ey = B["joints"]["joint-l-eye"][1]
        headv = has(dom, "Head"); ok = headv & (P[:, 1] > ey - 0.13); self.Tp = P[T[ok[T].all(1)]]
        H = P[headv]; self.top = H[:, 1].max(); self.topey = self.top - ey
        ear = H[np.abs(H[:, 0]) > 0.074]; self.ear_top = ear[:, 1].max() - ey; self.zc = 0.5 * (ear[:, 2].min() + ear[:, 2].max())
        self.c = np.array([0.0, ey + 0.02, self.zc]); fh = 0.70 * self.topey; e = self.ear_top
        from scipy.interpolate import PchipInterpolator
        ph = [0, 25, 45, 60, 72, 88, 100, 112, 130, 155, 180]
        hv = [fh, fh - 0.002, fh - 0.012, fh - 0.032, e + 0.012, e + 0.016, e + 0.016, e - 0.004, -0.035, nape + 0.012, nape]
        self.hl = PchipInterpolator(ph, hv)

    def cover(self, S):
        """Metres above the hairline (>0 = hair grows here)."""
        phi = np.degrees(np.abs(np.arctan2(S[:, 0], S[:, 2] - self.zc))); return (S[:, 1] - self.ey) - self.hl(phi)

    def cast(self, org, dr):
        Tp = self.Tp; v0 = Tp[:, 0]; e1 = Tp[:, 1] - v0; e2 = Tp[:, 2] - v0; N = len(org); best = np.full(N, np.inf); bi = np.zeros(N, int)
        for s in range(0, N, 96):
            o = org[s:s + 96, None, :]; d = dr[s:s + 96, None, :]; p = np.cross(d, e2[None]); det = (e1[None] * p).sum(-1); ok_d = np.abs(det) > 1e-12; inv = 1 / np.where(ok_d, det, 1)
            tv = o - v0[None]; u = (tv * p).sum(-1) * inv; q = np.cross(tv, e1[None]); v = (d * q).sum(-1) * inv; t = (e2[None] * q).sum(-1) * inv
            t = np.where(ok_d & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-5), t, np.inf); k = t.argmin(1); best[s:s + 96] = t[np.arange(len(k)), k]; bi[s:s + 96] = k
        return best, bi

    def tri_normal(self, bi, dr):
        Tp = self.Tp[bi]; n = np.cross(Tp[:, 1] - Tp[:, 0], Tp[:, 2] - Tp[:, 0]); n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        return np.where(((n * dr).sum(1) < 0)[:, None], -n, n)

    def from_center(self, d):
        """Scalp points seen from the head centre along unit directions d -> (points, smooth outward normals, valid mask)."""
        org = np.tile(self.c, (len(d), 1)); t, bi = self.cast(org, d); ok = np.isfinite(t); t = np.where(ok, t, 0.1); S = org + d * t[:, None]
        n = self.tri_normal(bi, d); n = 0.5 * n + 0.5 * d; n /= np.linalg.norm(n, axis=1, keepdims=True); return S, n, ok

    def from_above(self, xz):
        org = np.stack([xz[:, 0], np.full(len(xz), self.top + 0.05), xz[:, 1]], 1); dr = np.tile([0.0, -1.0, 0.0], (len(xz), 1)); t, bi = self.cast(org, dr); ok = np.isfinite(t)
        S = org + dr * np.where(ok, t, 0)[:, None]; n = self.tri_normal(bi, dr); return S, n, ok


def skin_head(P, w_neck=None):
    ih, i2 = NAMES.index("mixamorig:Head"), NAMES.index("mixamorig:Spine2")
    J = np.zeros((len(P), 4), np.uint16); W = np.zeros((len(P), 4), np.float32); J[:, 0] = ih; W[:, 0] = 1
    if w_neck is not None:
        a = np.array([w_neck(p) for p in P], np.float32); W[:, 0] = 1 - a; J[:, 1] = i2; W[:, 1] = a
    return J, W


def blob_mesh(centers, radii, scales=None, rots=None, soft=None, name="Hair", rng=None, rough=0.82, w_neck=None):
    """Many small smooth blobs (curls, plait segments) merged into one mesh. `soft` = outward direction per blob blended into the normals so the
    clump shades as one soft volume instead of faceted pebbles."""
    rng = rng or np.random.default_rng(1); v0, f0 = icos(); Ps, Ns, Ts, Cs = [], [], [], []; base = 0
    for i, c in enumerate(centers):
        s = np.array(scales[i] if scales is not None else [1, 1, 1]) * radii[i]; R = rots[i] if rots is not None else np.eye(3)
        p = (v0 * s) @ R.T + c; n = (v0 / s) @ R.T; n /= np.linalg.norm(n, axis=1, keepdims=True)
        if soft is not None: n = 0.6 * soft[i] + 0.4 * n; n /= np.linalg.norm(n, axis=1, keepdims=True)
        Ps.append(p); Ns.append(n); Ts.append(f0 + base); base += len(v0)
        k = rng.uniform(*HAIR_SHADE) * (0.75 + 0.25 * np.clip(0.5 + 0.5 * (p[:, 1] - c[1]) / max(radii[i], 1e-4), 0, 1)); Cs.append(np.stack([k, k, k, np.ones_like(k)], 1))
    P = np.vstack(Ps); J, W = skin_head(P, w_neck)
    return dict(name=name, P=P, N=np.vstack(Ns), UV=np.zeros((len(P), 2)), T=np.vstack(Ts), J=J, W=W, C=np.vstack(Cs), color=HAIR_RGB, rough=rough, fabric=False)


def hair_cap(sc, name, thick_fn, amax_fn=None, hairline_soft=0.024):
    """The scalp 'skull cap': the head's own triangles above the hairline, lifted off the skin, with a dithered, strand-like hairline."""
    B = sc.B; P, N, T = B["P"], B["N"], B["T"]; dom = dominant(B); ok = has(dom, "Head") & (P[:, 1] > sc.ey - 0.13)
    f = sc.cover(P); tri = T[ok[T].all(1) & (f[T] > -0.003).any(1)]; idx = tri.reshape(-1)
    Pv, Nv, fv = P[idx], N[idx], f[idx]; fn = np.cross(Pv[1::3] - Pv[0::3], Pv[2::3] - Pv[0::3]); ax = np.abs(fn).argmax(1); ax3 = np.repeat(ax, 3)
    S = 40.0; uv = np.where((ax3 == 1)[:, None], Pv[:, [0, 2]], np.where((ax3 == 0)[:, None], Pv[:, [2, 1]], Pv[:, [0, 1]])) * S
    pos = Pv + Nv * thick_fn(fv, Pv)[:, None]; a = np.clip(0.5 + fv / hairline_soft, 0, 1)
    if amax_fn is not None: a = np.minimum(a, amax_fn(Pv))
    C = np.stack([np.ones_like(a), np.ones_like(a), np.ones_like(a), a], 1)
    return dict(name=name, P=pos, N=Nv, UV=uv, T=np.arange(len(idx)).reshape(-1, 3), J=B["J"][idx], W=B["W"][idx], C=C, color=HAIR_RGB, rough=0.78, fabric=False, hairtex=True)


def hair_parts(B, style):
    sc = Scalp(B, nape=-0.085 if style in ("afro", "braids") else -0.072); ey = sc.ey; rng = np.random.default_rng(7); out = []
    if style == "lowcut":
        taper = ey + 0.052  # above this the hair is longer; below it is a close fade
        out.append(hair_cap(sc, "HairCap", lambda f, p: 0.0022 + 0.0035 * smoothstep((p[:, 1] - taper) / 0.03) * smoothstep(f / 0.02), lambda p: np.where(p[:, 1] < taper, 0.86, 1.0)))
        D = fib_sphere(6000); D = D[D[:, 1] > 0.15]; S, n, ok = sc.from_center(D); cov = sc.cover(S); m = ok & (cov > 0.012) & (S[:, 1] > taper - 0.004)
        S, n, cov = S[m], n[m], cov[m]; pick = rng.permutation(len(S))[:700]; S, n, cov = S[pick], n[pick], cov[pick]
        R = rng.uniform(0.0055, 0.0078, len(S)) * (0.55 + 0.45 * smoothstep(cov / 0.03)); C = S + n * (R[:, None] * 0.55)
        out.append(blob_mesh(C, R, rots=[rand_rot(rng) for _ in C], soft=n, rng=rng, name="Curls"))
    elif style == "afro":
        out.append(hair_cap(sc, "HairCap", lambda f, p: 0.0045 * smoothstep(f / 0.02) + 0.002, None))
        D = fib_sphere(16000); D = D[D[:, 1] > -0.55]; S, n, ok = sc.from_center(D); cov = sc.cover(S); m = ok & (cov > 0.003); S, n, cov, D = S[m], n[m], cov[m], D[m]
        T = 0.050 * smoothstep(cov / 0.045) * (1 + 0.30 * np.clip(D[:, 1], 0, 1)) + 0.004
        order = rng.permutation(len(S)); outer, inner = order[:1500], order[1500:2150]; C, R, SO = [], [], []
        for i in outer: C.append(S[i] + D[i] * T[i] * rng.uniform(0.70, 1.0)); R.append(rng.uniform(0.0125, 0.0175) * (0.6 + 0.4 * smoothstep(cov[i] / 0.03))); SO.append(D[i])
        for i in inner: C.append(S[i] + D[i] * T[i] * rng.uniform(0.2, 0.55)); R.append(rng.uniform(0.010, 0.014)); SO.append(D[i])
        C = np.array(C); out.append(blob_mesh(C, R, rots=[rand_rot(rng) for _ in C], soft=np.array(SO), rng=rng, name="Curls"))
    elif style == "braids":
        out.append(hair_cap(sc, "HairCap", lambda f, p: 0.0030 * smoothstep(f / 0.02) + 0.0015, None))
        h = B["head"]; neck_y = h["mixamorig:Neck"][1]; hips_y = h["mixamorig:Hips"][1]; end_y = hips_y + 0.12; back = P_ALL[0]
        # cornrows: parallel rows running front to back over the skull, following the real surface
        CC, CR, CS, CM, ends = [], [], [], [], []
        for xi in np.linspace(-0.060, 0.060, 9):
            zs = np.arange(-0.05, 0.17, 0.0050); S, n, ok = sc.from_above(np.stack([np.full(len(zs), xi), zs], 1)); cov = sc.cover(S); m = ok & (cov > 0.004)
            if m.sum() < 4: continue
            S, n = S[m], n[m]; tan = np.gradient(S, axis=0); tan /= np.maximum(np.linalg.norm(tan, axis=1, keepdims=True), 1e-9); ends.append(S[0] + n[0] * 0.003)
            for k in range(len(S)):
                b = np.cross(tan[k], n[k]); b /= max(np.linalg.norm(b), 1e-9); nn = np.cross(b, tan[k]); Rm = np.stack([b, nn, tan[k]], 1); sgn = 1 if k % 2 else -1
                CC.append(S[k] + n[k] * 0.0056 + b * 0.0013 * sgn); CR.append(0.0064); CS.append([1, 1, 1.45]); CM.append(Rm)
        out.append(blob_mesh(np.array(CC), CR, scales=CS, rots=CM, rng=rng, name="Cornrows"))
        # long braids: root on the scalp (back half), hang behind the neck and follow the back
        def back_z(x, yy):
            m = (np.abs(back[:, 0] - x) < 0.04) & (np.abs(back[:, 1] - yy) < 0.03) & (back[:, 2] < 0.05); return back[m][:, 2].min() if m.any() else None
        D = fib_sphere(9000); D = D[(D[:, 2] < -0.40)]; S, n, ok = sc.from_center(D); cov = sc.cover(S)
        m = ok & (cov > 0.012) & (S[:, 1] - ey < 0.035) & (S[:, 1] - ey > -0.055); S, n = S[m], n[m]
        roots = [e for e in ends if e[1] - ey < 0.06]; roots = list(ends) + [S[i] for i in rng.permutation(len(S))[:42]]
        C2, R2, S2, M2 = [], [], [], []
        for r0 in roots:
            x0, y0, z0 = r0; L = rng.uniform(0.86, 1.0) * (y0 - end_y); segs = int(L / 0.0088)
            for k in range(segs):
                t = k / segs; s = k * 0.0088; yy = y0 - s
                x = x0 * (1 + 0.45 * min(1, s * 6)) * (1 - 0.25 * t); zb0 = back_z(x, yy); zb = (zb0 if zb0 is not None else z0 - 0.03) - 0.011; zb = max(zb, z0 - 0.07)
                z = min(z0 - 0.012 * min(1, s * 10), zb) if yy < neck_y + 0.03 else z0 - 0.012 * min(1, s * 10)
                ang = 0.5 * (1 if k % 2 else -1); Rz = np.array([[math.cos(ang), -math.sin(ang), 0], [math.sin(ang), math.cos(ang), 0], [0, 0, 1]])
                C2.append([x + (0.0020 if k % 2 else -0.0020), yy, z]); R2.append(0.0046 * (1 - 0.35 * smoothstep((t - 0.88) / 0.12))); S2.append([1, 1.6, 1]); M2.append(Rz)
        def wfn(p): return float(np.clip((neck_y + 0.04 - p[1]) / 0.1, 0, 1))
        out.append(blob_mesh(np.array(C2), R2, scales=S2, rots=M2, rng=rng, name="Braids", w_neck=wfn))
    return out


P_ALL = [None]


def main():
    which = _extra[0] if _extra else "all"
    for gender, tag in (("M", "m"), ("F", "f")):
        B = load(gender); path_heads[0] = B["head"]; P_ALL[0] = B["P"]
        if which in ("all", "outfit"): write_part(f"{OUT}/parts/outfit/campus_{tag}.glb", build_outfit(B))
        styles = ["lowcut", "afro"] if gender == "M" else ["braids", "afro"]
        if which in ("all", "hair"):
            for st in styles: write_part(f"{OUT}/parts/hair/{st}_{tag}.glb", hair_parts(B, st), normal_map=False)


if __name__ == "__main__": main()

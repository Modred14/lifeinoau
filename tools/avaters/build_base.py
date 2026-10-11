# tools/avaters/build_base.py
"""
Builds rigged GLB avatar bodies for OAU Life from the MPFB2 / MakeHuman base assets (CC0).

Usage:  python3 tools/avatars/build_base.py <path to mpfb2 repo>/src/mpfb/data <output dir> [M|F|both]

What it makes (per gender):
  <out>/base_male.glb, base_female.glb   body + eyes + Mixamo-named skeleton + idle/walk clips
The skin texture is a light neutral (the game tints it with the chosen skin tone), with brows, lips and
pores baked in from 3D positions. Needs: numpy, Pillow, pygltflib.
"""
import sys, os, gzip, json, math, struct, io
import numpy as np
from PIL import Image, ImageFilter
import pygltflib as g

DATA = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mpfb/src/mpfb/data"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/avatars"
WHICH = sys.argv[3] if len(sys.argv) > 3 else "both"
TEX = 2048


# ---------------------------------------------------------------- source mesh
def load_obj(path):
    V, VT, faces, gnames = [], [], [], []
    cur = None
    for l in open(path):
        if l.startswith("v "): V.append([float(x) for x in l.split()[1:4]])
        elif l.startswith("vt "): VT.append([float(x) for x in l.split()[1:3]])
        elif l.startswith(("g ", "o ")): cur = l.split()[1]
        elif l.startswith("f "):
            idx = [tuple(int(p) - 1 for p in t.split("/")[:2]) for t in l.split()[1:]]
            faces.append(idx); gnames.append(cur)
    return np.array(V), np.array(VT), faces, gnames


def load_target(path, n):
    d = np.zeros((n, 3))
    for l in gzip.open(path, "rt"):
        s = l.split()
        if len(s) == 4 and not l.startswith("#"): d[int(s[0])] = [float(x) for x in s[1:]]
    return d



# ---------------------------------------------------------------- MakeHuman macro model + detail targets
# ROOT CAUSE FIX: the old build applied only the "african-<gender>-young" race delta. MakeHuman's real macro model is the SUM of
#   universal-<gender>-<age>-<muscle>-<weight>  (the gender/age/muscle/weight shape: shoulders, jaw, chest, hips ...)  and
#   <race>-<gender>-<age>                       (the ethnic delta on top of it)
# so without the universal target the "male" kept the neutral base's narrow shoulders and soft androgynous face.
def T(path, n, cache={}):
    k = (path, n)
    if k not in cache: cache[k] = load_target(f"{DATA}/targets/{path}.target.gz", n)
    return cache[k]


def macro_deltas(female, n, muscle=None, weight=0.5):
    """Sum of macro targets. muscle/weight are MakeHuman sliders (0..1, 0.5 = average)."""
    gdr = "female" if female else "male"
    muscle = (0.5 if female else 0.60) if muscle is None else muscle
    mw = {"minmuscle": max(0, (0.5 - muscle) * 2), "maxmuscle": max(0, (muscle - 0.5) * 2)}; mw["averagemuscle"] = 1 - mw["minmuscle"] - mw["maxmuscle"]
    ww = {"minweight": max(0, (0.5 - weight) * 2), "maxweight": max(0, (weight - 0.5) * 2)}; ww["averageweight"] = 1 - ww["minweight"] - ww["maxweight"]
    d = np.zeros((n, 3))
    for m, wm in mw.items():
        for w, ww_ in ww.items():
            if wm * ww_ > 1e-6: d += wm * ww_ * T(f"macrodetails/universal-{gdr}-young-{m}-{w}", n)
    d += T(f"macrodetails/african-{gdr}-young", n)
    return d


# per-character face / body detail targets (name -> weight; negative = the "-decr" side). Applied on top of the macro model.
DETAILS = {
    "M": {  # young Nigerian man: defined jaw, square-ish chin, strong brow, broad flat-ish nose, full lips, solid neck, V-shaped torso
        "head/head-oval": 0.0, "head/head-rectangular": 0.25, "head/head-square": 0.20, "head/head-scale-horiz": 0.10, "head/head-scale-vert": -0.20,
        "forehead/forehead-scale-vert": -0.25, "eyes/l-eye-scale": 0.20, "eyes/r-eye-scale": 0.20, "nose/nose-scale-vert": -0.25, "nose/nose-scale-depth": -0.15,
        "mouth/mouth-scale-depth": -0.30,
        "chin/chin-width": 0.35, "chin/chin-prominent": 0.30, "chin/chin-height": 0.10, "chin/chin-jaw-drop": -0.15, "chin/chin-bones": 0.45,
        "cheek/l-cheek-bones": 0.22, "cheek/r-cheek-bones": 0.22,
        "forehead/forehead-nubian": 0.30, "forehead/forehead-temple": -0.15,
        "nose/nose-width1": 0.20, "nose/nose-width3": 0.30, "nose/nose-flaring": 0.30, "nose/nose-volume": 0.15,
        "mouth/mouth-lowerlip-volume": 0.10, "mouth/mouth-upperlip-volume": 0.10, "mouth/mouth-scale-horiz": 0.08,
        "eyebrows/eyebrows-trans-down": 0.25, "eyebrows/eyebrows-angle-down": 0.15,
        "neck/neck-scale-horiz": 0.35, "neck/neck-scale-vert": -0.05,
        "torso/torso-vshape": 0.55, "torso/torso-scale-horiz": 0.12, "torso/torso-muscle-pectoral": 0.25, "torso/torso-muscle-dorsi": 0.25,
        "arms/l-upperarm-muscle": 0.2, "arms/r-upperarm-muscle": 0.2, "arms/l-lowerarm-muscle": 0.2, "arms/r-lowerarm-muscle": 0.2,
        "hands/l-hand-scale": 0.10, "hands/r-hand-scale": 0.10, "hip/hip-scale-horiz": -0.12,
        "legs/l-lowerleg-muscle": 0.15, "legs/r-lowerleg-muscle": 0.15, "legs/l-upperleg-muscle": 0.12, "legs/r-upperleg-muscle": 0.12,
    },
    "F": {  # young Nigerian woman: soft oval face, full lips, defined brows, narrow waist
        "head/head-oval": 0.30, "cheek/l-cheek-bones": 0.12, "cheek/r-cheek-bones": 0.12,
        "nose/nose-width3": 0.12, "nose/nose-flaring": 0.15,
        "mouth/mouth-lowerlip-volume": 0.10, "mouth/mouth-upperlip-volume": 0.08,
        "eyes/l-eye-scale": 0.10, "eyes/r-eye-scale": 0.10, "mouth/mouth-scale-depth": -0.20,
    },
}


def detail_deltas(gender, n, scale=1.0):
    d = np.zeros((n, 3))
    for name, w in DETAILS[gender].items():
        if abs(w) < 1e-6: continue
        folder, base = name.split("/"); side = "incr" if w > 0 else "decr"
        path = f"{folder}/{base}-{side}"
        if not os.path.exists(f"{DATA}/targets/{path}.target.gz"):
            alt = f"{folder}/{base}"
            if os.path.exists(f"{DATA}/targets/{alt}.target.gz"): path = alt
            else: print("  missing target", path); continue
        d += abs(w) * scale * T(path, n)
    return d


# ---------------------------------------------------------------- helpers
def qaxis(axis, ang):
    a = np.array(axis, float); a /= np.linalg.norm(a); s = math.sin(ang / 2)
    return [a[0] * s, a[1] * s, a[2] * s, math.cos(ang / 2)]


def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz]


def png_bytes(arr_or_img, fmt="PNG", quality=92):
    im = arr_or_img if isinstance(arr_or_img, Image.Image) else Image.fromarray(arr_or_img)
    b = io.BytesIO(); im.save(b, fmt, **({"quality": quality} if fmt == "JPEG" else {})); return b.getvalue()


def smooth_normals(P, tris):
    N = np.zeros_like(P)
    a, b, c = P[tris[:, 0]], P[tris[:, 1]], P[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    for k in range(3): np.add.at(N, tris[:, k], fn)
    return N / np.maximum(np.linalg.norm(N, axis=1, keepdims=True), 1e-9)


# ---------------------------------------------------------------- texture baking from 3D positions
def rasterize_positions(uv, tris, P, size):
    """Position map: for each texel, the 3D point on the mesh (or NaN)."""
    pm = np.full((size, size, 3), np.nan, np.float32)
    px = np.stack([uv[:, 0] * (size - 1), (1 - uv[:, 1]) * (size - 1)], 1)
    for t in tris:
        a, b, c = px[t]; x0, x1 = int(max(0, min(a[0], b[0], c[0]))), int(min(size - 1, max(a[0], b[0], c[0])) + 1)
        y0, y1 = int(max(0, min(a[1], b[1], c[1]))), int(min(size - 1, max(a[1], b[1], c[1])) + 1)
        if x1 <= x0 or y1 <= y0: continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(d) < 1e-9: continue
        l1 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / d
        l2 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / d
        l3 = 1 - l1 - l2; m = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
        if not m.any(): continue
        pos = l1[..., None] * P[t[0]] + l2[..., None] * P[t[1]] + l3[..., None] * P[t[2]]
        yy, xx = ys[m], xs[m]; pm[yy, xx] = pos[m]
    return pm


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay; L = dx * dx + dy * dy + 1e-12
    t = np.clip(((px - ax) * dx + (py - ay) * dy) / L, 0, 1)
    return np.hypot(px - (ax + t * dx), py - (ay + t * dy)), t


def _lowfreq(size, cells, rng):
    return np.array(Image.fromarray((rng.random((cells, cells)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC), np.float32) / 255


def _ell(X, Y, cx, cy, rx, ry):
    return np.clip(1 - np.hypot((X - cx) / rx, (Y - cy) / ry), 0, 1)


def build_skin_maps(pm, J, female):
    """Neutral light albedo (the game tints it with the chosen skin tone) + roughness map. Everything is painted relative to the tone, from 3D
    positions, so features sit exactly on the geometry: tonal variation, under-eye shadow, cheek warmth, nostrils, natural lips, a real
    brow with hair strokes, a lash line, stubble for the man, and a rougher/oilier map (T-zone shine, matte cheeks, glossy lips)."""
    size = pm.shape[0]; ok = ~np.isnan(pm[..., 0]); X, Y, Z = pm[..., 0], pm[..., 1], pm[..., 2]
    rng = np.random.default_rng(3); img = np.ones((size, size, 3), np.float32); rough = np.full((size, size), 0.60, np.float32)
    lo = _lowfreq(size, 48, rng); mid = _lowfreq(size, 220, rng); hi = _lowfreq(size, 700, rng)
    tone = (0.955 + 0.06 * lo + 0.03 * mid + 0.015 * hi); img *= tone[..., None]
    img *= (np.array([1.0, 0.985, 0.97], np.float32) + (lo - 0.5)[..., None] * np.array([0.03, 0.0, -0.03], np.float32))  # warm/cool drift
    rough += (mid - 0.5) * 0.12 + (hi - 0.5) * 0.06
    nt = J["nose-tip"]; front = (Z > nt[2] - 0.06) & ok
    # --- face anatomy
    for s in (-1, 1):
        E = J["joint-l-eye"] if s > 0 else J["joint-r-eye"]; ex = E[0]
        bag = _ell(X, Y, ex, E[1] - 0.0145, 0.021, 0.0085) * front; img *= (1 - 0.075 * bag)[..., None] * np.array([1.0, 0.985, 1.0], np.float32)[None, None]  # under-eye
        cheek = _ell(X, Y, s * 0.047, nt[1] + 0.001, 0.034, 0.028) * front; img *= (1 - 0.04 * cheek)[..., None] * np.array([1.0, 0.97, 0.96], np.float32)  # warm cheeks
        rough -= 0.07 * _ell(X, Y, s * 0.047, nt[1] + 0.012, 0.03, 0.02) * front  # cheekbone shine
        nost = _ell(X, Y, s * 0.0105, nt[1] - 0.0045, 0.0075, 0.0042) * front; img *= (1 - 0.40 * nost)[..., None]  # nostrils
        alar = _ell(X, Y, s * 0.019, nt[1] - 0.001, 0.009, 0.010) * front; img *= (1 - 0.04 * alar)[..., None] * np.array([1.0, 0.97, 0.96], np.float32)
    rough -= 0.13 * _ell(X, Y, 0.0, nt[1] + 0.065, 0.045, 0.025) * front   # forehead
    rough -= 0.15 * _ell(X, Y, 0.0, nt[1] + 0.004, 0.012, 0.030) * front   # nose bridge / tip
    rough -= 0.05 * _ell(X, Y, 0.0, nt[1] - 0.075, 0.022, 0.014) * front   # chin
    # --- lips: natural tone relative to the skin, soft edge, a mouth line and fine vertical lines
    my = nt[1] - 0.030; mw = 0.0255 if not female else 0.0245
    up = _ell(X, Y, 0.0, my + 0.0075, mw, 0.0105); lw = _ell(X, Y, 0.0, my - 0.0085, mw * 0.92, 0.0125); lip = np.clip(up + lw, 0, 1) ** 0.6 * front
    lipc = np.array([0.93, 0.74, 0.72], np.float32) if not female else np.array([0.90, 0.66, 0.68], np.float32)
    img = img * (1 - lip[..., None]) + img * lipc * lip[..., None]
    img *= (1 - 0.06 * lip * (0.5 + 0.5 * np.sin(X * 2.0 * math.pi / 0.0012)))[..., None]
    line = np.clip(1 - np.abs(Y - (my + 0.0003)) / 0.0010, 0, 1) * (np.abs(X) < mw * 0.95) * front * (1 - 0.7 * np.clip(np.abs(X) / mw, 0, 1) ** 4); img *= (1 - 0.45 * line)[..., None]
    rough = np.where(lip > 0.15, 0.50 + (mid - 0.5) * 0.1, rough)
    # --- eyebrows (hair strokes) and a lash line
    for s in (-1, 1):
        E = J["joint-l-eye"] if s > 0 else J["joint-r-eye"]; ex = E[0]
        base_y = E[1] + (0.0225 if female else 0.0185); arch = 0.0085 if female else 0.0045; thick = 0.0031 if female else 0.0052
        inner, outer = ex - s * 0.019, ex + s * 0.034; n = 28; xs_ = np.linspace(inner, outer, n); t_ = np.linspace(0, 1, n)
        ys_ = base_y + arch * np.sin(t_ * math.pi * 0.85) - 0.0026 * t_
        d = np.full(X.shape, 1e9, np.float32); tt = np.zeros(X.shape, np.float32)
        for i in range(n - 1):
            dd, t = seg_dist(X, Y, xs_[i], ys_[i], xs_[i + 1], ys_[i + 1]); m = dd < d; d = np.where(m, dd, d); tt = np.where(m, t_[i] + t * (t_[i + 1] - t_[i]), tt)
        w = thick * (1.0 - 0.50 * tt) * (0.85 + 0.15 * (1 - tt)); br = np.clip((w - d) / 0.0022, 0, 1) ** 1.2 * (Z > E[2] - 0.004) * ok
        strokes = 0.55 + 0.45 * _lowfreq(size, 900, np.random.default_rng(11)); br *= np.clip(strokes * 1.25, 0, 1)
        img = img * (1 - 0.92 * br[..., None]) + img * np.array([0.30, 0.26, 0.25], np.float32) * (0.92 * br[..., None])
        rim = np.hypot((X - ex) / 0.0158, (Y - (E[1] + 0.0008)) / 0.0074); lash = np.clip(1 - np.abs(rim - 1.02) / 0.20, 0, 1) * (Y > E[1] - 0.0004) * (Z > E[2] - 0.006) * ok
        img *= (1 - 0.62 * lash)[..., None]
        lid = np.clip(1.30 - np.hypot((X - ex) / 0.0240, (Y - (E[1] + 0.002)) / 0.0150), 0, 1) * (Z > E[2] - 0.006) * ok; img *= (1 - 0.10 * lid)[..., None]
    # --- stubble / short beard shadow (man)
    if not female:
        reg = np.clip((nt[1] - 0.010 - Y) / 0.012, 0, 1) * np.clip((Y - (nt[1] - 0.105)) / 0.020, 0, 1) * np.clip((0.092 - np.abs(X)) / 0.020, 0, 1) * (Z > -0.01) * ok
        reg = reg * (1 - 0.8 * lip) * (1 - 0.6 * np.clip(_ell(X, Y, 0.0, nt[1] - 0.016, 0.022, 0.012), 0, 1) * 0.0)
        side = np.clip((np.abs(X) - 0.060) / 0.015, 0, 1) * np.clip((Y - (nt[1] - 0.060)) / 0.02, 0, 1) * np.clip((nt[1] + 0.018 - Y) / 0.02, 0, 1) * (Z > 0.0) * ok  # sideburn/cheek
        reg = np.clip(reg + 0.6 * side, 0, 1)
        stip = (np.random.default_rng(5).random((size, size)) > 0.50).astype(np.float32); stip = np.array(Image.fromarray((stip * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255
        img *= (1 - reg * (0.07 + 0.22 * stip))[..., None]; rough += 0.05 * reg
    # --- joints / extremities: slightly darker knuckles, elbows, knees
    for nm in ("joint-l-elbow", "joint-r-elbow", "joint-l-knee", "joint-r-knee"):
        if nm in J: pj = J[nm]; r = np.sqrt((X - pj[0]) ** 2 + (Y - pj[1]) ** 2 + (Z - pj[2]) ** 2); img *= (1 - 0.07 * np.clip(1 - r / 0.045, 0, 1) * ok)[..., None]
    img = np.nan_to_num(img, nan=1.0); img[~ok] = 1.0; rough = np.where(ok, np.nan_to_num(rough, nan=0.6), 0.6)  # texels outside the UV islands stay neutral (no mirror-smooth seams)
    return (np.clip(img, 0, 1) * 255).astype(np.uint8), (np.clip(rough, 0.3, 0.9) * 255).astype(np.uint8)


def build_normal(size, seed=5):
    """Tangent-space normal map of fine pores and skin grain (neutral where flat)."""
    rng = np.random.default_rng(seed)
    h = np.zeros((size, size), np.float32)
    for sc, amp in ((1, 0.6), (2, 0.5), (5, 0.35), (12, 0.25)):
        n = rng.standard_normal((size // sc + 2, size // sc + 2)).astype(np.float32)
        h += amp * np.array(Image.fromarray(((n - n.min()) / (np.ptp(n)) * 255).astype(np.uint8)).resize((size, size), Image.BICUBIC), np.float32) / 255
    pores = (rng.random((size, size)) > 0.9975).astype(np.float32)
    pores = np.array(Image.fromarray((pores * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255
    h = h - 0.9 * pores / max(1e-6, pores.max())
    gy, gx = np.gradient(h); k = 0.55
    nx, ny, nz = -gx * k, gy * k, np.ones_like(h); L = np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5
    return (out * 255).astype(np.uint8)


def build_eye_texture():
    W, H = 512, 256
    im = Image.new("RGB", (W, H), (236, 232, 226)); px = im.load()
    rng = np.random.default_rng(9); cx, cy = W // 2, H // 2
    for y in range(H):
        for x in range(W):
            dx, dy = (x - cx), (y - cy); r = math.hypot(dx, dy)
            if r < 44:
                ang = math.atan2(dy, dx); fib = 0.5 + 0.5 * math.sin(ang * 23 + r * 0.35) * math.cos(ang * 7)
                base = np.array([84, 52, 28]) * (0.72 + 0.5 * fib) + np.array([30, 18, 6]) * (1 - r / 44)
                if r < 15: base = np.array([8, 6, 6])
                elif r > 38: base = base * 0.45
                px[x, y] = tuple(int(max(0, min(255, v))) for v in base)
            elif r < 60:
                f = (r - 44) / 16; px[x, y] = tuple(int(c * (0.78 + 0.22 * f) + 0) for c in (236, 232, 226))
            else:
                v = (rng.random() * 12) if (x * 13 + y * 7) % 41 == 0 else 0
                px[x, y] = (int(232 - v), int(224 - v * 2), int(218 - v * 2))
    return im.filter(ImageFilter.GaussianBlur(0.8))


def uv_sphere(center, radius, rings=24, segs=40):
    P, UV, T = [], [], []
    for i in range(rings + 1):
        v = i / rings; phi = (v - 0.5) * math.pi
        for j in range(segs + 1):
            u = j / segs; th = (u - 0.5) * 2 * math.pi  # theta 0 = +z (front)
            d = np.array([math.cos(phi) * math.sin(th), math.sin(phi), math.cos(phi) * math.cos(th)])
            P.append(np.array(center) + radius * d); UV.append([u, 1 - v])
    for i in range(rings):
        for j in range(segs):
            a = i * (segs + 1) + j; b = a + segs + 1
            T += [[a, a + 1, b], [a + 1, b + 1, b]]
    P = np.array(P); N = (P - np.array(center)) / radius
    return P, N, np.array(UV), np.array(T)


# ---------------------------------------------------------------- glTF writer
class GLB:
    def __init__(self): self.gltf = g.GLTF2(); self.buf = bytearray(); self.gltf.scenes = [g.Scene(nodes=[])]; self.gltf.scene = 0
    def _view(self, data, target=None):
        while len(self.buf) % 4: self.buf.append(0)
        self.gltf.bufferViews.append(g.BufferView(buffer=0, byteOffset=len(self.buf), byteLength=len(data), target=target)); self.buf += data
        return len(self.gltf.bufferViews) - 1
    def acc(self, arr, ctype, atype, target=None, minmax=False):
        arr = np.ascontiguousarray(arr); v = self._view(arr.tobytes(), target)
        a = g.Accessor(bufferView=v, componentType=ctype, count=len(arr), type=atype)
        if minmax: a.min = arr.min(0).tolist(); a.max = arr.max(0).tolist()
        self.gltf.accessors.append(a); return len(self.gltf.accessors) - 1
    def image(self, data, mime):
        v = self._view(data); self.gltf.images.append(g.Image(bufferView=v, mimeType=mime)); self.gltf.textures.append(g.Texture(source=len(self.gltf.images) - 1, sampler=0))
        return len(self.gltf.textures) - 1
    def save(self, path):
        self.gltf.buffers = [g.Buffer(byteLength=len(self.buf))]; self.gltf.set_binary_blob(bytes(self.buf)); self.gltf.save_binary(path)


# ---------------------------------------------------------------- build one body
def build(gender):
    female = gender == "F"
    V, VT, faces, gnames = load_obj(f"{DATA}/3dobjs/base.obj")
    V = V + macro_deltas(female, len(V)) + detail_deltas(gender, len(V))
    V = V * 0.1  # decimetres -> metres
    if not female: V = V * 0.975  # young adult man ~1.77 m (the raw macro model is a little tall)
    body_idx = [i for i, n in enumerate(gnames) if n == "body"]
    P0 = V.copy()
    # group -> vertex ids (joints, eyes)
    gv = {}
    for f, n in zip(faces, gnames): gv.setdefault(n, set()).update(p[0] for p in f)
    ymin = P0[sorted(gv.get("body", []))][:, 1].min(); P0[:, 1] -= ymin
    J = {n: P0[sorted(v)].mean(0) for n, v in gv.items() if n.startswith("joint-")}
    # the nose tip anchors the face landmarks (the mesh's mouth joint sits inside the head, so it cannot place the lips)
    ey = J["joint-l-eye"][1]; body_ids = np.array(sorted(gv["body"])); Pb = P0[body_ids]
    sel = (np.abs(Pb[:, 0]) < 0.02) & (Pb[:, 1] > ey - 0.07) & (Pb[:, 1] < ey + 0.01); J["nose-tip"] = Pb[np.argmax(np.where(sel, Pb[:, 2], -9))]
    # skeleton
    rig = json.load(open(f"{DATA}/rigs/standard/rig.mixamo.json"))["bones"]
    names = []; 
    def add_bone(n):
        if n in names or n == "": return
        add_bone(rig[n]["parent"]); names.append(n)
    for n in sorted(rig): add_bone(n)
    def pos(spec):
        if spec["strategy"] == "CUBE": return J[spec["cube_name"]]
        if spec["strategy"] == "MEAN": return P0[spec["vertex_indices"]].mean(0)
        return np.array(spec["default_position"]) * 1.0
    head = {n: pos(rig[n]["head"]) for n in names}
    # weights
    W = json.load(open(f"{DATA}/rigs/standard/weights.mixamo.json"))["weights"]
    nv = len(P0); influences = [[] for _ in range(nv)]
    for b, lst in W.items():
        if b not in names: continue
        for vi, w in lst:
            if vi < nv: influences[vi].append((names.index(b), w))
    # body mesh (split vertices by (v, vt))
    key2new = {}; Pn, UVn, tris = [], [], []; orig = []
    for fi in body_idx:
        f = faces[fi]; ids = []
        for vi, ti in f:
            k = (vi, ti)
            if k not in key2new: key2new[k] = len(Pn); Pn.append(P0[vi]); UVn.append([VT[ti][0], VT[ti][1]]); orig.append(vi)
            ids.append(key2new[k])
        for k in range(1, len(ids) - 1): tris.append([ids[0], ids[k], ids[k + 1]])
    Pn, UVn, tris, orig = np.array(Pn), np.array(UVn), np.array(tris), np.array(orig)
    Nn = smooth_normals(Pn, tris)
    # unify normals across split vertices
    acc = {}; 
    for i, o in enumerate(orig): acc.setdefault(o, []).append(i)
    for o, ids in acc.items():
        if len(ids) > 1:
            m = Nn[ids].sum(0); m /= max(1e-9, np.linalg.norm(m)); Nn[ids] = m
    JOINTS = np.zeros((len(Pn), 4), np.uint16); WEIGHTS = np.zeros((len(Pn), 4), np.float32)
    for i, o in enumerate(orig):
        inf = sorted(influences[o], key=lambda x: -x[1])[:4]
        if not inf: inf = [(names.index("mixamorig:Hips"), 1.0)]
        tot = sum(w for _, w in inf)
        for k, (b, w) in enumerate(inf): JOINTS[i, k] = b; WEIGHTS[i, k] = w / tot
    # textures
    pm = rasterize_positions(UVn, tris, Pn, TEX)
    albedo, roughmap = build_skin_maps(pm, J, female); normal = build_normal(1024)
    eye_tex = build_eye_texture()
    # eyes (rigid on the head bone)
    eyes = []
    for s, n in ((1, "helper-l-eye"), (-1, "helper-r-eye")):
        pts = P0[sorted(gv[n])]; c = pts.mean(0) + np.array([0, 0, 0.0012]); r = float(np.ptp(pts, axis=0).max()) / 2 * 1.04
        eyes.append((c, r))
    # ----- glTF
    G = GLB(); gl = G.gltf; gl.asset = g.Asset(version="2.0", generator="OAU Life avatar builder (MPFB2/MakeHuman CC0 base)")
    gl.samplers = [g.Sampler(magFilter=9729, minFilter=9987, wrapS=10497, wrapT=10497)]
    mr = np.zeros(roughmap.shape + (3,), np.uint8); mr[..., 0] = 255; mr[..., 1] = roughmap  # glTF: G = roughness, B = metalness (0)
    t_alb = G.image(png_bytes(Image.fromarray(albedo), "JPEG", 88), "image/jpeg"); t_nrm = G.image(png_bytes(normal, "JPEG", 90), "image/jpeg"); t_mr = G.image(png_bytes(Image.fromarray(mr).resize((1024, 1024), Image.LANCZOS), "JPEG", 90), "image/jpeg"); t_eye = G.image(png_bytes(eye_tex), "image/png")
    gl.materials = [
        g.Material(name="skin", pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorTexture=g.TextureInfo(index=t_alb), baseColorFactor=[0.55, 0.36, 0.25, 1], metallicFactor=0, roughnessFactor=1.0, metallicRoughnessTexture=g.TextureInfo(index=t_mr)), normalTexture=g.NormalMaterialTexture(index=t_nrm, scale=0.75)),
        g.Material(name="eye", pbrMetallicRoughness=g.PbrMetallicRoughness(baseColorTexture=g.TextureInfo(index=t_eye), metallicFactor=0, roughnessFactor=0.12)),
    ]
    # nodes: bones
    nodes = []; idx = {}
    for n in names:
        idx[n] = len(nodes); nodes.append(g.Node(name=n, children=[]))
    root_bones = []
    for n in names:
        par = rig[n]["parent"]
        if par == "": nodes[idx[n]].translation = head[n].tolist(); root_bones.append(idx[n])
        else: nodes[idx[n]].translation = (head[n] - head[par]).tolist(); nodes[idx[par]].children.append(idx[n])
    ibm = np.zeros((len(names), 4, 4), np.float32)
    for i, n in enumerate(names): m = np.eye(4); m[:3, 3] = -head[n]; ibm[i] = m.T
    ibm_acc = G.acc(ibm.reshape(-1, 16), g.FLOAT, g.MAT4)
    # body mesh node
    pos_a = G.acc(Pn.astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER, True); nor_a = G.acc(Nn.astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER)
    uv_a = G.acc(np.stack([UVn[:, 0], 1 - UVn[:, 1]], 1).astype(np.float32), g.FLOAT, g.VEC2, g.ARRAY_BUFFER)
    j_a = G.acc(JOINTS, g.UNSIGNED_SHORT, g.VEC4, g.ARRAY_BUFFER); w_a = G.acc(WEIGHTS, g.FLOAT, g.VEC4, g.ARRAY_BUFFER)
    i_a = G.acc(tris.astype(np.uint32).reshape(-1), g.UNSIGNED_INT, g.SCALAR, g.ELEMENT_ARRAY_BUFFER)
    gl.meshes.append(g.Mesh(name="Body", primitives=[g.Primitive(attributes=g.Attributes(POSITION=pos_a, NORMAL=nor_a, TEXCOORD_0=uv_a, JOINTS_0=j_a, WEIGHTS_0=w_a), indices=i_a, material=0)]))
    body_node = len(nodes); nodes.append(g.Node(name="Body", mesh=0, skin=0))
    gl.skins = [g.Skin(name="Armature", joints=[idx[n] for n in names], skeleton=root_bones[0], inverseBindMatrices=ibm_acc)]
    # eyes as rigid meshes under the head bone
    hb = idx["mixamorig:Head"]
    for k, (c, r) in enumerate(eyes):
        Pe, Ne, UVe, Te = uv_sphere(c - head["mixamorig:Head"], r)
        pa = G.acc(Pe.astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER, True); na = G.acc(Ne.astype(np.float32), g.FLOAT, g.VEC3, g.ARRAY_BUFFER); ua = G.acc(UVe.astype(np.float32), g.FLOAT, g.VEC2, g.ARRAY_BUFFER)
        ia = G.acc(Te.astype(np.uint32).reshape(-1), g.UNSIGNED_INT, g.SCALAR, g.ELEMENT_ARRAY_BUFFER)
        gl.meshes.append(g.Mesh(name=f"Eye{k}", primitives=[g.Primitive(attributes=g.Attributes(POSITION=pa, NORMAL=na, TEXCOORD_0=ua), indices=ia, material=1)]))
        nodes[hb].children.append(len(nodes)); nodes.append(g.Node(name=f"Eye{k}", mesh=len(gl.meshes) - 1))
    gl.nodes = nodes; gl.scenes[0].nodes = root_bones + [body_node]
    add_clips(G, names, idx, head, female)
    os.makedirs(OUT, exist_ok=True); path = f"{OUT}/base_{'female' if female else 'male'}.glb"; G.save(path)
    meta = {"joints": {k: v.tolist() for k, v in J.items()}, "head": {k: v.tolist() for k, v in head.items()}, "eyes": [(c.tolist(), r) for c, r in eyes]}
    json.dump(meta, open(f"{OUT}/meta_{gender}.json", "w"))
    np.savez(f"{OUT}/body_{gender}.npz", P=Pn, N=Nn, UV=UVn, T=tris, J=JOINTS, W=WEIGHTS, orig=orig, P0=P0)
    print(path, os.path.getsize(path) // 1024, "KB", len(Pn), "verts", len(tris), "tris", len(names), "bones")


# ---------------------------------------------------------------- animation clips (bones are world-aligned at rest, T-pose)
def add_clips(G, names, idx, head, female):
    gl = G.gltf; gl.animations = []
    def clip(name, dur, frames, track):
        ts = np.linspace(0, dur, frames, endpoint=False).astype(np.float32); ts = np.append(ts, np.float32(dur)); tin = G.acc(ts, g.FLOAT, g.SCALAR, minmax=True)
        samplers, channels = [], []
        for bone, path, fn in track:
            vals = np.array([fn(t / dur) for t in ts], np.float32); out = G.acc(vals, g.FLOAT, g.VEC4 if path == "rotation" else g.VEC3)
            samplers.append(g.AnimationSampler(input=tin, output=out, interpolation="LINEAR")); channels.append(g.AnimationChannel(sampler=len(samplers) - 1, target=g.AnimationChannelTarget(node=idx["mixamorig:" + bone], path=path)))
        gl.animations.append(g.Animation(name=name, samplers=samplers, channels=channels))
    z, y, x = (0, 0, 1), (0, 1, 0), (1, 0, 0)
    # the base mesh rests in an A-pose: measure the arm angle from the skeleton and only add what is needed to hang the arms at the sides
    la = head["mixamorig:LeftForeArm"] - head["mixamorig:LeftArm"]; from_vertical = math.atan2(abs(la[0]), -la[1])
    ARM = max(0.0, from_vertical - math.radians(9))
    def arm_down(side, extra=0.0, fwd=0.0):  # side: 1 left (+x), -1 right
        q = qaxis((0, 0, 1), -side * ARM)
        q = qmul(q, qaxis((0, 1, 0), -side * 0.0))
        return qmul(qaxis(x, extra), q) if extra else q
    def fore(side, bend): return qaxis((0, 1, 0), -side * bend)
    def rot(a): return [float(v) for v in a]
    breathe = lambda t, a: math.sin(t * 2 * math.pi) * a
    idle = [
        ("LeftArm", "rotation", lambda t: rot(qmul(qaxis(x, 0.03 * breathe(t, 1)), qaxis(z, -ARM)))),
        ("RightArm", "rotation", lambda t: rot(qmul(qaxis(x, 0.03 * breathe(t, 1)), qaxis(z, ARM)))),
        ("LeftForeArm", "rotation", lambda t: rot(fore(1, 0.18 + 0.02 * breathe(t, 1)))),
        ("RightForeArm", "rotation", lambda t: rot(fore(-1, 0.18 + 0.02 * breathe(t, 1)))),
        ("Spine1", "rotation", lambda t: rot(qaxis(x, 0.012 * breathe(t, 1)))),
        ("Spine2", "rotation", lambda t: rot(qaxis(x, 0.012 * breathe(t, 1)))),
        ("Head", "rotation", lambda t: rot(qmul(qaxis(y, 0.05 * math.sin(t * 2 * math.pi)), qaxis(x, -0.012 * breathe(t, 1))))),
    ]
    clip("idle", 4.0, 24, idle)
    hips0 = head["mixamorig:Hips"]
    def sw(t, ph=0.0): return math.sin(t * 2 * math.pi + ph)
    walk = [
        ("Hips", "translation", lambda t: (hips0 + np.array([0, 0.018 * abs(math.cos(t * 2 * math.pi)) - 0.01, 0])).tolist()),
        ("Hips", "rotation", lambda t: rot(qaxis(y, 0.07 * sw(t)))),
        ("Spine1", "rotation", lambda t: rot(qaxis(y, -0.09 * sw(t)))),
        ("LeftUpLeg", "rotation", lambda t: rot(qaxis(x, 0.5 * sw(t)))), ("RightUpLeg", "rotation", lambda t: rot(qaxis(x, -0.5 * sw(t)))),
        ("LeftLeg", "rotation", lambda t: rot(qaxis(x, 0.05 + 0.55 * max(0, -math.cos(t * 2 * math.pi - 0.4))))),
        ("RightLeg", "rotation", lambda t: rot(qaxis(x, 0.05 + 0.55 * max(0, math.cos(t * 2 * math.pi - 0.4))))),
        ("LeftArm", "rotation", lambda t: rot(qmul(qaxis(x, -0.45 * sw(t)), qaxis(z, -ARM)))), ("RightArm", "rotation", lambda t: rot(qmul(qaxis(x, 0.45 * sw(t)), qaxis(z, ARM)))),
        ("LeftForeArm", "rotation", lambda t: rot(fore(1, 0.35 + 0.15 * max(0, sw(t))))), ("RightForeArm", "rotation", lambda t: rot(fore(-1, 0.35 + 0.15 * max(0, -sw(t))))),
        ("Head", "rotation", lambda t: rot(qaxis(y, -0.04 * sw(t)))),
    ]
    clip("walk", 1.0, 20, walk)


if __name__ == "__main__":
    for gdr in (["M", "F"] if WHICH == "both" else [WHICH]): build(gdr)

// lib3d/campuslife/buildings/mesh.js
// Ported from campus/client/game/buildings/mesh.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
export const UP = [0, 1, 0];
export const DOWN = [0, -1, 0];
function faces(a, b, c, hint) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    return (uy * vz - uz * vy) * hint[0] + (uz * vx - ux * vz) * hint[1] + (ux * vy - uy * vx) * hint[2] >= 0;
}
function vertex(buf, p, u, v, c) {
    buf.pos.push(p[0], p[1], p[2]);
    buf.uv.push(u, v);
    buf.col.push(c[0], c[1], c[2]);
}
export function quadUv(buf, p, uv, col, hint) {
    const base = buf.pos.length / 3;
    for (let i = 0; i < 4; i++)
        vertex(buf, p[i], uv[i][0], uv[i][1], col[i]);
    if (faces(p[0], p[1], p[2], hint))
        buf.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else
        buf.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
export function quad(buf, a, b, c, d, uv, low, high, hint) {
    quadUv(buf, [a, b, c, d], [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]], [low, low, high, high], hint);
}
export function tri(buf, p, uv, col, hint) {
    const base = buf.pos.length / 3;
    for (let i = 0; i < 3; i++)
        vertex(buf, p[i], uv[i][0], uv[i][1], col[i]);
    if (faces(p[0], p[1], p[2], hint))
        buf.idx.push(base, base + 1, base + 2);
    else
        buf.idx.push(base, base + 2, base + 1);
}
export function wall(buf, a, b, y0, y1, uv, low, high, normal) {
    quad(buf, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], uv, low, high, [normal[0], 0, normal[1]]);
}
export function prism(buf, base, y0, y1, style) {
    const n = base.length;
    let cx = 0, cz = 0;
    for (const p of base) {
        cx += p[0] / n;
        cz += p[1] / n;
    }
    for (let i = 0; i < n; i++) {
        const a = base[i];
        const b = base[(i + 1) % n];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < 0.01)
            continue;
        const uv = style.sideUv?.(i, length);
        if (uv === null)
            continue;
        wall(buf, a, b, y0, y1, uv ?? style.flat, style.side, style.side, [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz]);
    }
    const flat = [style.flat[0], style.flat[1]];
    for (const [color, y, hint] of [[style.top, y1, UP], [style.bottom, y0, DOWN]]) {
        if (!color)
            continue;
        for (let i = 1; i + 1 < n; i++) {
            tri(buf, [[base[0][0], y, base[0][1]], [base[i][0], y, base[i][1]], [base[i + 1][0], y, base[i + 1][1]]], [flat, flat, flat], [color, color, color], hint);
        }
    }
}
export function ring(cx, cz, radius, segments, turn = 0) {
    const out = [];
    for (let i = 0; i < segments; i++) {
        const a = turn + (i / segments) * Math.PI * 2;
        out.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
    }
    return out;
}
export function spire(buf, base, y, apex, color, flat) {
    const uv = [flat[0], flat[1]];
    for (let i = 0; i < base.length; i++) {
        const a = base[i];
        const b = base[(i + 1) % base.length];
        const hint = [(a[0] + b[0]) / 2 - apex[0], 0.5, (a[1] + b[1]) / 2 - apex[2]];
        tri(buf, [[a[0], y, a[1]], [b[0], y, b[1]], apex], [uv, uv, uv], [color, color, color], hint);
    }
}
export function dome(buf, cx, cz, y, radius, color, flat, segments = 8, rings = 3) {
    const uv = [flat[0], flat[1]];
    for (let r = 0; r < rings; r++) {
        const a0 = (r / rings) * Math.PI * 0.5;
        const a1 = ((r + 1) / rings) * Math.PI * 0.5;
        const low = ring(cx, cz, Math.cos(a0) * radius, segments);
        const y0 = y + Math.sin(a0) * radius;
        if (r === rings - 1) {
            spire(buf, low, y0, [cx, y + radius, cz], color, flat);
            continue;
        }
        const high = ring(cx, cz, Math.cos(a1) * radius, segments);
        const y1 = y + Math.sin(a1) * radius;
        for (let i = 0; i < segments; i++) {
            const j = (i + 1) % segments;
            const hint = [low[i][0] + low[j][0] - 2 * cx, 0.6, low[i][1] + low[j][1] - 2 * cz];
            quadUv(buf, [[low[i][0], y0, low[i][1]], [low[j][0], y0, low[j][1]], [high[j][0], y1, high[j][1]], [high[i][0], y1, high[i][1]]], [uv, uv, uv, uv], [color, color, color, color], hint);
        }
    }
}
export function beam(buf, a, b, width, color, flat) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.01)
        return;
    const horizontal = Math.hypot(dx, dz);
    const u = horizontal > 0.001 ? [-dz / horizontal, 0, dx / horizontal] : [1, 0, 0];
    const v = [(dy * u[2] - dz * u[1]) / length, (dz * u[0] - dx * u[2]) / length, (dx * u[1] - dy * u[0]) / length];
    const corners = (p) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [p[0] + (u[0] * s + v[0] * t) * width / 2, p[1] + (u[1] * s + v[1] * t) * width / 2, p[2] + (u[2] * s + v[2] * t) * width / 2]);
    const low = corners(a), high = corners(b);
    for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        const hint = [low[i][0] + low[j][0] - 2 * a[0], low[i][1] + low[j][1] - 2 * a[1], low[i][2] + low[j][2] - 2 * a[2]];
        quad(buf, low[i], low[j], high[j], high[i], flat, color, color, hint);
    }
    quad(buf, low[3], low[2], low[1], low[0], flat, color, color, [-dx, -dy, -dz]);
    quad(buf, high[0], high[1], high[2], high[3], flat, color, color, [dx, dy, dz]);
}

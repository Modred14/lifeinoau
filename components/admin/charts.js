// components/admin/charts.js — small SVG charts, flat colours only. Every chart has a text alternative and a hover/focus readout.
"use client";
import { useState } from "react";

const W = 640, H = 200, P = { l: 34, r: 8, t: 10, b: 22 };
const nice = (m) => { if (m <= 5) return 5; const p = 10 ** Math.floor(Math.log10(m)), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };

/** Daily series: bars (counts per day). data = [{ day, n }] */
export function DayBars({ data, color = "var(--gold)", label }) {
  const [hi, setHi] = useState(null), max = nice(Math.max(1, ...data.map((d) => d.n))), iw = W - P.l - P.r, ih = H - P.t - P.b, bw = iw / data.length;
  const y = (v) => P.t + ih - (v / max) * ih, total = data.reduce((s, d) => s + d.n, 0), cur = hi != null ? data[hi] : null;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${total} in total over ${data.length} days`} style={{ width: "100%", height: "auto", display: "block" }}>
        <g className="grid">{[0, 0.5, 1].map((t) => <g key={t}><line x1={P.l} x2={W - P.r} y1={y(max * t)} y2={y(max * t)} /><text x={P.l - 6} y={y(max * t) + 3} textAnchor="end">{Math.round(max * t)}</text></g>)}</g>
        {data.map((d, i) => <g key={d.day} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(i)} onBlur={() => setHi(null)} tabIndex={0} aria-label={`${d.day}: ${d.n}`}>
          <rect x={P.l + i * bw} y={P.t} width={bw} height={ih} fill="transparent" />
          <rect x={P.l + i * bw + bw * 0.14} width={bw * 0.72} y={y(d.n)} height={Math.max(d.n ? 2 : 0, P.t + ih - y(d.n))} rx="2" fill={color} opacity={hi == null || hi === i ? 1 : 0.45} /></g>)}
        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => <text key={i} x={P.l + i * bw + bw / 2} y={H - 6} textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}>{data[i].day.slice(5)}</text>)}
      </svg>
      <figcaption className="mut" style={{ minHeight: 20, fontSize: ".8rem" }}>{cur ? `${cur.day}: ${cur.n.toLocaleString()}` : `${total.toLocaleString()} in the last ${data.length} days`}</figcaption>
    </figure>
  );
}

/** Horizontal bars for a distribution. rows = [{ label, value (number), text, title }] */
export function HBars({ rows, color = "var(--gold)" }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return <div style={{ display: "grid", gap: 9 }}>{rows.map((r) => <div key={r.label} title={r.title} style={{ display: "grid", gridTemplateColumns: "118px 1fr 56px", gap: 10, alignItems: "center", fontSize: ".82rem" }}>
    <span className="mut">{r.label}</span><div className="bar" role="img" aria-label={`${r.label}: ${r.text}`}><i style={{ width: `${(r.value / max) * 100}%`, background: color }} /></div><b className="num" style={{ textAlign: "right" }}>{r.text}</b></div>)}</div>;
}

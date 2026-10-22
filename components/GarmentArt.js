// components/GarmentArt.js
// A flat illustration of a catalog item for shop cards and the wardrobe grid: the SAME garment base, colour and fabric finish the 3D character is built from
// (lib/wardrobe.js), so the picture and the avatar always agree. The 3D try-on is on the item's page; this is the quick, light thumbnail.
"use client";
import { useId } from "react";
import { COLORS } from "@/lib/look";

const OUT = "rgba(0,0,0,0.28)";
// Silhouettes on a 120-wide canvas. Tops sit in y 8..104, bottoms in y 8..112.
const TOPS = {
  tee: { d: "M38 16 L50 11 Q60 22 70 11 L82 16 L102 38 L89 49 L80 42 L80 100 L40 100 L40 42 L31 49 L18 38 Z", extra: () => <path d="M50 11 Q60 22 70 11" fill="none" stroke={OUT} strokeWidth="2" /> },
  hoodie: { d: "M36 20 L50 13 L70 13 L84 20 L104 52 L91 62 L80 50 L80 102 L40 102 L40 50 L29 62 L16 52 Z",
    extra: () => <><path d="M46 14 Q60 -2 74 14 Q60 30 46 14Z" fill="rgba(0,0,0,0.12)" stroke={OUT} strokeWidth="2" /><path d="M42 72 H78 L82 98 H38 Z" fill="rgba(0,0,0,0.1)" stroke={OUT} strokeWidth="1.6" /><path d="M55 26 V44 M65 26 V44" stroke="rgba(255,255,255,0.7)" strokeWidth="2" /></> },
  croptop: { d: "M40 18 L51 13 Q60 23 69 13 L80 18 L98 36 L87 45 L80 40 L80 70 L40 70 L40 40 L33 45 L22 36 Z", extra: () => <path d="M51 13 Q60 23 69 13" fill="none" stroke={OUT} strokeWidth="2" /> },
  shirt: { d: "M36 18 L50 12 L60 20 L70 12 L84 18 L104 70 L92 74 L80 44 L80 102 L40 102 L40 44 L28 74 L16 70 Z",
    extra: () => <><path d="M50 12 L60 34 L70 12 L60 20Z" fill="rgba(255,255,255,0.35)" stroke={OUT} strokeWidth="1.6" /><path d="M60 34 V102" stroke={OUT} strokeWidth="1.4" strokeDasharray="3 5" /></> },
  blouse: { d: "M38 18 L50 12 Q60 24 70 12 L82 18 L100 56 L90 62 L80 44 L80 98 L40 98 L40 44 L30 62 L20 56 Z",
    extra: () => <><path d="M60 22 L48 30 L54 36 L60 26 L66 36 L72 30Z" fill="rgba(0,0,0,0.16)" stroke={OUT} strokeWidth="1.6" /><circle cx="60" cy="26" r="3" fill="rgba(0,0,0,0.25)" /></> },
  tunic: { d: "M38 14 L50 10 Q60 20 70 10 L82 14 L104 44 L92 54 L82 44 L84 112 L36 112 L38 44 L28 54 L16 44 Z",
    extra: () => <><path d="M50 10 Q60 20 70 10" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" /><path d="M60 20 V50" stroke="rgba(255,255,255,0.6)" strokeWidth="2" /><path d="M36 112 H84" stroke="rgba(255,255,255,0.55)" strokeWidth="3" /></> },
  buba: { d: "M40 14 L51 10 Q60 22 69 10 L80 14 L112 70 L96 80 L80 50 L84 92 L36 92 L40 50 L24 80 L8 70 Z",
    extra: () => <><path d="M51 10 Q60 22 69 10" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="3" /><path d="M8 70 L24 80 M112 70 L96 80" stroke="rgba(255,255,255,0.6)" strokeWidth="3" /></> },
};
const BOTTOMS = {
  jeans: { d: "M38 8 H82 L87 112 H62 L60 46 L58 112 H33 Z", extra: () => <><path d="M38 8 L41 22 H60 M82 8 L79 22 H60" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeDasharray="3 3" /><path d="M60 22 V46" stroke={OUT} strokeWidth="1.5" /></> },
  chinos: { d: "M38 8 H82 L86 112 H63 L60 48 L57 112 H34 Z", extra: () => <><path d="M38 16 H82" stroke={OUT} strokeWidth="3" /><path d="M46 20 L44 40 M74 20 L76 40" stroke={OUT} strokeWidth="1.5" fill="none" /></> },
  suit: { d: "M38 8 H82 L85 112 H63 L60 48 L57 112 H35 Z", extra: () => <><path d="M38 14 H82" stroke={OUT} strokeWidth="2.4" /><path d="M48 24 V108 M72 24 V108" stroke="rgba(255,255,255,0.35)" strokeWidth="1.6" /></> },
  dress: { d: "M38 8 H82 L86 112 H63 L60 48 L57 112 H34 Z", extra: () => <><path d="M38 14 H82" stroke="rgba(255,255,255,0.7)" strokeWidth="3" /><path d="M34 108 H57 M63 108 H86" stroke="rgba(255,255,255,0.55)" strokeWidth="3" /></> },
  work: { d: "M37 8 H83 L89 112 H62 L60 48 L58 112 H31 Z", extra: () => <><rect x="38" y="60" width="16" height="16" rx="2" fill="rgba(0,0,0,0.12)" stroke={OUT} strokeWidth="1.5" /><rect x="66" y="60" width="16" height="16" rx="2" fill="rgba(0,0,0,0.12)" stroke={OUT} strokeWidth="1.5" /><path d="M37 16 H83" stroke={OUT} strokeWidth="3" /></> },
  shorts: { d: "M38 8 H82 L88 66 H62 L60 38 L58 66 H32 Z", extra: () => <path d="M38 8 L41 22 H60 M82 8 L79 22 H60" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" strokeDasharray="3 3" /> },
  pencil: { d: "M40 8 H80 L85 104 H35 Z", extra: () => <><path d="M40 14 H80" stroke={OUT} strokeWidth="2.4" /><path d="M60 80 V104" stroke={OUT} strokeWidth="1.6" /></> },
  iro: { d: "M40 8 H80 L98 112 H22 Z", extra: () => <><path d="M40 8 L70 112" stroke={OUT} strokeWidth="1.6" fill="none" /><path d="M30 100 H90" stroke="rgba(255,255,255,0.5)" strokeWidth="3" /></> },
};

/** Sheen and stitching that tell the fabrics apart at a glance. */
function Finish({ finish, id, d }) {
  if (finish === "satin" || finish === "silk" || finish === "leather") {
    const a = finish === "silk" ? 0.5 : finish === "leather" ? 0.38 : 0.34;
    return (<><defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.32" stopColor="#fff" stopOpacity={a} /><stop offset="0.5" stopColor="#fff" stopOpacity="0" /><stop offset="0.72" stopColor="#fff" stopOpacity={a * 0.6} /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs><path d={d} fill={`url(#${id})`} /></>);
  }
  if (finish === "denim") return <path d={d} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.2" strokeDasharray="1.5 3" />;
  return null;
}

function Piece({ slot, part, id }) {
  const g = (slot === "top" ? TOPS : BOTTOMS)[part.base];
  if (!g) return null;
  return (<g><path d={g.d} fill={COLORS[part.color] ?? "#888"} stroke={OUT} strokeWidth="2" strokeLinejoin="round" /><Finish finish={part.finish} id={id} d={g.d} />{g.extra()}</g>);
}

/** parts = item.parts ({ top?, bottom? }). A set shows both pieces, top over bottom. */
export default function GarmentArt({ parts, size = "100%", label }) {
  const uid = useId().replace(/:/g, ""), both = !!(parts.top && parts.bottom);
  return (
    <svg viewBox={both ? "0 0 120 134" : "0 0 120 120"} width={size} height={size} role="img" aria-label={label} style={{ display: "block" }}>
      {both ? (<>
        <g transform="translate(24 2) scale(0.6)"><Piece slot="top" part={parts.top} id={uid + "t"} /></g>
        <g transform="translate(24 62) scale(0.6)"><Piece slot="bottom" part={parts.bottom} id={uid + "b"} /></g>
      </>) : parts.top ? <Piece slot="top" part={parts.top} id={uid + "t"} /> : <Piece slot="bottom" part={parts.bottom} id={uid + "b"} />}
    </svg>
  );
}

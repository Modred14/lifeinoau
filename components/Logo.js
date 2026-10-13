// components/Logo.js
// The lifeinoau mark as inline SVG. Sharp at any size, no image request.
//   <Logo size={28} />                       height in px (width follows the artwork's ratio)
//   <Logo size={160} sunClass="dim">…</Logo>  children are drawn on top of the sun (the error page's cloud)
import { LOGO_VIEWBOX, LOGO_RATIO, LOGO_INK, LOGO_GOLD, LOGO_SUN, LOGO_PARTS } from "./logoData";

export default function Logo({ size = 32, title, className = "", sunClass = "", ink = LOGO_INK, children }) {
  const all = Object.values(LOGO_PARTS).flat();
  return (
    <svg
      className={className || undefined}
      viewBox={LOGO_VIEWBOX}
      width={Math.round(size * LOGO_RATIO)}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g fill={ink} fillRule="evenodd">
        {all.map((d, i) => <path key={i} d={d} />)}
      </g>
      <circle className={sunClass || undefined} cx={LOGO_SUN.cx} cy={LOGO_SUN.cy} r={LOGO_SUN.r} fill={LOGO_GOLD} />
      {children}
    </svg>
  );
}
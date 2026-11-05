// lib/money.js: the one place that turns a money amount into compact display text (3 significant figures).
// DISPLAY ONLY. It never returns a number and never touches the stored value. Math is done on BigInt, so floats cannot skew a digit.
const SUFFIX = ["", "k", "M", "B", "T"];

/** Whole units (naira) as a BigInt, from a bigint, an integer-like number or a numeric string. Fractions are cut off, like the existing naira(). */
function toBig(v) {
  if (typeof v === "bigint") return v;
  const n = typeof v === "string" ? Number(v.replace(/[,\s₦]/g, "")) : Number(v);
  if (!Number.isFinite(n)) return 0n;
  return BigInt(Math.trunc(n));
}

/** 3 significant figures, half-up: 7820 -> "7.82k", 12500 -> "12.5k", 100000 -> "100k", 1000000 -> "1.00M", 999999 -> "1.00M".
 *  Under 1,000 the amount is shown as is. Above 999T it stays in T with grouping ("1,250T"). Negative amounts keep their sign. */
export function compactNumber(value) {
  let n = toBig(value);
  const neg = n < 0n;
  if (neg) n = -n;
  const sign = neg ? "-" : "";
  if (n < 1000n) return sign + n.toString();
  let tier = 1;
  while (tier < 4 && n >= 10n ** BigInt(3 * (tier + 1))) tier++;
  const unit = 10n ** BigInt(3 * tier);
  // digits of the leading part, scaled so we keep 3 significant figures: (n / unit) has 1-3 integer digits
  const intDigits = (n / unit).toString().length;
  if (tier === 4 && intDigits > 3) { // beyond 999T: still 3 significant figures, in T, grouped ("1,230T")
    const step = 10n ** BigInt(intDigits - 3);
    const t = ((n * 2n + unit * step) / (unit * step * 2n)) * step;
    return sign + t.toLocaleString("en-NG") + "T";
  }
  let decimals = Math.max(0, 3 - intDigits);
  let scale = 10n ** BigInt(decimals);
  let scaled = (n * scale * 2n + unit) / (unit * 2n); // round half up
  if (decimals > 0 && scaled.toString().length > 3) { // 99.95k rounds to 100.0k: that is 4 figures, so drop a decimal
    decimals--; scale = 10n ** BigInt(decimals);
    scaled = (n * scale * 2n + unit) / (unit * 2n);
  }
  // rounding can carry into the next tier (999.9k -> 1.00M)
  if (tier < 4 && scaled >= 1000n * scale) return sign + compactNumber(10n ** BigInt(3 * (tier + 1)));
  const s = scaled.toString().padStart(decimals + 1, "0");
  const body = decimals ? s.slice(0, s.length - decimals) + "." + s.slice(s.length - decimals) : s;
  return sign + body + SUFFIX[tier];
}

/** Money from whole naira: compactMoney(7820) -> "₦7.82k". */
export const compactMoney = (naira) => {
  const t = compactNumber(naira);
  return t.startsWith("-") ? "-₦" + t.slice(1) : "₦" + t;
};

/** Money from kobo (the stored unit): compactKobo(782000n) -> "₦7.82k". */
export const compactKobo = (kobo) => compactMoney(toBig(kobo) / 100n);

/** Full precision, for echoing back an amount the player just typed and for screen-reader labels: exactKobo(123400n) -> "₦1,234". */
export const exactKobo = (kobo) => {
  const n = toBig(kobo) / 100n;
  return (n < 0n ? "-₦" : "₦") + (n < 0n ? -n : n).toLocaleString("en-NG");
};

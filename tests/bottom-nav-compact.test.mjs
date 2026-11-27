// The bottom bar is one size everywhere (components/bottom-nav.css): avatar + pill + phone, the same inside buildings as outside. Static checks on the stylesheet; the rendered geometry is checked in a browser.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../components/bottom-nav.css", import.meta.url), "utf8");
const block = (sel) => { const i = css.indexOf(sel + " {"); assert.ok(i >= 0, `missing ${sel}`); return css.slice(i, css.indexOf("\n}", i)); };
const root = block(":root");
const tok = (b, n) => b.match(new RegExp("--" + n + ": *([^;]+);"))?.[1].trim();

for (const [n, v] of [["nav-bar-h", "54px"], ["nav-btn-h", "46px"], ["nav-gap", "8px"], ["nav-w", "372px"], ["nav-pad", "3px"], ["nav-ico", "22px"], ["nav-dock-pad", "4px 8px"]]) assert.equal(tok(root, n), v, `--${n} is ${v}`);
// one size: no building-only override of the tokens, and the only media rule touching them slims the bar for everyone on a phone held sideways
assert.ok(!/body\[data-inside\] *\{/.test(css), "the bar has no separate in-building size");
for (const m of css.matchAll(/@media \(max-height: 480px\) \{([^}]*\{[^}]*\})/g)) assert.match(m[1], /^\s*:root/, "a breakpoint may only change the shared tokens");
assert.ok(!/@media[^{]*min-width[^{]*\{\s*:root/.test(css), "no width breakpoint redefines the tokens");
// sizes are tokens, not literals, so no state can quietly bring back a different bar
const rules = css.slice(css.indexOf(".nav {"), css.indexOf("/* ---- the layers that must leave room"));
for (const re of [/min-height: *\d+px/, /\.nav svg \{[^}]*width: *\d+px/, /\.nav-pill \{[^}]*padding: *\d+px/]) assert.ok(!re.test(rules), `size literal in the shared rules: ${re}`);
assert.match(css, /\.nav-phone:not\(:where\(\.campus-world \*\)\) \{[^}]*min-height: 0/, "the shared button skin's 44px min-height must not reach the handset");
assert.match(css, /\.nav \.nav-me \{[^}]*min-height: 0/, "nor the avatar button");
assert.match(css, /body\[data-dock="on"\] \.nav \.nav-me \{[^}]*calc\(var\(--nav-bar-h\) - 8px\)/, "docked, the avatar fits the bar's padding");
console.log("bottom-nav-compact.test ok");

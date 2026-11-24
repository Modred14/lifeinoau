// The bottom bar is compact everywhere except inside a building (components/bottom-nav.css). Static checks on the stylesheet; the rendered geometry is checked in a browser by the harness described in the PR.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const css = readFileSync(new URL("../components/bottom-nav.css", import.meta.url), "utf8");
const block = (sel) => { const i = css.indexOf(sel + " {"); assert.ok(i >= 0, `missing ${sel}`); return css.slice(i, css.indexOf("\n}", i)); };
const root = block(":root"), inside = block("body[data-inside]");
const tok = (b, n) => b.match(new RegExp("--" + n + ": *([^;]+);"))?.[1].trim();

// compact outside buildings: 2px left/right, 1px top/bottom
assert.equal(tok(root, "nav-pad"), "1px 2px", "bar padding is 1px (top/bottom) and 2px (left/right)");
assert.equal(tok(root, "nav-dock-pad"), "1px 2px", "the docked bar has the same padding");
assert.equal(tok(root, "nav-bar-h"), "32px"); assert.equal(tok(root, "nav-btn-h"), "28px");
// inside a building: the original numbers
for (const [n, v] of [["nav-bar-h", "44px"], ["nav-btn-h", "36px"], ["nav-gap", "6px"], ["nav-w", "300px"], ["nav-pad", "3px"], ["nav-tab-px", "10px"], ["nav-ico", "20px"], ["nh-u", "1px"], ["nav-dock-pad", "3px"]]) assert.equal(tok(inside, n), v, `inside a building --${n} stays ${v}`);
assert.match(inside, /--nav-h: var\(--nav-band\)/, "the pages' --nav-h follows the room's own band");
// the compact tokens are never raised by a breakpoint; the only media rule touching them is the room's
for (const m of css.matchAll(/@media \(max-height: 480px\) \{([^}]*\{[^}]*\})/g)) assert.match(m[1], /^\s*body\[data-inside\]/, "a breakpoint may only change the in-building bar");
assert.ok(!/@media[^{]*min-width[^{]*\{\s*:root/.test(css), "no width breakpoint redefines the compact tokens");
// sizes are tokens, not literals, so no state can quietly bring back a big bar
const rules = css.slice(css.indexOf(".nav {"), css.indexOf("/* ---- the layers that must leave room"));
for (const re of [/min-height: *\d+px/, /\.nav svg \{[^}]*width: *\d+px/, /\.nav-pill \{[^}]*padding: *\d+px/]) assert.ok(!re.test(rules), `size literal in the shared rules: ${re}`);
assert.match(css, /\.nav-phone:not\(:where\(\.campus-world \*\)\) \{[^}]*min-height: 0/, "the shared button skin's 44px min-height must not reach the handset");
console.log("bottom-nav-compact.test ok");

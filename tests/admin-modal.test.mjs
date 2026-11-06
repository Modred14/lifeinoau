// tests/admin-modal.test.mjs — guards the admin dialog architecture (static checks, no browser needed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const kit = readFileSync(new URL("../components/admin/kit.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/admin/admin.css", import.meta.url), "utf8");

test("Modal renders through a portal into document.body", () => {
  assert.match(kit, /createPortal\(/);
  assert.match(kit, /className="adm adm-portal"/);
});
test("Modal never closes while a request is in flight and yields Escape to confirm dialogs", () => {
  assert.match(kit, /busyRef\.current/);
  assert.match(kit, /\.cd-scrim/);
});
test("every top-level admin rule is scoped under .adm (or is a unique .adm-* frame class)", () => {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  const bad = [];
  for (const m of body.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)) for (const s of m[1].split(",").map((x) => x.trim()).filter(Boolean)) if (!/^\.adm/.test(s)) bad.push(s);
  assert.deepEqual(bad, []);
});
test("page sections do not keep a forwards-filled animation (it would trap fixed descendants)", () => {
  assert.doesNotMatch(css, /\.adm-main > \*\s*\{[^}]*\bboth\b/);
});
test("modal body scrolls inside the viewport", () => {
  assert.match(css, /\.modal-body \{[^}]*overflow-y: auto/);
  assert.match(css, /\.modal \{[^}]*max-height: 100%/);
});

// tests/e2e/vehicle-controls.e2e.mjs
// The vehicle controls in a REAL browser, with REAL input. Not part of `npm test` (it needs Chromium); run it with:   npm run test:vehicles
//
// It bundles the game's real HUD (components/TripHud.js and the hold buttons under it, with the real CSS) and the real keyboard binding and reader (lib3d/vehicleInput.js), then
// drives them in Chromium: real key presses through the keyboard, and real TOUCHES sent through the browser's touch input (CDP Input.dispatchTouchEvent: several fingers at once, a
// finger dragged off its button, a touch the browser cancels). It runs on small / large phones (portrait + landscape), tablets and a desktop, and checks what the vehicle would
// receive, not how the buttons look. It is emulation of touch in desktop Chromium, not a real phone.
// Needs: playwright (a dependency) and esbuild (not a dependency: `npm i --no-save esbuild`, or point ESBUILD_MODULE at it). PLAYWRIGHT_MODULE overrides playwright as in radio.e2e.mjs.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const { build } = await import(process.env.ESBUILD_MODULE ?? "esbuild");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "vehicle-e2e-"));
await build({
  entryPoints: [path.join(ROOT, "tests/e2e/vehicle-harness/entry.jsx")], bundle: true, outdir: OUT, format: "esm", platform: "browser", jsx: "automatic", logLevel: "error",
  loader: { ".js": "jsx", ".png": "dataurl", ".svg": "dataurl", ".woff2": "dataurl", ".woff": "dataurl" }, alias: { "@": ROOT }, nodePaths: [path.join(ROOT, "node_modules")], define: { "process.env.NODE_ENV": '"development"' },
});
const html = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel=stylesheet href=/entry.css></head><body><div id=root></div><input id=txt style="position:fixed;left:-999px"><script type=module src=/entry.js></script></body></html>`;
const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; if (u === "/") { r.setHeader("content-type", "text/html"); return r.end(html); } const f = path.join(OUT, u); if (fs.existsSync(f)) { r.setHeader("content-type", u.endsWith(".css") ? "text/css" : "text/javascript"); return r.end(fs.readFileSync(f)); } r.statusCode = 404; r.end(); }).listen(0);
const port = srv.address().port;
const browser = await chromium.launch({ args: ["--no-sandbox"], ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

let bad = 0, n = 0;
const chk = (label, ok, extra = "") => { n++; if (!ok) { bad++; process.exitCode = 1; } console.log((ok ? "OK   " : "FAIL ") + label + (extra ? "  " + extra : "")); };
const VIEWS = [["phone-small 320x568", 320, 568, true], ["phone 390x844", 390, 844, true], ["phone-large 430x932", 430, 932, true], ["phone-landscape 844x390", 844, 390, true], ["phone-landscape-small 568x320", 568, 320, true],
  ["tablet 768x1024", 768, 1024, true], ["tablet-landscape 1180x820", 1180, 820, true], ["desktop 1366x768", 1366, 768, false]];

for (const [vn, w, h, touch] of VIEWS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.__ready); await page.waitForTimeout(200);
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  const frame = async () => { await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); return page.evaluate(() => ({ ...window.__last, inp: { ...window.__input } })); };
  const centre = async (sel, i = 0) => { const b = await page.locator(sel).nth(i).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, b }; };
  const touches = new Map();   // id -> {x,y}
  // CDP: touchStart / touchMove list every finger that is down; touchEnd lists only the finger(s) lifted; touchCancel lists none (all are cancelled).
  const pts = (m) => [...m].map(([id, p]) => ({ x: p.x, y: p.y, id }));
  const finger = {
    down: async (id, p) => { touches.set(id, p); await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pts(touches) }); },
    move: async (id, p) => { touches.set(id, p); await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pts(touches) }); },
    up: async (id) => { const p = touches.get(id); touches.delete(id); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: p.x, y: p.y, id }] }); },
    cancel: async () => { await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] }); touches.clear(); },
  };
  const T = `${vn.padEnd(26)}`;

  // ---- every control is on screen and reachable (not clipped, not under another element): the element at its centre IS the control
  const ctl = { left: [".th-sb", 0], right: [".th-sb", 1], brake: [".th-brake", 0], gas: [".th-gas", 0], horn: [".th-horn", 0] };
  for (const [k, [sel, i]] of Object.entries(ctl)) {
    const c = await centre(sel, i), on = c.x > 0 && c.y > 0 && c.x < w && c.y < h && c.b.x >= 0 && c.b.y >= 0 && c.b.x + c.b.width <= w && c.b.y + c.b.height <= h;
    const top = await page.evaluate(({ x, y, sel, i }) => { const e = document.elementFromPoint(x, y), t = document.querySelectorAll(sel)[i]; return !!e && (e === t || t.contains(e)); }, { x: c.x, y: c.y, sel, i });
    chk(`${T} ${k} button is fully on screen and nothing covers it`, on && top, `${Math.round(c.b.width)}x${Math.round(c.b.height)}`);
    if (touch) chk(`${T} ${k} touch target is at least 44 px`, c.b.width >= 44 && c.b.height >= 44);
  }

  if (touch) {
    const P = { gas: await centre(".th-gas"), brake: await centre(".th-brake"), left: await centre(".th-sb", 0), right: await centre(".th-sb", 1), horn: await centre(".th-horn") };
    const renders0 = await page.evaluate(() => window.__renders());
    // one finger on the gas
    await finger.down(1, P.gas); let f = await frame(); chk(`${T} finger on Go: gas 1`, f.gas === 1 && f.inp.gas === 1);
    // a second finger steers right while the first keeps the gas, a third sounds the horn: all at once
    await finger.down(2, P.right); await finger.down(3, P.horn); await page.waitForTimeout(300); f = await frame();
    chk(`${T} gas + steer right + horn at once`, f.gas === 1 && f.steer > 0.3 && f.horn === true, `steer ${f.steer?.toFixed(2)}`);
    // lifting the steering finger straightens the wheel and leaves the gas and horn alone
    await finger.up(2); await page.waitForTimeout(600); f = await frame(); chk(`${T} lifting the steering finger: wheel straightens, gas and horn stay`, Math.abs(f.steer) < 0.05 && f.gas === 1 && f.horn === true, `steer ${f.steer?.toFixed(2)}`);
    // steer left, then drag the finger off the button: it keeps steering until it lifts (pointer capture)
    await finger.down(4, P.left); await page.waitForTimeout(300); await finger.move(4, { x: P.left.x, y: Math.max(5, P.left.y - 200) }); await page.waitForTimeout(150); f = await frame();
    chk(`${T} a finger dragged off Left keeps steering left`, f.steer < -0.2, `steer ${f.steer?.toFixed(2)}`);
    await finger.up(4); await page.waitForTimeout(600); f = await frame(); chk(`${T} ...and lifting it straightens the wheel`, Math.abs(f.steer) < 0.05);
    // a second finger on the same button does not take over, and lifting it does not release the first
    await finger.down(5, { x: P.gas.x + 3, y: P.gas.y + 3 }); await finger.up(5); f = await frame(); chk(`${T} second finger on Go, then lifted: first finger still holds the gas`, f.gas === 1);
    await finger.up(1); await finger.up(3); f = await frame(); chk(`${T} all fingers up: gas 0, horn off, steer 0`, f.gas === 0 && f.horn === false && Math.abs(f.steer) < 0.05 && !f.inp.gas && !f.inp.horn);
    // reverse / brake
    await finger.down(6, P.brake); f = await frame(); chk(`${T} finger on Brake: brake 1, gas 0`, f.brake === 1 && f.gas === 0); await finger.up(6);
    // the browser cancels the touch (a gesture, a call): everything lets go
    await finger.down(7, P.gas); await finger.down(8, P.left); await page.waitForTimeout(200); await finger.cancel(); await page.waitForTimeout(500); f = await frame();
    chk(`${T} touch cancel (browser took the gesture): gas 0, wheel straight`, f.gas === 0 && Math.abs(f.steer) < 0.05 && !f.inp.gas);
    // the window loses focus with a finger down (the finger comes up while the page is not watching)
    await finger.down(9, P.gas); await page.evaluate(() => window.dispatchEvent(new Event("blur"))); f = await frame(); chk(`${T} window blur with Go held: gas released`, f.gas === 0 && !f.inp.gas); await finger.cancel();
    // pressing a pedal never re-renders the screen
    const renders1 = await page.evaluate(() => window.__renders()); chk(`${T} no React re-render while pressing, steering, releasing (${renders1 - renders0})`, renders1 === renders0);
    // the page does not scroll or zoom under a driving finger
    await finger.down(10, P.gas); await finger.move(10, { x: P.gas.x, y: P.gas.y - 60 }); const sc = await page.evaluate(() => [scrollX, scrollY, visualViewport.scale]); await finger.up(10); chk(`${T} a dragging driving finger does not scroll or zoom the page`, sc[0] === 0 && sc[1] === 0 && sc[2] === 1);
  } else {
    // desktop: real mouse on the buttons too
    const g = await centre(".th-gas"); await page.mouse.move(g.x, g.y); await page.mouse.down(); let f = await frame(); chk(`${T} mouse held on Go: gas 1`, f.gas === 1); await page.mouse.up(); f = await frame(); chk(`${T} mouse released: gas 0`, f.gas === 0);
    await page.mouse.move(g.x, g.y); await page.mouse.down({ button: "right" }); f = await frame(); chk(`${T} right mouse button does not press Go`, f.gas === 0); await page.mouse.up({ button: "right" });
  }

  // ---- real keyboard (every layout: the physical key), on every viewport
  const kb = page.keyboard, K = async () => frame();
  await kb.down("KeyW"); let f = await K(); chk(`${T} W: gas`, f.gas === 1); await kb.up("KeyW"); f = await K(); chk(`${T} W released: gas 0`, f.gas === 0);
  await kb.down("ArrowUp"); f = await K(); chk(`${T} ArrowUp: gas`, f.gas === 1); await kb.up("ArrowUp");
  await kb.down("KeyS"); f = await K(); chk(`${T} S: brake`, f.brake === 1); await kb.up("KeyS");
  await kb.down("Space"); f = await K(); chk(`${T} Space: brake`, f.brake === 1); await kb.up("Space");
  await kb.down("KeyD"); await page.waitForTimeout(400); f = await K(); chk(`${T} D: steer right`, f.steer > 0.2); await kb.up("KeyD"); await page.waitForTimeout(600); f = await K(); chk(`${T} D released: wheel straight`, Math.abs(f.steer) < 0.05);
  await kb.down("KeyA"); await page.waitForTimeout(400); f = await K(); chk(`${T} A: steer left`, f.steer < -0.2); await kb.up("KeyA"); await page.waitForTimeout(600);
  await kb.down("KeyW"); await kb.down("KeyD"); await kb.down("KeyH"); await page.waitForTimeout(300); f = await K(); chk(`${T} W + D + H together: gas, steer, horn`, f.gas === 1 && f.steer > 0.2 && f.horn === true);
  await kb.up("KeyD"); f = await K(); chk(`${T} releasing D leaves W and H held`, f.gas === 1 && f.horn === true); await kb.up("KeyW"); await kb.up("KeyH");
  await kb.down("KeyE"); await kb.up("KeyE"); await page.waitForTimeout(50); chk(`${T} E reaches the exit handler`, (await page.evaluate(() => window.__exitKeyHits)) >= 1);
  // focus loss with a key held
  await kb.down("KeyW"); await kb.down("KeyD"); await page.evaluate(() => window.dispatchEvent(new Event("blur"))); f = await K(); const gas0 = f.gas === 0; await page.waitForTimeout(700); f = await K(); chk(`${T} window blur with W + D held: gas drops at once, wheel is straight within 0.7 s`, gas0 && Math.abs(f.steer) < 0.05, `steer ${f.steer?.toFixed(2)}`); await kb.up("KeyW"); await kb.up("KeyD");
  // typing in a text field never drives
  await page.focus("#txt"); await kb.down("KeyW"); f = await K(); chk(`${T} W typed into a text field does not drive`, f.gas === 0); await kb.up("KeyW"); await page.evaluate(() => document.activeElement.blur());
  // a dialog opens while W is held
  await kb.down("KeyW"); await page.waitForTimeout(100); await page.evaluate(() => { const d = document.createElement("div"); d.id = "dlg"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.textContent = "x"; document.body.append(d); }); await page.waitForTimeout(400); f = await K();
  chk(`${T} a dialog opening over a held W stops the drive`, f.gas === 0); await page.evaluate(() => document.getElementById("dlg").remove()); await kb.up("KeyW");
  // leaving the vehicle clears everything, and keys no longer drive
  if (touch) { const g = await centre(".th-gas"); await finger.down(11, g); }
  await kb.down("KeyW"); await page.evaluate(() => { window.__driving = false; }); await page.waitForTimeout(100); f = await K(); chk(`${T} not driving (afoot): gas, brake, steer all 0 and on-screen gas cleared`, f.gas === 0 && f.brake === 0 && !f.inp.gas);
  await page.evaluate(() => { window.__driving = true; }); if (touch) await finger.cancel(); await kb.up("KeyW");

  // ---- flying car: climb / descend / take off controls
  await page.evaluate(() => window.__setSt({ canFly: true, airborne: false })); await page.waitForTimeout(150);
  const fly = page.locator(".th-fly"); chk(`${T} flying car on the ground shows Take off`, (await fly.count()) === 1 && /take/i.test((await fly.getAttribute("aria-label")) ?? ""));
  await page.evaluate(() => window.__setSt({ canFly: true, airborne: true, alt: 120, canExit: false })); await page.waitForTimeout(150);
  chk(`${T} in the air: Land, climb and descend are shown`, (await page.locator(".th-fly").count()) === 1 && (await page.locator(".th-climb").count()) === 2);
  for (const [i, k] of [[0, "climb"], [1, "descend"]]) {
    const c = await centre(".th-climb", i), inside = c.b.x >= 0 && c.b.y >= 0 && c.b.x + c.b.width <= w && c.b.y + c.b.height <= h; chk(`${T} ${k} button fully on screen`, inside, `${Math.round(c.b.width)}x${Math.round(c.b.height)}`);
    if (touch) { await finger.down(20 + i, c); f = await frame(); chk(`${T} finger on ${k}: ${k === "climb" ? "climb" : "descend"} input`, k === "climb" ? f.climb > 0 : f.climb < 0, `climb ${f.climb}`); await finger.up(20 + i); f = await frame(); chk(`${T} ${k} released: climb 0`, f.climb === 0); }
  }
  await kb.down("KeyQ"); f = await K(); chk(`${T} Q: climb`, f.climb > 0); await kb.up("KeyQ"); await kb.down("KeyZ"); f = await K(); chk(`${T} Z: descend`, f.climb < 0); await kb.down("KeyQ"); await kb.up("KeyZ"); await kb.up("KeyQ"); f = await K(); chk(`${T} Q + Z released: climb 0`, f.climb === 0);
  await kb.down("KeyQ"); await page.evaluate(() => window.dispatchEvent(new Event("blur"))); f = await K(); chk(`${T} blur while climbing: climb 0`, f.climb === 0); await kb.up("KeyQ");
  chk(`${T} no page errors`, errs.length === 0, errs[0] ?? "");
  await ctx.close();
}
await browser.close(); srv.close(); fs.rmSync(OUT, { recursive: true, force: true });
console.log(bad ? `\n${bad} of ${n} FAILED` : `\nvehicle controls e2e: ${n} checks passed`);

# Measures the home -> map hand-over in a real browser: time from the TO THE STREET press to each stage of arrival, and screenshots through the transition.
import sys, time, json
from lib_e2e import *
who = sys.argv[1] if len(sys.argv) > 1 else "house3"
with sync_playwright() as p:
    b, ctx, pg = open_browser(p); login(ctx, who)
    logs = []; pg.on("console", lambda m: logs.append(m.type + ": " + m.text[:260]) if m.type in ("warning", "error", "log") and "preloaded" not in m.text and "GL Driver" not in m.text else None)
    pg.goto(f"{BASE}/map", wait_until="domcontentloaded", timeout=180000); pg.wait_for_timeout(8000)   # warm the dev compiler for the map route (production has no such cost)
    pg.goto(f"{BASE}/home", wait_until="domcontentloaded", timeout=180000)
    home_ready(pg, 6000); shot(pg, who, "01-inside")
    t_outdoors = go_outside(pg)
    pg.wait_for_timeout(1500); shot(pg, who, "02-outdoors")
    pg.evaluate("""() => { window.__t = { click: performance.now() }; const T = window.__t; T.gaps = []; let last = performance.now(); const tick = () => { const n = performance.now(); if (n - last > 250) T.gaps.push([Math.round(last - T.click), Math.round(n - last)]); last = n;
        T.url ??= location.pathname === '/map' ? performance.now() - T.click : undefined;
        const ov = document.querySelector('.road-tr'); if (location.pathname === '/map') { T.snap ??= (ov?.dataset.on === '1' && ov.classList.contains('road-tr-snap')) ? performance.now() - T.click : undefined;
          T.canvas ??= document.querySelector('canvas') ? performance.now() - T.click : undefined; T.trip ??= document.querySelector('[data-trip=\"1\"]') ? performance.now() - T.click : undefined;
          if (T.snap != null && ov?.dataset.on !== '1') T.overlayOff ??= performance.now() - T.click; }
        requestAnimationFrame(tick); }; tick(); }""")
    t0 = time.time(); pg.dispatch_event(".gx-street", "click")
    n = 0
    while time.time() - t0 < 25:
        pg.wait_for_timeout(250); n += 1
        if n <= 12 or n % 8 == 0: shot(pg, who, f"03-transition-{n:02d}")
        T = pg.evaluate("() => window.__t")
        if T and T.get("overlayOff") is not None: break
    for k in range(10): pg.wait_for_timeout(400); shot(pg, who, f"04-after-{k:02d}"); print(k, pg.evaluate("() => ({trip: !!document.querySelector('[data-trip]'), hud: !!document.querySelector('.trip-hud, [class*=trip-hud]'), here: document.querySelector('.map-here')?.innerText})"))
    print("MARKS", json.dumps({m["name"]: round(m["startTime"]) for m in pg.evaluate("() => performance.getEntriesByType('mark').filter(m=>m.name.startsWith('oau:')).map(m=>({name:m.name,startTime:m.startTime}))")}))
    print("PRELOAD", json.dumps(pg.evaluate("() => ({arrival: window.__oauArrival, road: window.__oauRoadPerf})")))
    print(json.dumps({"who": who, "ms_since_press": {k: round(v) for k, v in pg.evaluate("() => window.__t").items() if k not in ("click", "gaps") and v is not None}, "outdoors_s": round(t_outdoors, 1), "long_frames_ms[at,len]": pg.evaluate("() => window.__t.gaps"), "errors": pg.errors[:5], "log_tail": logs[-14:]}, indent=1))
    b.close()

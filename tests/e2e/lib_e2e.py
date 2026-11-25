# tests/e2e/lib_e2e.py: shared helpers for the real-browser journeys (Playwright for Python + Chromium; not a dependency of the game). See tests/e2e/README.md.
import os, time, json
from playwright.sync_api import sync_playwright

BASE = os.environ.get("E2E_BASE", "http://localhost:3100")
SHOTS = os.environ.get("E2E_SHOTS", os.path.join(os.path.dirname(__file__), "shots"))
ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-background-timer-throttling"]
os.makedirs(SHOTS, exist_ok=True)

def open_browser(p, viewport=(1280, 800), mobile=False, throttle=1):
    b = p.chromium.launch(args=ARGS)
    if mobile:
        ctx = b.new_context(viewport={"width": 360, "height": 740}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent="Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36")
    else:
        ctx = b.new_context(viewport={"width": viewport[0], "height": viewport[1]}, device_scale_factor=1)
    pg = ctx.new_page(); pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append("pageerror: " + str(e)[:300]))
    pg.on("console", lambda m: pg.errors.append("console.error: " + m.text[:300]) if m.type == "error" and "font" not in m.text.lower() and "Failed to load resource" not in m.text else None)
    if throttle > 1:
        cdp = ctx.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
    return b, ctx, pg

def login(ctx, who):
    r = ctx.request.post(f"{BASE}/api/login", data={"email": f"e2e-{who}@example.test", "password": "e2e-password-1"})
    assert r.status == 200, f"login {who}: {r.status} {r.text()[:200]}"

def shot(pg, who, name):
    path = os.path.join(SHOTS, f"{who}-{name}.png"); pg.screenshot(path=path); return path

def wait_for(pg, js, timeout=60000, poll=200, label=""):
    try: pg.wait_for_function(js, timeout=timeout, polling=poll)
    except Exception as e: raise AssertionError(f"timed out waiting for {label or js}: {str(e)[:120]}")

def home_ready(pg, extra_ms=4000):
    wait_for(pg, "document.querySelector('.gx-out')", 120000, label="the home screen (GO OUTSIDE button)"); pg.wait_for_timeout(extra_ms)

def settled_inside(pg, secs=4, timeout_s=90):
    """The 3D person loads a little after the page and steps about as it settles; wait until the screen has said 'indoors' (GO OUTSIDE) for `secs` seconds in a row."""
    t0 = time.time(); since = None
    while time.time() - t0 < timeout_s:
        ok = pg.evaluate("() => document.querySelector('.gx-out')?.dataset.out === '0' && !document.querySelector('.gx-street')")
        since = (since or time.time()) if ok else None
        if since and time.time() - since >= secs: return True
        pg.wait_for_timeout(200)
    raise AssertionError("the character never settled indoors")

def go_outside(pg, timeout_s=60):
    """Press GO OUTSIDE (once settled indoors) until the character is walking, and return the seconds until the TO THE STREET button shows."""
    settled_inside(pg); t0 = time.time()
    while time.time() - t0 < timeout_s:
        pg.dispatch_event(".gx-out", "click"); pg.wait_for_timeout(500)
        if pg.query_selector(".tt-msg:has-text('cannot go outside')"): pg.wait_for_timeout(3000); continue
        while time.time() - t0 < timeout_s:
            if pg.query_selector(".gx-street"): return time.time() - t0
            pg.wait_for_timeout(100)
    raise AssertionError("the character never got outside")

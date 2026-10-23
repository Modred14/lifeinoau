// tests/pwa.test.mjs: what Settings > Install Game shows on each kind of device. Pure Node.
import { detectInstall, classify } from "../lib/pwa.js";
import { newLifeBlockers, NEW_LIFE_CONFIRM } from "../lib/newLifeRules.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const UA = {
  chromeAndroid: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  chromeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  firefoxDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  instagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0",
};
const f = (ua, o = {}) => ({ ua, platform: "", touchPoints: 0, standalone: false, hasSW: true, secure: true, ...o });
chk("no facts yet: checking", detectInstall(null).kind === "checking");
chk("running standalone: installed", detectInstall(f(UA.chromeDesktop, { standalone: true })).kind === "installed");
chk("just installed: installed", detectInstall(f(UA.chromeDesktop), { justInstalled: true }).kind === "installed");
chk("chrome with a prompt: available", detectInstall(f(UA.chromeAndroid), { hasPrompt: true }).kind === "available");
chk("chrome without a prompt: manual steps", (() => { const r = detectInstall(f(UA.chromeDesktop)); return r.kind === "manual" && r.steps.length > 0; })());
chk("iphone safari: share-menu steps", (() => { const r = detectInstall(f(UA.safariIphone)); return r.kind === "ios" && r.steps.length >= 2; })());
chk("in-app browser: unsupported with a way out", (() => { const r = detectInstall(f(UA.instagram)); return r.kind === "unsupported" && !!r.fix; })());
chk("firefox desktop: unsupported", detectInstall(f(UA.firefoxDesktop)).kind === "unsupported");
chk("insecure page: unsupported", detectInstall(f(UA.chromeDesktop, { secure: false }), { hasPrompt: true }).kind === "unsupported");
chk("classify spots an iPad asking for the desktop site", classify(UA.chromeDesktop, "MacIntel", 5).ios === true);

// ---- start a new life: the rules ----
const now = new Date("2026-01-01T00:00:00Z");
chk("the confirmation token is fixed", NEW_LIFE_CONFIRM === "START_NEW_LIFE");
chk("a free player has no blockers", newLifeBlockers({}, now).length === 0);
chk("custody blocks it", newLifeBlockers({ jailedUntil: new Date("2026-02-01") }, +now).length === 1);
chk("an expired sentence does not", newLifeBlockers({ jailedUntil: new Date("2025-02-01") }, +now).length === 0);
chk("open bets and a running match both block it", newLifeBlockers({ openBets: 2, matches: 1 }, +now).length === 2);
process.exit(bad ? 1 : 0);

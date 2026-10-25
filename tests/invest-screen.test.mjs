// tests/invest-screen.test.mjs: the Invest screen inside the phone (components/apps/InvestApp.js) against what the server really sends.
// The bug this guards: the phone showed an old screen that drew a weekly price history the live-market server no longer sends (`p.history`), so opening Invest threw while
// rendering and the player got the error page. Here the REAL screen is compiled (with Next's own compiler) and rendered with:
//   - the REAL answer of lib/investService.js getInvestments(), built on the REAL market engine, with and without holdings, and
//   - the REAL live feed state (lib/marketFeed.js), before the first price arrives and after prices and charts have loaded.
// Only the browser-side plumbing (fetch, toasts, the phone's money store) is replaced. Run: node tests/invest-screen.test.mjs
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import { createMarket } from "../lib/marketEngine.js";
import { memStore, fastWords, ANCHORS } from "./market-words.mjs";
import { createMarketFeed } from "../lib/marketFeed.js";
import { useMarketForTests, snapshot, charts } from "../lib/marketLive.js";
import { getInvestments } from "../lib/investService.js";
import { GAME_WEEK_MS } from "../lib/campus-clock.js";
import { PRODUCTS } from "../lib/market.js";

let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK   " : "FAIL ") + l); };
const root = new URL("../", import.meta.url), read = (p) => readFileSync(new URL(p, root), "utf8");

// ---- the wiring: the phone must load the live screen, and nothing may still read the old weekly fields
const phone = read("components/Phone.js"), screen = read("components/apps/InvestApp.js");
chk("the phone's Invest app is components/apps/InvestApp", /import InvestApp from "\.\/apps\/InvestApp"/.test(phone) && /invest:\s*\{[^}]*C: InvestApp/.test(phone));
chk("the screen uses the live market feed and sends the price the player saw", /useMarket/.test(screen) && /seenKobo/.test(screen));
chk("the screen no longer reads the removed weekly fields (history, changePct, news.week)", !/\.history\b/.test(screen) && !/changePct/.test(screen));
chk("the old import path (components/InvestApp) is the same screen, not a second copy", /export \{ default \} from "\.\/apps\/InvestApp"/.test(read("components/InvestApp.js")));

// ---- the real answer of the server
const T0 = Date.UTC(2026, 9, 24, 12, 0, 30); let clock = T0;
const market = createMarket({ store: memStore(), secret: "test-secret", anchors: async () => ANCHORS, now: () => clock, log: { error() {}, warn() {} }, words: fastWords(7) });
await market.ready(); useMarketForTests(market);
const holding = (product, units, cost, lastBuyWeek) => ({ id: 1n, characterId: "c1", product, unitsMicro: BigInt(units), costKobo: BigInt(cost), valueKobo: 0n, realisedKobo: 0n, feesKobo: 0n, lastBuyWeek });
const dbWith = (rows) => ({
  character: { findUnique: async () => ({ id: "c1", level: 200 }) },
  gameClock: { findUnique: async () => ({ startedAt: new Date(Date.now() - 7 * GAME_WEEK_MS - 1000) }) },
  holding: { findMany: async () => rows, update: async () => ({}) },
});
const empty = await getInvestments(dbWith([]), "u1");
const withHolds = await getInvestments(dbWith([holding("INDEX", 5_000_000, 50_000_00, 7), holding("MEME", 90_000_000, 120_000_00, 1)]), "u1");
chk("the server's answer carries what the live screen reads, and no weekly history", Object.keys(PRODUCTS).length === empty.products.length && empty.products.every((p) => p.changes && p.priceKobo && p.blurb && "risk" in p && !("history" in p)) && empty.news?.headline && empty.totals && empty.week != null);

// ---- the real live feed (before the first price, and once prices and charts have arrived)
const link = { on: () => () => {}, subscribe: async () => { throw new Error("no socket in this test"); }, unsubscribe() {}, connected: () => false };
const feed = createMarketFeed({ link, load: async (range) => ({ serverNow: Date.now(), ...snapshot(market), ...charts(market, range) }), setTimer: () => 0, clearTimer: () => {} });
const feedBefore = feed.getState(); await feed.refresh(); const feedAfter = feed.getState();
chk("the live feed starts empty and fills from the server's own snapshot and charts", feedBefore.ready === false && feedAfter.ready === true && Object.keys(feedAfter.prices).length === 6 && feedAfter.series.INDEX.values.length > 10);

// ---- compile the real screen and render it
const swc = createRequire(import.meta.url)("next/dist/build/swc"); await swc.loadBindings();
const out = new URL("tests/.tmp-invest/", root); mkdirSync(out, { recursive: true });
const compiled = await swc.transform(screen, { jsc: { parser: { syntax: "ecmascript", jsx: true }, transform: { react: { runtime: "automatic" } }, target: "es2022" }, module: { type: "es6" }, filename: "InvestApp.js" });
writeFileSync(new URL("InvestApp.mjs", out), compiled.code);
// the browser-side plumbing, replaced; "@/lib/market" is the real file
const stub = (code) => "data:text/javascript," + encodeURIComponent(code);
const STUBS = {
  "@/lib/client": stub(`export const call = async () => ({}); export const naira = (k) => "₦" + (BigInt(k) / 100n).toLocaleString("en-NG");`),
  "../Icon": stub(`export const Icon = () => null;`),
  "@/lib/toast": stub(`const f = () => {}; export const toast = { error: f, success: f, info: f };`),
  "@/lib/gameStore": stub(`export const game = {}; export const run = async () => {}; export const cash = () => ({}); export const canAfford = () => true; export const useResource = () => globalThis.__invest;`),
  "@/lib/marketClient": stub(`export const useMarket = () => globalThis.__market; export const setMarketRange = () => {};`),
  "@/components/LoadError": stub(`export default () => "LOAD-ERROR";`),
  "@/components/Loader": stub(`export default () => "LOADING";`),
};
register("data:text/javascript," + encodeURIComponent(`let H; export function initialize(d) { H = d; } export async function resolve(s, c, n) { if (H.STUBS[s]) return { url: H.STUBS[s], shortCircuit: true }; if (s === "@/lib/market") return { url: H.market, shortCircuit: true }; return n(s, c); }`), { data: { STUBS, market: new URL("lib/market.js", root).href } });
const { renderToString } = await import("react-dom/server");
const { createElement } = await import("react");
const Invest = (await import(new URL("InvestApp.mjs", out).href)).default;
const render = (d, m) => { globalThis.__invest = { d, store: {}, load() {}, loadFailed: false, router: {} }; globalThis.__market = m; return renderToString(createElement(Invest)); };
const plain = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

let html;
try { html = render(empty, feedBefore); chk("renders with no holdings before the first live price (first paint)", /Invest/.test(html) && Object.values(PRODUCTS).every((p) => html.includes(p.name))); } catch (e) { chk("renders with no holdings before the first live price: " + e.message, false); }
try { html = render(empty, feedAfter); const t = plain(html); chk("renders every product with its live price, the three change figures and a chart", Object.values(PRODUCTS).every((p) => t.includes(p.name)) && /5 min [+-]?\d/.test(t) && /1 hour [+-]?\d/.test(t) && /24 hours [+-]?\d/.test(t) && (html.match(/<svg/g) ?? []).length >= 6 && /₦\d[\d,]*\.\d\d/.test(t)); } catch (e) { chk("renders with live prices: " + e.message, false); }
try { html = render(withHolds, feedAfter); const t = plain(html); chk("renders the portfolio and each holding with profit/loss and sell buttons", /Your portfolio/.test(t) && /Your investments/.test(t) && /Sell all/.test(t) && /Sell 25%/.test(t) && /Value now/.test(t) && /Total after fees/.test(t)); } catch (e) { chk("renders holdings: " + e.message, false); }
try { html = render(withHolds, feedBefore); chk("a player with holdings still sees the screen before the first live price (uses the server's own prices)", /Your investments/.test(plain(html))); } catch (e) { chk("holdings before first price: " + e.message, false); }
try { const bare = { ...feedAfter, series: {}, mood: null }; html = render({ ...empty, news: null }, bare); chk("a missing mood and missing charts degrade gracefully instead of crashing", /The market is open/.test(plain(html))); } catch (e) { chk("degrades gracefully: " + e.message, false); }
try { globalThis.__invest = { d: null, store: {}, load() {}, loadFailed: true, router: {} }; globalThis.__market = feedBefore; chk("a failed load shows the retry screen, not a crash", renderToString(createElement(Invest)).includes("LOAD-ERROR")); } catch (e) { chk("failed load: " + e.message, false); }

// ---- and the old screen would have crashed on this very answer (proves the test catches the bug)
const oldSrc = `const data = ${JSON.stringify(empty.products[0].changes)}; const p = ${JSON.stringify(empty.products[0])}; export const draw = () => Math.min(...p.history);`;
writeFileSync(new URL("old.mjs", out), oldSrc);
let crashed = false; try { (await import(new URL("old.mjs", out).href)).draw(); } catch { crashed = true; }
chk("the server's product rows have no `history`, so code that reads it (the old screen) throws, as in the bug report", crashed);

rmSync(out, { recursive: true, force: true });
console.log(bad ? `\n${bad} check(s) failed` : "\nAll Invest screen checks passed"); process.exit(bad ? 1 : 0);

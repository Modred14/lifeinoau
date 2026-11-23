// tests/car-radio-layout.test.mjs
// Guards for the car radio's layout (components/CarRadio.js + components/car-radio.css). The panel and the "now playing" chip are positioned against the SCREEN, but the radio button sits inside the
// pedal cluster (.th-pedals > .th-aux), which is itself positioned: if the panel were rendered in place, its top / left would be measured from the pedals and it would open off screen. It must be
// portalled into the HUD root (.th). The rest are the rules the real-browser viewport check (phones, tablets, desktop, landscape) depends on.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const js = readFileSync(new URL("../components/CarRadio.js", import.meta.url), "utf8"), css = readFileSync(new URL("../components/car-radio.css", import.meta.url), "utf8");
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };

ok("the panel and chip are rendered into the HUD root with a portal", /createPortal\(\s*floating\s*,\s*host\s*\)/.test(js) && /closest\("\.th"\)/.test(js));
ok("the radio button, not the panel, is what stays in the pedal cluster", /ref=\{setBtn\}[^>]*className=\{"th-btn th-radio"/.test(js));
ok("the panel is measured from the screen: left / top / max-height come from the HUD variables", /\.th \.cr, \.th \.cr-chip \{ position: absolute; left: var\(--cr-left\)/.test(css) && /\.th \.cr \{ top: var\(--cr-panel-top\)/.test(css) && /max-height: max\(120px, calc\(100dvh - var\(--cr-panel-top\) - var\(--cr-clear\)\)\)/.test(css));
ok("the radio button keeps its size in the horn / radio / exit row (never squeezed under 44px)", /\.th \.th-radio \{ flex: none; width: var\(--th-aux\); min-width: var\(--th-aux\)/.test(css) && /\.th-aux > \.th-btn \{ flex: none/.test(css));
ok("a phone upright clears the pedal stack; a phone on its side stops before the pedals", /max-width: 599px\) and \(min-height: 521px\) \{ \.th\[data-phase="drive"\] \{ --cr-clear: calc\(var\(--th-bottom\) \+ var\(--th-gas-h\)/.test(css) && /--cr-pedals-w/.test(css) && /orientation: landscape/.test(css));
ok("the transport buttons can shrink to their column (the global button padding must not set their minimum width)", /\.th \.cr-ctl button \{[^}]*min-width: 0; padding: 0/.test(css) && /\.cr-ctl \{ display: grid; grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1\.4fr\) minmax\(0, 1fr\)/.test(css));
ok("flat colours only: the radio stylesheet has no gradients", !/gradient/i.test(css));
// ---- no radio volume control anywhere ----
const settings = readFileSync(new URL("../components/SettingsScreen.js", import.meta.url), "utf8"), mixer = readFileSync(new URL("../lib/audio/mixer.js", import.meta.url), "utf8");
ok("the radio panel has no volume slider, volume output, mute-icon row or setMix call", !/type="range"/.test(js) && !/radioVolume/.test(js) && !/<output/.test(js) && !/setMix/.test(js) && !/cr-vol/.test(js) && !/aria-label="Radio volume"/.test(js));
ok("the radio stylesheet has no volume rules and no grid cell reserved for one", !/cr-vol/.test(css) && !/range-(thumb|track)/.test(css) && !/"scr vol"/.test(css) && !/ vol"/.test(css));
ok("Settings has no car radio volume slider (and nothing in it reads or writes radioVolume)", !/sx-radio/.test(settings) && !/Car radio volume/.test(settings) && !/radioVolume/.test(settings));
ok("the radio level is a constant in the mixer, not a setting", /export const RADIO_LEVEL = 0\.8/.test(mixer) && !/radioVolume/.test(mixer));
ok("the play / pause control is still there (it is not the volume's business)", /aria-label=\{r\.on && !r\.paused \? "Pause" : "Play"\}/.test(js) && /setPlaying\(/.test(js));
// ---- Nigerian stations, grouped, with logos ----
ok("the station list is grouped by region and each station shows a logo (initials when it has none or it fails to load)", /groupStations\(r\.stations\)/.test(js) && /className="cr-region"/.test(js) && /function StationLogo/.test(js) && /onError=\{\(\) => setBad\(true\)\}/.test(js) && /cr-logo/.test(css));
ok("no station is named in the panel code: it only shows what the (Nigerian-only) station file holds", !/somafm|radio paradise|\bkexp\b|\bnts\b/i.test(js));
console.log(`car-radio-layout: ${n} checks passed`);

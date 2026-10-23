// tests/phone-overlay.test.mjs
// The phone is a layer ON TOP of the screen you are on (a building's interior included), never a replacement for it. Pure Node: reads the source and the stylesheets.
import fs from "node:fs";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK   " : "FAIL ") + l); };
const read = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const phoneCss = read("components/phone.css"), travelCss = read("components/travel.css"), cdCss = read("components/confirm-dialog.css");
const z = (css, sel) => +(css.match(new RegExp("^" + sel.replace(/[.]/g, "\\.") + " \\{[^}]*?z-index: *(\\d+)", "m"))?.[1] ?? NaN);
const phoneZ = +phoneCss.match(/--z-phone: *(\d+)/)?.[1];
chk("the phone layer is above the building interior (.bi3)", phoneZ > z(travelCss, ".bi3"));
chk("the phone layer is above the trip fade", phoneZ > z(travelCss, ".trip-fade"));
chk("confirm dialogs stay above the phone layer", phoneZ < z(cdCss, ".cd-scrim"));
chk("the phone has no other z-index override", !/\.ph-scrim\[data-over/.test(phoneCss));
chk("the phone scrim keeps touches off the room behind it", /\.ph-scrim \{[^}]*touch-action: none/.test(phoneCss));
const scene = read("lib3d/interiors/scene.js");
chk("the interior scene can be suspended (keys, stick, drag, wheel, use)", /setSuspended\(v\)/.test(scene) && /if \(suspended \|\| \/\^\(INPUT/.test(scene) && /const pd = \(e\) => \{ if \(suspended\) return;/.test(scene) && /function activate\(\) \{ if \(suspended/.test(scene));
const bi = read("components/BuildingInside.js"), shell = read("components/Shell.js");
chk("BuildingInside suspends the room while the phone is open and never unmounts it", /oau:phone-state/.test(bi) && /setSuspended/.test(bi) && /dataset\.phone === "open"/.test(bi));
chk("Shell announces the phone state without navigating", /data-phone/.test(shell) && /oau:phone-state/.test(shell));
chk("the Shop tile does not pull you out of a building", /dataset\.inside/.test(shell) && /dataset\.inside = "1"/.test(bi));
const phone = read("components/Phone.js"), loader = read("components/Loader.js"), context = read("components/phoneContext.js");
chk("shared phone spinners report loading to the phone shell", /PhoneLoading\.Provider/.test(phone) && /PhoneLoading/.test(loader) && /reportLoading\(id, true\)/.test(loader) && /PhoneLoading = createContext\(null\)/.test(context));
chk("the loading layer centers within the app area below the status bar and above the home indicator", /\.ph-app-loading \{[^}]*inset: var\(--pad-t\) 0 26px[^}]*display: grid; place-items: center/s.test(phoneCss));
chk("the status bar and home indicator remain above the loading page", /\.ph-status \{[^}]*z-index: 6/.test(phoneCss) && /\.ph-home \{[^}]*z-index: 8/.test(phoneCss) && /\.ph\[data-loading="true"\] \.pa \{ z-index: 5/.test(phoneCss));
chk("Games uses the shared spinner instead of its inline loading layout", /<Spinner label="Loading games"/.test(read("components/apps/GamesApp.js")) && !/gm-center"><i className="gm-spin"/.test(read("components/apps/GamesApp.js")));
chk("Settings uses the shared spinner so its header and controls are covered", /<Spinner label="Loading your settings"/.test(read("components/apps/SettingsApp.js")));
chk("Forbes initial load uses the shared spinner instead of a skeleton UI", /<Loader label=\{key === "forbes" \? "Loading Forbes OAU"/.test(read("components/apps/LeaderboardsApp.js")));
process.exit(bad ? 1 : 0);

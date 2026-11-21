// tests/occupancy-wiring.test.mjs: the places where the population and the occupancy are hooked into the app (read as text, like header-nav.test.mjs).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const map = read("components/CampusMap.js"), page = read("src/app/map/page.js"), badge = read("components/OccupancyBadge.js"), shell = read("components/Shell.js"), css = read("src/app/globals.css"), srv = read("realtime/server.js");
assert.ok(map.includes("<OccupancyBadge id={id} />") && map.includes("occupancy.acquire()"), "every name tag carries a badge and the map subscribes to the counts");
assert.match(map, /occupancy\.count\(it\.id\) > 0/, "an occupied building keeps its tag");
assert.match(badge, /if \(!n\) return null/, "nothing is drawn at zero");
assert.match(badge, /person.*people/s, "singular and plural");
assert.match(page, /inside !== "floor0"/, "custody is never reported"); assert.match(page, /occupancy\.setInside\(null\)/, "leaving the map leaves the building");
assert.ok(shell.includes("<CampusPopulation />") && shell.includes("<CampusEntry"), "the header shows the population and the entry is reported");
const header = shell.slice(shell.indexOf('<header className="hud">'), shell.indexOf("</header>"));
assert.ok(header.includes("naira(st.balanceKobo)") && header.indexOf("<CampusPopulation />") < header.indexOf("naira(st.balanceKobo)"), "the cash stays in the header, after the population");
assert.match(css, /\.bl \.occ/); assert.match(css, /height: var\(--hud-bar-h, 36px\)/, "the header is still 36px");
assert.ok(srv.includes("standsAt(me.id, place)") && srv.includes("CUSTODY_PLACE"), "the server checks the database before counting anyone");
console.log("occupancy-wiring.test ok");

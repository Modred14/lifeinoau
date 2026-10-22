// tests/travel.test.mjs
// Travel rules (fares, ride times, car ownership, driver plans, place ids) and the road network over the real campus map. Pure Node.
import fs from "node:fs";
import { MODES, FARE_NAIRA, fareKobo, rideKind, rideSecondsFor, RIDE_SECONDS, ownsCar, driverPlan, DRIVER_PLANS, driverActive, homePlace, placeOf, isPlaceId } from "../lib/travel.js";
import { placeExists } from "../lib/travelService.js";
import { buildRoadNet, findPath, drivePlan, destinationOf, isRoad, nearestWalkable } from "../lib3d/roadnet.js";
import { withExtras } from "../lib3d/mapExtras.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

chk("fares: trek free, keke 300, bus 200, car 500", FARE_NAIRA.trek === 0 && FARE_NAIRA.keke === 300 && FARE_NAIRA.bus === 200 && FARE_NAIRA.car === 500);
chk("fares are charged in kobo", fareKobo("keke") === 30000n && fareKobo("car") === 50000n && fareKobo("trek") === 0n && fareKobo("nope") === 0n);
chk("four modes", MODES.join() === "trek,keke,bus,car");
chk("a ride's length comes from the road distance, inside each vehicle's window: keke 10-15 s, bus 8-10 s, car with a driver 6-9 s", [["keke", rideKind("keke", false)], ["bus", rideKind("bus", false)], ["driver", rideKind("car", true)]].every(([k, kind]) => kind === k && [0, 150, 900, 2400, 6000].every((m) => { const t = rideSecondsFor(kind, m); return t >= RIDE_SECONDS[kind][0] && t <= RIDE_SECONDS[kind][1]; }) && rideSecondsFor(kind, 6000) > rideSecondsFor(kind, 100)));
chk("you steer trek and your own car (no vehicle ride)", rideKind("trek", false) === null && rideKind("car", false) === null);
chk("only Nepos own a car", ownsCar({ transport: "Daddy Benz" }) && !ownsCar({ transport: "Keke" }) && !ownsCar(null));
chk("driver plans", driverPlan(1)?.naira === 10000 && driverPlan(3) === null && DRIVER_PLANS.length === 3);
chk("driver is active only until the paid week", driverActive({ driverName: "Musa", driverUntilWeek: 5 }, 5) && !driverActive({ driverName: "Musa", driverUntilWeek: 4 }, 5) && !driverActive({ driverUntilWeek: 9 }, 5));
chk("home place falls back to the senate; placeOf prefers where you went", homePlace("Awo") === "h_awo" && homePlace("Nowhere") === "senate" && placeOf({ placeId: "library", hostel: "Awo" }) === "library" && placeOf({ hostel: "Awo" }) === "h_awo");
chk("place ids", isPlaceId("library") && isPlaceId("bld_214") && !isPlaceId("../x") && !isPlaceId("") && !isPlaceId(5) && !isPlaceId("Library"));

const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
chk("placeExists: real place, real building, nonsense", placeExists("library") && placeExists("bld_0") && !placeExists("bld_99999") && !placeExists("nosuchplace"));
const net = buildRoadNet(d), lib = d.places.find((p) => p.id === "library"), oja = d.places.find((p) => p.id === "h_ojaja");
const A = destinationOf(net, oja), B = destinationOf(net, lib);
chk("destinations have a door and a kerb spot", !!A?.door && !!B?.door && B.front && Number.isFinite(B.front.x));
const w = findPath(net, A.front, B.front, "walk"), r = drivePlan(net, A, B);
chk("a walking route exists between two far places", !!w && w.len > 500);
chk("a driving route exists and is not shorter than the straight line", !!r && r.len >= Math.hypot(A.front.x - B.front.x, A.front.z - B.front.z) - 1);
chk("route end points land at the endpoints", !!w && Math.hypot(w.at(w.len, {}).x - B.front.x, w.at(w.len, {}).z - B.front.z) < 4);
chk("a point in the middle of a building is not road", !isRoad(net, lib.x, lib.z));
chk("nearestWalkable finds ground from inside a building", !!nearestWalkable(net, lib.x, lib.z, 60, "walk"));
process.exit(bad ? 1 : 0);

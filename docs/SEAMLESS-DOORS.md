# Seamless entry and exit (every building)

One outdoor world, one trip, no loading screens. Going in and coming out are the same walk through the same door, in opposite directions.

- `lib3d/buildingPortals.js`: the portal of a building (door, entrance, exit, hinge), derived from its real outline. A new building needs nothing; `PORTAL_OVERRIDES` (empty) adjusts one by place id.
- `lib3d/tripflow.js`: phases `leave` and `roam`. `exitBuilding(portal)` walks the person out; the plan, world, collision and traffic are never restarted. `holdEnter()` keeps them in the doorway (max `ENTRY_HOLD_MAX` s) until the room is ready.
- `components/BuildingInside.js` `standby`: the room is built hidden, deaf to input and silent to the server while the player approaches the door; clearing `standby` is the whole of "going in".
- `src/app/map/page.js`: `entered()` keeps the trip alive; `leaveBuilding()` walks out through the portal (or, with no live world, starts a doorstep trip and removes the room only once the world is drawn). Never the map, never a fade for a building.
- Presence: road position reports stop while `inside` and resume on the way out; occupancy follows `inside` only (docs/BUILDING-OCCUPANCY.md).
- Tests: `tests/building-roundtrip.test.mjs` (every enterable building, 59 round trips over 8 kinds), `tests/seamless-wiring.test.mjs`.

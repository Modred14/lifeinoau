// lib3d/mapScope.js
// What the main map is allowed to draw. With ARCHIVE_ONLY on, the map shows ONLY the campus-archive map (public/data/oau-campus.json: its buildings, roads, water, parks, parking and pitches)
// and the game's own places on it. Nothing is drawn around it: no invented sea, beach or grass island past the map's frame, no belt of rim trees, no road stubs running off its edge.
// Set it to false to get the old decorated surroundings back (lib3d/ground.js and lib3d/edges.js are untouched, so it is a one-word change).
export const ARCHIVE_ONLY = true;

// tools/oau.overpassql
// Overpass query for the OAU campus and the edge of Ile-Ife town. Centre: 7.51833 N, 4.52278 E (OAU main campus).
// Box: south 7.480, west 4.480, north 7.560, east 4.570  (about 9 km by 10 km). Run it, then export the result as JSON.
[out:json][timeout:240];
(
  way["highway"](7.480,4.480,7.560,4.570);
  way["building"](7.480,4.480,7.560,4.570);
  way["name"]["amenity"](7.480,4.480,7.560,4.570);
  way["name"]["leisure"](7.480,4.480,7.560,4.570);
  way["name"]["landuse"](7.480,4.480,7.560,4.570);
  way["name"]["tourism"](7.480,4.480,7.560,4.570);
  node["natural"="tree"](7.480,4.480,7.560,4.570);
  node["name"](7.480,4.480,7.560,4.570);
);
out geom;

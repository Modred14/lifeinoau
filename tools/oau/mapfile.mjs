// tools/oau/mapfile.mjs: which campus map file the tools read. The default is the current map; OAU_MAP=legacy picks the old traced one (the restore switch).
export const mapFile = () => new URL("../../public/data/" + (process.env.OAU_MAP === "legacy" ? "oau-campus.legacy.json" : "oau-campus.json"), import.meta.url);

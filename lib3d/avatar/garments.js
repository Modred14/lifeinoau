// lib3d/avatar/garments.js
// Pure helpers (no three.js) for building an outfit from garments taken out of the authored outfit models (see lib/wardrobe.js).
// An outfit model holds separate meshes: the top, the bottom, the shoes, and small trims. Each mesh's MATERIAL name says what it is
// ("Top_Tee", "Bottom_Jeans", "SneakerSole", "AccentTrim"...), which is how the loader keeps only the garments a look asks for.

/** "top" | "bottom" | "feet" | "other" for a material name. */
export function sideOfMaterial(name) {
  const n = String(name ?? "");
  if (/^top/i.test(n)) return "top";
  if (/^bottom/i.test(n)) return "bottom";
  if (/(shoe|sneaker|boot)/i.test(n)) return "feet";
  return "other";
}

/** Which garment a trim, tie or stripe belongs to: the one whose meshes are nearer in height (centre y in the model's own space). */
export function nearerSide(cy, topCy, bottomCy) {
  if (topCy == null) return "bottom";
  if (bottomCy == null) return "top";
  return Math.abs(cy - topCy) <= Math.abs(cy - bottomCy) ? "top" : "bottom";
}

/** Decide which meshes of ONE outfit model to keep. `meshes` = [{ material, cy }]. `want` = { top, bottom } booleans (feet follow the bottom).
 *  Returns an array of booleans (keep / drop), same order. */
export function keepMask(meshes, want) {
  const avg = (side) => { const v = meshes.filter((m) => sideOfMaterial(m.material) === side).map((m) => m.cy); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const topCy = avg("top"), bottomCy = avg("bottom");
  return meshes.map((m) => {
    let side = sideOfMaterial(m.material);
    if (side === "feet") side = "bottom";
    if (side === "other") side = nearerSide(m.cy, topCy, bottomCy);
    return !!want[side];
  });
}

/** Fabric finish of a recoloured material: roughness and metalness only (works on every material type). */
export function applyFinish(material, finish, table) {
  const f = table[finish];
  if (!f || !material) return;
  if ("roughness" in material) material.roughness = f.roughness;
  if ("metalness" in material) material.metalness = f.metalness;
}

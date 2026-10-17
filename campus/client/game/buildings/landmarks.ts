import type { Building } from "@campuslife/shared/map";
import { buildAmphitheatre, buildOduduwa } from "./auditoriums";
import { buildAdministration } from "./administration";
import type { Footprint } from "./footprint";
import { buildLibrary } from "./library";
import { buildSenateOffices, buildSenateTower } from "./senate";
import type { BuildingBuffers, BuildingSpec } from "./types";

export function buildLandmark(buf: BuildingBuffers, b: Building, fp: Footprint, spec: BuildingSpec): boolean {
  switch (b.name) {
    case "Faculty of Administration":
      if (fp.pts.length !== 8) return false;
      buildAdministration(buf, fp, spec);
      return true;
    case "Hezekiah Oluwasanmi Library":
      if (fp.pts.length !== 8) return false;
      buildLibrary(buf, fp, spec);
      return true;
    case "Amphi Theatre":
      if (fp.pts.length !== 6) return false;
      buildAmphitheatre(buf, fp, spec);
      return true;
    case "Oduduwa Hall":
      if (fp.pts.length !== 6) return false;
      buildOduduwa(buf, fp, spec);
      return true;
    case "University Senate Building":
      if (fp.pts.length !== 8) return false;
      buildSenateTower(buf, fp, spec);
      return true;
    case "Senate Building":
      if (fp.pts.length !== 12) return false;
      buildSenateOffices(buf, fp, spec);
      return true;
    default:
      return false;
  }
}

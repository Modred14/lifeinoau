// lib3d/campuslife/buildings/landmarks.js
// Ported from campus/client/game/buildings/landmarks.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
import { buildAmphitheatre, buildOduduwa } from "./auditoriums.js";
import { buildAdministration } from "./administration.js";
import { buildLibrary } from "./library.js";
import { buildSenateOffices, buildSenateTower } from "./senate.js";
export function buildLandmark(buf, b, fp, spec) {
    switch (b.name) {
        case "Faculty of Administration":
            if (fp.pts.length !== 8)
                return false;
            buildAdministration(buf, fp, spec);
            return true;
        case "Hezekiah Oluwasanmi Library":
            if (fp.pts.length !== 8)
                return false;
            buildLibrary(buf, fp, spec);
            return true;
        case "Amphi Theatre":
            if (fp.pts.length !== 6)
                return false;
            buildAmphitheatre(buf, fp, spec);
            return true;
        case "Oduduwa Hall":
            if (fp.pts.length !== 6)
                return false;
            buildOduduwa(buf, fp, spec);
            return true;
        case "University Senate Building":
            if (fp.pts.length !== 8)
                return false;
            buildSenateTower(buf, fp, spec);
            return true;
        case "Senate Building":
            if (fp.pts.length !== 12)
                return false;
            buildSenateOffices(buf, fp, spec);
            return true;
        default:
            return false;
    }
}

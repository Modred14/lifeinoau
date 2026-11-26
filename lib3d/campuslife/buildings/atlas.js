// lib3d/campuslife/buildings/atlas.js
// Ported from campus/client/game/buildings/atlas.ts (commit c2b9477): the Campuslife campus look. Type annotations removed.
import { ROW_COUNT } from "./atlas-layout.js";
import { ROW_PAINTERS } from "./facades.js";
import { RowPainter, emptyAtlas } from "./painter.js";
export function paintAtlas() {
    const atlas = emptyAtlas();
    for (let row = 0; row < ROW_COUNT; row++)
        ROW_PAINTERS[row]?.(new RowPainter(atlas, row));
    return atlas;
}

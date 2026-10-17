import { ROW_COUNT } from "./atlas-layout";
import { ROW_PAINTERS } from "./facades";
import { RowPainter, emptyAtlas, type AtlasPixels } from "./painter";

export function paintAtlas(): AtlasPixels {
  const atlas = emptyAtlas();
  for (let row = 0; row < ROW_COUNT; row++) ROW_PAINTERS[row]?.(new RowPainter(atlas, row));
  return atlas;
}

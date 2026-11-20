// lib3d/dataUrl.js
// The URL of a static data file under /data, WITH its content version (?v=<hash>) from the asset manifest (lib3d/assets/manifest.js). Kept for code that needs a URL string; to load the
// file itself use loadJson("/data/<name>") from lib3d/assets, which also deduplicates, saves a copy for the next visit and measures the download.
import { assetUrl } from "./assets/manifest.js";
export const dataUrl = (name) => assetUrl(`/data/${name}`);

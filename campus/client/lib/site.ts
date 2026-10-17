/** Site-wide constants used by metadata, manifest and share images. */
export const SITE_NAME = "OAU Life";
export const SITE_DESCRIPTION =
  "Walk around campus, meet other students and live your campus life. A fan-made multiplayer game.";

export const THEME_COLOR = "#182b23";
export const BACKGROUND_COLOR = "#101e19";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

/** Required map data credits (ODbL and CC BY 4.0). Kept here, not imported from the map data, to keep the start bundle small. */
export const MAP_CREDIT = "© OpenStreetMap contributors, Meta and WRI, ESA, Google";

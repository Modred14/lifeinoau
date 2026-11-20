// next.config.mjs
import { ASSET_ROOTS } from "./assets.config.mjs";
const DAY = 86_400;
// WHY TWO POLICIES FOR ASSETS
//  - A managed asset (3D models, map data, textures, audio: the folders in assets.config.mjs) is requested with ?v=<hash of its content> (lib3d/assets/manifest.js, generated at build time). A different file
//    always means a different URL, so a versioned URL can be kept for a year and never revalidated ("immutable"): a returning player downloads nothing, and a deployment that changed one model
//    re-downloads exactly that one.
//  - The same file requested WITHOUT a version (an old page still open from before a deployment, a hand-typed URL) could be out of date, so the browser must check with the server every time
//    (`no-cache` still allows a cheap 304 answer). Nothing in a managed folder is ever kept for a long time without a version.
const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
const revalidate = [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }];
const noStore = [{ key: "Cache-Control", value: "no-store, max-age=0" }];
// Small files that rarely change and are not versioned (logos, icons): kept for a day, refreshed quietly in the background for a week.
const keep = [{ key: "Cache-Control", value: `public, max-age=${DAY}, stale-while-revalidate=${DAY * 7}` }];

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  agentRules: false,
  compress: true,
  experimental: { cpus: 2, optimizePackageImports: ["@phosphor-icons/react"] }, // load only the icons that are used, not the whole icon pack
  async headers() {
    return [
      ...ASSET_ROOTS.flatMap((root) => [
        { source: `/${root}/:path*`, has: [{ type: "query", key: "v" }], headers: immutable },
        { source: `/${root}/:path*`, missing: [{ type: "query", key: "v" }], headers: revalidate },
      ]),
      // the decoders for compressed 3D models (copied from three.js by scripts/copy-draco.mjs): the folder name carries three's version, so their content never changes under one URL
      { source: "/draco/:path*", headers: immutable },
      // the list of current asset versions and the service worker must always be fetched fresh, or a deployment could not reach players that already have the old ones
      { source: "/asset-manifest.json", headers: noStore },
      { source: "/sw.js", headers: [...noStore, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/:file(logo\\.png|logo\\.svg|icon\\.png|favicon\\.ico)", headers: keep },
    ];
  },
  async redirects() {
    return [{ source: "/play", destination: "/home", permanent: false }];
  },
};

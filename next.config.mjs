// next.config.mjs
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const DAY = 86_400;
// A hash of the map data files. lib3d/dataUrl.js puts it on the URL (?v=...), so a changed file always has a new URL: a versioned URL can then be kept for a year ("immutable") and
// the campus map and the road graph can never be served from different versions. Without the hash (it cannot be read) the plain URLs keep the one-day policy below.
const DATA_V = (() => { try { const h = createHash("sha1"); for (const f of ["oau-campus.json", "oau-roadgraph.json"]) h.update(readFileSync(new URL(`./public/data/${f}`, import.meta.url))); return h.digest("hex").slice(0, 10); } catch { return ""; } })();
const immutable = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
// Big files that rarely change (3D avatars, the campus map data, logos): the browser keeps them for a day and refreshes
// them quietly in the background for a week, so a returning player downloads nothing and the server is not asked again.
const keep = [
  {
    key: "Cache-Control",
    value: `public, max-age=${DAY}, stale-while-revalidate=${DAY * 7}`,
  },
];

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_DATA_V: DATA_V },
  agentRules: false,
  compress: true,
  experimental: { cpus: 2, optimizePackageImports: ["@phosphor-icons/react"] }, // load only the icons that are used, not the whole icon pack
  async headers() {
    return [
      { source: "/models/:path*", headers: keep },
      { source: "/campus/:path*", headers: keep },
      { source: "/data/:path*", has: [{ type: "query", key: "v" }], headers: immutable },
      { source: "/data/:path*", missing: [{ type: "query", key: "v" }], headers: keep },
      { source: "/audio/:path*", headers: keep },
      {
        source: "/:file(logo\\.png|logo\\.svg|icon\\.png|favicon\\.ico)",
        headers: keep,
      },
    ];
  },
  async redirects() {
    return [{ source: "/play", destination: "/home", permanent: false }];
  },
};

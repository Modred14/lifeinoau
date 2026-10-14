// next.config.mjs
const DAY = 86_400;
// Big files that rarely change (3D avatars, the campus map data, logos): the browser keeps them for a day and refreshes
// them quietly in the background for a week, so a returning player downloads nothing and the server is not asked again.
const keep = [{ key: "Cache-Control", value: `public, max-age=${DAY}, stale-while-revalidate=${DAY * 7}` }];

/** @type {import("next").NextConfig} */
export default {
  poweredByHeader: false,
  compress: true,
  experimental: { optimizePackageImports: ["@phosphor-icons/react"] }, // load only the icons that are used, not the whole icon pack
  async headers() {
    return [
      { source: "/models/:path*", headers: keep },
      { source: "/data/:path*", headers: keep },
      { source: "/:file(logo\\.png|logo\\.svg|icon\\.png|favicon\\.ico)", headers: keep },
    ];
  },
};

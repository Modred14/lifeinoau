// tests/fixtures/games-loader.mjs: a Node module-resolution hook for tests/games-match.test.mjs. It swaps two imports of lib/games/matchService.js for small stand-ins
// (the real lock-and-settle guard needs the whole character schema, and the real clock reads a database table), so the match and money rules run against the in-memory database.
export async function resolve(specifier, context, next) {
  const from = context.parentURL ?? "";
  if (from.endsWith("/lib/games/matchService.js") && specifier === "../gameService.js") return { url: new URL("./games-gameService-stub.mjs", import.meta.url).href, shortCircuit: true };
  if (from.endsWith("/lib/games/matchService.js") && specifier === "../clock.js") return { url: "data:text/javascript,export const currentWeek=async()=>1", shortCircuit: true };
  return next(specifier, context);
}

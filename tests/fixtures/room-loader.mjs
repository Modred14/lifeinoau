// Redirect roomService's game-action guard to the small test-only stub.
export async function resolve(specifier, context, next) {
  if ((context.parentURL ?? "").endsWith("/lib/roomService.js") && specifier === "./gameService.js") {
    return { url: new URL("./room-gameService-stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}

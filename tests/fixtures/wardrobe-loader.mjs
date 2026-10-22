// tests/fixtures/wardrobe-loader.mjs: module-resolution hook for tests/wardrobe.test.mjs: lib/wardrobeService.js gets a small stand-in for gameService.js (the real one needs the whole game schema).
export async function resolve(specifier, context, next) {
  if ((context.parentURL ?? "").endsWith("/lib/wardrobeService.js") && specifier === "./gameService.js") return { url: new URL("./wardrobe-gameService-stub.mjs", import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}

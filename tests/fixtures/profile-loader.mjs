// tests/fixtures/profile-loader.mjs: a Node module-resolution hook for tests/profile-service.test.mjs. lib/profileService.js asks gameService.js for GameError and getProfile
// (the real file needs the whole game schema) and auth.js for password hashing (it reads Next.js cookies), so those two imports get small stand-ins.
export async function resolve(specifier, context, next) {
  const from = context.parentURL ?? "";
  if (from.endsWith("/lib/profileService.js") && specifier === "./gameService.js") return { url: new URL("./profile-gameService-stub.mjs", import.meta.url).href, shortCircuit: true };
  if (from.endsWith("/lib/profileService.js") && specifier === "./auth.js") return { url: "data:text/javascript,export const check=async(p,h)=>h==='h:'+p;export const hash=async(p)=>'h:'+p", shortCircuit: true };
  return next(specifier, context);
}

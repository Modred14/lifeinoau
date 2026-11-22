// tests/_route-loader.mjs: lets a Node test import Next route files ("@/..." alias) with the signed-in player replaced by globalThis.__uid.
// Not a test itself. Used by faculty-groups.routes.e2e.mjs.
import { existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === "@/lib/auth") return { url: "data:text/javascript,export const getUserId=async()=>globalThis.__uid??null", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2), hit = [rel, rel + ".js", rel + "/index.js"].find((t) => existsSync(new URL(t, root)) && /\.[a-z]+$/.test(t));
    if (hit) return { url: new URL(hit, root).href, shortCircuit: true };
  }
  return next(specifier, context);
}

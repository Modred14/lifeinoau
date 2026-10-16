// tests/_alias-loader.mjs: lets a Node test import files that use the "@/..." alias and Next's router (stubbed). Not a test itself.
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
const root = new URL("../", import.meta.url);
export async function resolve(specifier, context, next) {
  if (specifier === "next/navigation") return { url: "data:text/javascript,export const useRouter=()=>({push(){},replace(){}});export const usePathname=()=>'/'", shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2), tries = [rel, rel + ".js", rel + "/index.js"];
    const hit = tries.find((t) => existsSync(new URL(t, root)) && /\.[a-z]+$/.test(t));
    if (hit) return { url: new URL(hit, root).href, shortCircuit: true };
  }
  return next(specifier, context);
}

// lib/avatarClient.js
// The one shared player-look directory for the browser, wired to POST /api/avatars (src/app/api/avatars/route.js).
import { call } from "@/lib/client";
import { createDirectory } from "./avatarDirectory.js";

export const avatarDirectory = createDirectory({
  async fetchLooks(names) {
    const r = await call("/api/avatars", { names });
    if (r.failed || !r.players) throw new Error(r.error || "avatars unavailable"); // a failure is not "no such player"
    return r.players;
  },
});

import { createEndpoint } from "@colyseus/core";
import { fromProxy, reply } from "../http/common";
import { worldSession, WorldAccessError } from "./bridge";

export const oauEndpoints = {
  oauSession: createEndpoint("/oau/session", { method: "POST" }, async (ctx) => {
    if (!ctx.request || !fromProxy(ctx.request)) return reply({ error: "forbidden" }, 403);
    const userId = (ctx.body as { userId?: unknown })?.userId;
    if (typeof userId !== "string" || userId.length > 100) return reply({ error: "invalid" }, 400);
    try { return reply(await worldSession(userId)); }
    catch (err) {
      if (err instanceof WorldAccessError) return reply({ error: err.message }, 403);
      console.error("[oau] session failed", err);
      return reply({ error: "Campus is unavailable. Try again shortly." }, 503);
    }
  }),
};

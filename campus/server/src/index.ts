/**
 * Campus Life game server entry point.
 *
 * Starts a Colyseus server on PORT (default 2567) with one room type,
 * "campus". Clients call joinOrCreate("campus"); Colyseus fills an existing
 * instance or opens a new one once all are full (MAX_CLIENTS_PER_ROOM).
 */
import { initializeWorldClock } from "./oau/bridge";
import { oauEndpoints } from "./oau/routes";
import { Server, createRouter, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { CAMPUS_ROOM, setClockOffset } from "@campuslife/shared";
import { sweepExpiredSessions } from "./auth/AccountService";
import { env } from "./config/env";
import { closeDatabase, runMigrations } from "./database/database";
import { marketEndpoints } from "./market/routes";
import { profiles } from "./persistence/ProfileStore";
import { CampusRoom } from "./rooms/CampusRoom";
import { corsHeaders, isOriginAllowed } from "./security/origins";

const FORBIDDEN = 403;

try {
  await runMigrations();
  await initializeWorldClock();
} catch (err) {
  console.error("Could not reach the database or apply migrations. Check DATABASE_URL.", err instanceof Error ? err.message : err);
  process.exit(1);
}

matchMaker.controller.getCorsHeaders = corsHeaders;

const gameServer = new Server({
  transport: new WebSocketTransport({
    // Detect dead mobile connections reasonably fast without burning data.
    pingInterval: 5000,
    pingMaxRetries: 3,
    maxPayload: env.WS_MAX_PAYLOAD_BYTES,
    beforeUpgrade: (_request, context) => (isOriginAllowed(context.headers.get("origin")) ? undefined : new Response(null, { status: FORBIDDEN })),
  }),
  greet: false,
});

gameServer.router = createRouter({ ...oauEndpoints, ...marketEndpoints });
gameServer.define(CAMPUS_ROOM, CampusRoom);
sweepExpiredSessions();

// Testing only: start the campus clock at another time (e.g. to try the Saturday test).
if (env.CLOCK_OFFSET_MINUTES) setClockOffset(env.CLOCK_OFFSET_MINUTES);

gameServer.onShutdown(async () => {
  await profiles.flush();
  await closeDatabase();
});

gameServer.listen(env.PORT, "0.0.0.0").then(() => {
  console.log(`🎓 Campus Life game server listening on ws://0.0.0.0:${env.PORT}`);
});

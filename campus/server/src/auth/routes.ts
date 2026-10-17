import { createEndpoint } from "@colyseus/core";
import { z } from "zod";
import { AuthError } from "@campuslife/shared/account";
import { bearer, clientIp, fromProxy, reply } from "../http/common";
import { AuthFailure, authenticate, currentAccount, register, resetPassword, signIn, signOut } from "./AccountService";
import { ipRequests, ipSignUps } from "./limits";
import { issueTicket } from "./tickets";

const FIELD_MAX = 1024;

const field = z.string().max(FIELD_MAX);
const credentials = z.object({ username: field, password: field });
const registerBody = credentials.extend({ deviceKey: field.optional() });
const resetBody = credentials.extend({ recoveryCode: field });

type Handler = (request: Request, body: unknown, ip: string) => Promise<Response>;

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new AuthFailure(AuthError.Invalid);
  return parsed.data;
}

function route(path: string, handler: Handler) {
  return createEndpoint(path, { method: "POST" }, async (ctx) => {
    const request = ctx.request;
    if (!request) return reply({ error: AuthError.Unavailable }, 503);
    if (!fromProxy(request)) return reply({ error: AuthError.SignedOut }, 403);
    const ip = clientIp(request.headers);
    if (!ipRequests.take(ip)) return reply({ error: AuthError.TooManyAttempts }, 429);
    try {
      const body: unknown = ctx.body;
      return await handler(request, body, ip);
    } catch (err) {
      if (err instanceof AuthFailure) return reply({ error: err.code }, err.status);
      console.error(`[auth] ${path} failed`, err);
      return reply({ error: AuthError.Unavailable }, 503);
    }
  });
}

export const authEndpoints = {
  register: route("/auth/register", async (_request, body, ip) => {
    const input = parse(registerBody, body);
    if (!ipSignUps.allowed(ip)) throw new AuthFailure(AuthError.TooManyAttempts);
    const { token, account, recoveryCode } = await register(input);
    ipSignUps.spend(ip);
    return reply({ token, ...account, recoveryCode }, 201);
  }),
  signIn: route("/auth/sign-in", async (_request, body) => {
    const { token, account } = await signIn(parse(credentials, body));
    return reply({ token, ...account });
  }),
  reset: route("/auth/reset", async (_request, body) => {
    const { token, account, recoveryCode } = await resetPassword(parse(resetBody, body));
    return reply({ token, ...account, recoveryCode });
  }),
  session: route("/auth/session", async (request) => reply(await currentAccount(bearer(request)))),
  ticket: route("/auth/ticket", async (request) => {
    const account = await authenticate(bearer(request));
    return reply({ ticket: issueTicket({ accountId: account.id, playerId: account.playerId, username: account.username }) });
  }),
  signOut: route("/auth/sign-out", async (request) => {
    await signOut(bearer(request));
    return reply({ ok: true });
  }),
};

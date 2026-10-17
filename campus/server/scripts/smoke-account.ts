import type { Client } from "@colyseus/sdk";
import { CAMPUS_ROOM, CampusState, type JoinOptions } from "@campuslife/shared";

const SMOKE_PASSWORD = "smoke-test-only-password";

export interface SmokeAccount {
  token: string;
  username: string;
  recoveryCode?: string;
}

export async function authPost(url: string, path: string, body: object, token?: string): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${url}/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

export async function smokeAccount(url: string, username: string, password = SMOKE_PASSWORD): Promise<SmokeAccount> {
  const created = await authPost(url, "register", { username, password });
  const result = created.status === 201 ? created : await authPost(url, "sign-in", { username, password });
  if (typeof result.data.token !== "string") throw new Error(`could not sign in as ${username}: ${JSON.stringify(result.data)}`);
  return { token: result.data.token, username, recoveryCode: typeof result.data.recoveryCode === "string" ? result.data.recoveryCode : undefined };
}

export async function joinWith(client: Client, url: string, token: string, options: Omit<JoinOptions, "ticket"> = {}) {
  const { data } = await authPost(url, "ticket", {}, token);
  return client.joinOrCreate(CAMPUS_ROOM, { ...options, ticket: data.ticket }, CampusState);
}

/** Signs in a test account and joins with a new life, so every run starts from the same place. */
export async function joinAs(client: Client, url: string, username: string, options: Omit<JoinOptions, "ticket"> = {}) {
  const account = await smokeAccount(url, username);
  return joinWith(client, url, account.token, { fresh: true, ...options });
}

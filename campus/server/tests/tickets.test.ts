import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { issueTicket, redeemTicket } from "../src/auth/tickets.ts";

const holder = { accountId: "account-1", playerId: "a".repeat(64), username: "tolu" };

test("a join ticket names its account and works once", () => {
  const ticket = issueTicket(holder);
  assert.deepEqual(redeemTicket(ticket), holder);
  assert.equal(redeemTicket(ticket), null);
});

test("made-up and malformed tickets are refused", () => {
  assert.equal(redeemTicket("x".repeat(43)), null);
  assert.equal(redeemTicket("short"), null);
  assert.equal(redeemTicket(undefined), null);
  assert.equal(redeemTicket({ ticket: "x" }), null);
});

test("a ticket expires after half a minute", () => {
  mock.timers.enable({ apis: ["Date"] });
  const ticket = issueTicket(holder);
  mock.timers.tick(31_000);
  assert.equal(redeemTicket(ticket), null);
  mock.timers.reset();
});

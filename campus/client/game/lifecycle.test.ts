import assert from "node:assert/strict";
import { test } from "node:test";
import { SubscriptionScope } from "./lifecycle";

test("player subscription ownership releases every callback when players leave or reconnect", () => {
  const events = new Map<string, Set<() => void>>();
  let delivered = 0;
  const subscribe = (name: string) => {
    const callbacks = events.get(name) ?? new Set<() => void>();
    events.set(name, callbacks);
    const callback = () => delivered++;
    callbacks.add(callback);
    return () => callbacks.delete(callback);
  };
  for (let i = 0; i < 1000; i++) {
    const scope = new SubscriptionScope();
    scope.add(...["look", "act", "spot", "emote", "movement"].map(subscribe));
    assert.equal(scope.size, 5);
    for (const callbacks of events.values()) callbacks.forEach((callback) => callback());
    scope.dispose(); scope.dispose();
    assert.equal(scope.size, 0);
    assert.ok([...events.values()].every((callbacks) => callbacks.size === 0));
  }
  assert.equal(delivered, 5000);
});

test("late subscriptions and a failing cleanup cannot leave active callbacks", () => {
  const errors: unknown[] = [], released: string[] = [];
  const scope = new SubscriptionScope((error) => errors.push(error));
  scope.add(() => { throw new Error("Already disconnected"); }, () => released.push("movement"));
  scope.dispose();
  scope.add(() => released.push("late look"));
  assert.deepEqual(released, ["movement", "late look"]);
  assert.equal(errors.length, 1);
  assert.equal(scope.size, 0);
});

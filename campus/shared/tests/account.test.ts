import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PASSWORD_MAX_LENGTH,
  RECOVERY_CODE_ALPHABET,
  cleanUsernameInput,
  formatHandle,
  formatRecoveryCode,
  normalizeRecoveryCode,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from "../src/account.ts";

test("a typed username loses the @, capitals and anything that is not a letter, number or underscore", () => {
  assert.equal(cleanUsernameInput("@Tolu_04"), "tolu_04");
  assert.equal(cleanUsernameInput("to lu<b>!"), "tolub");
  assert.equal(cleanUsernameInput("a".repeat(50)).length, 20);
});

test("usernames are stored lower case without the @ and shown with it", () => {
  assert.equal(normalizeUsername("  @ToLu  "), "tolu");
  assert.equal(normalizeUsername(42), "");
  assert.equal(formatHandle("tolu"), "@tolu");
});

test("username rules reject short, long, odd and reserved names", () => {
  assert.equal(usernameProblem("tolu_04"), null);
  assert.equal(usernameProblem("ab"), "short");
  assert.equal(usernameProblem("a".repeat(21)), "long");
  assert.equal(usernameProblem("to-lu"), "characters");
  assert.equal(usernameProblem("@tolu"), "characters");
  assert.equal(usernameProblem("admin"), "reserved");
});

test("password rules check length and that the username is not inside it", () => {
  assert.equal(passwordProblem("long enough pass", "tolu"), null);
  assert.equal(passwordProblem("short", "tolu"), "short");
  assert.equal(passwordProblem("x".repeat(PASSWORD_MAX_LENGTH + 1), "tolu"), "long");
  assert.equal(passwordProblem("my-TOLU-password", "tolu"), "username");
});

test("recovery codes survive being retyped in any case with any separators", () => {
  const code = RECOVERY_CODE_ALPHABET.slice(0, 20);
  const shown = formatRecoveryCode(code);
  assert.equal(shown.split("-").length, 5);
  assert.equal(normalizeRecoveryCode(shown), code);
  assert.equal(normalizeRecoveryCode(shown.toLowerCase().replaceAll("-", " ")), code);
  assert.equal(normalizeRecoveryCode(code.slice(1)), "");
  assert.equal(normalizeRecoveryCode("O".repeat(20)), "");
  assert.equal(normalizeRecoveryCode(undefined), "");
});

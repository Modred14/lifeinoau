import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKGROUNDS } from "../src/backgrounds.ts";
import { PHONES, PHONE_ID_MAX_LENGTH, STARTING_PHONE, findPhone, sanitizePhoneId, startingPhone } from "../src/phones.ts";

test("every handset has a unique short id and a positive whole naira price", () => {
  const ids = new Set(PHONES.map((phone) => phone.id));
  assert.equal(ids.size, PHONES.length);
  for (const phone of PHONES) {
    assert.match(phone.id, /^[a-z0-9-]+$/);
    assert.ok(phone.id.length <= PHONE_ID_MAX_LENGTH, phone.id);
    assert.ok(Number.isInteger(phone.price) && phone.price > 0, phone.id);
    assert.ok(phone.name.length > 0 && phone.spec.length > 0, phone.id);
    assert.ok(!/[–—]/.test(phone.name + phone.spec), phone.id);
  }
});

test("the catalog covers both platforms from budget to flagship", () => {
  const android = PHONES.filter((phone) => phone.platform === "android");
  const ios = PHONES.filter((phone) => phone.platform === "ios");
  assert.ok(android.length >= 3 && android.length <= 4);
  assert.equal(ios.length, 6);
  for (const name of ["iPhone 12", "iPhone 13", "iPhone 14", "iPhone 15", "iPhone 16", "iPhone 17 Pro Max"]) assert.ok(ios.some((phone) => phone.name === name), name);
  assert.ok(android.some((phone) => phone.tier === "budget"));
  assert.ok(android.some((phone) => phone.tier === "flagship"));
});

test("frame tokens stay inside what the CSS frame can draw", () => {
  for (const { id, frame } of PHONES) {
    assert.ok(frame.aspect > 0.4 && frame.aspect < 0.6, id);
    assert.ok(frame.bezel > 0 && frame.chin >= frame.bezel, id);
    assert.ok(frame.radius > frame.bezel, id);
    for (const colour of [frame.body, frame.edge, frame.accent, ...frame.wallpaper]) assert.match(colour, /^#[0-9a-f]{6}$/, id);
  }
  const bezels = (platform: string, tier: string) => PHONES.find((phone) => phone.platform === platform && phone.tier === tier)!.frame;
  assert.ok(bezels("android", "budget").chin > bezels("android", "flagship").chin * 3);
});

test("each background starts on the phone its money suggests", () => {
  for (const background of BACKGROUNDS) {
    const phone = startingPhone(background);
    assert.equal(phone.id, STARTING_PHONE[background]);
    assert.equal(findPhone(phone.id), phone);
  }
  assert.equal(startingPhone("nepo").platform, "ios");
  assert.equal(startingPhone("regular").platform, "android");
  assert.equal(startingPhone("regular").tier, "mid");
  assert.equal(startingPhone("hustler").platform, "android");
  assert.equal(startingPhone("hustler").tier, "budget");
  assert.ok(startingPhone("hustler").price < startingPhone("regular").price);
  assert.ok(startingPhone("regular").price < startingPhone("nepo").price);
});

test("the sanitiser keeps known ids and replaces junk with the starting phone", () => {
  assert.equal(sanitizePhoneId("vanta-s-ultra", "hustler"), "vanta-s-ultra");
  for (const junk of [undefined, null, "", 3, {}, [], "iphone", "<script>", "zuma-a1 ", "x".repeat(200), "constructor", "__proto__"]) {
    assert.equal(findPhone(junk), undefined);
    for (const background of BACKGROUNDS) assert.equal(sanitizePhoneId(junk, background), STARTING_PHONE[background]);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LOOK, OUTFITS, SLOTS, STUDENT_OUTFITS, applyStudentOutfit, slotOptions, decodeLook, encodeLook, randomLook, sanitizeLook } from "../src/avatar.ts";

test("retired workwear in saved looks becomes student clothing without changing colours", () => {
  for (const body of ["m", "f"] as const) {
    for (const id of ["corporate", "backpacker", "farm", "hivis"]) {
      const look = decodeLook([body, id, id, id, id, 4, 2, 8, 3, 1].join("|"));
      for (const slot of SLOTS) assert.ok(OUTFITS[body].some((outfit) => outfit.id === look[slot]));
      assert.equal(look.body, body);
      assert.deepEqual([look.skin, look.hair, look.topColor, look.bottomColor, look.shoesColor], [4, 2, 8, 3, 1]);
    }
  }
  assert.equal(decodeLook("m|corporate|corporate|corporate|corporate|0|0|3|0|0").top, "casual");
});

test("new and randomized students only use the student catalogue", () => {
  let seed = 3;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const bodies = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const look = randomLook(rand);
    bodies.add(look.body);
    for (const slot of SLOTS) {
      assert.ok(!["corporate", "backpacker", "farm", "hivis"].includes(look[slot]));
      assert.ok(OUTFITS[look.body].some((outfit) => outfit.id === look[slot]));
    }
    assert.deepEqual(decodeLook(encodeLook(look)), look);
  }
  assert.equal(bodies.size, 2);
  assert.deepEqual(decodeLook(encodeLook(DEFAULT_LOOK)), DEFAULT_LOOK);
});

test("look migration remains canonical and rejects inherited object keys", () => {
  for (const id of ["__proto__", "constructor", "toString", "unknown"]) {
    const raw = `f|${id}|${id}|${id}|${id}|2|0|6|3|0`;
    const normalized = sanitizeLook(raw);
    assert.equal(sanitizeLook(normalized), normalized);
    for (const slot of SLOTS) assert.equal(decodeLook(raw)[slot], "casual");
  }
});

test("every student outfit keeps identity and survives server validation for both bodies", () => {
  for (const body of ["m", "f"] as const) {
    const original = decodeLook(encodeLook({ ...DEFAULT_LOOK, body, skin: 5, hair: 2 }));
    for (const outfit of STUDENT_OUTFITS) {
      const look = applyStudentOutfit(original, outfit.id);
      assert.equal(look.body, original.body);
      assert.equal(look.head, original.head);
      assert.equal(look.skin, 5);
      assert.equal(look.hair, 2);
      assert.deepEqual(decodeLook(encodeLook(look)), look);
      for (const slot of SLOTS) assert.ok(slotOptions(body, slot).some((item) => item.id === look[slot]));
    }
  }
});

test("slot validation prevents wearing shoe-only meshes as a head or shirt", () => {
  for (const body of ["m", "f"] as const) {
    assert.ok(slotOptions(body, "shoes").length >= 10);
    assert.ok(slotOptions(body, "head").every((item) => !item.style));
    const look = decodeLook(`${body}|sneakers|sneakers|medical|clogs|2|0|4|3|1`);
    assert.equal(look.shoes, "clogs");
    assert.ok(slotOptions(body, "head").some((item) => item.id === look.head));
    assert.ok(slotOptions(body, "top").some((item) => item.id === look.top));
    assert.ok(slotOptions(body, "bottom").some((item) => item.id === look.bottom));
    assert.notEqual(look.head, "sneakers");
    assert.notEqual(look.top, "sneakers");
    assert.notEqual(look.bottom, "medical");
  }
});

test("new hairstyles save independently and remain restricted to the head slot", () => {
  for (const body of ["m", "f"] as const) {
    const options = slotOptions(body, "head");
    assert.equal(options.length, body === "m" ? 10 : 9);
    assert.equal(options.filter((option) => option.hairstyle).length, 6);
    assert.ok(options.every((option) => !/^Style \d/.test(option.parts.head)));
    const original = applyStudentOutfit(decodeLook(encodeLook({ ...DEFAULT_LOOK, body, skin: 5, hair: 7 })), "medical");
    for (const option of options.filter((option) => option.hairstyle)) {
      const look = { ...original, head: option.id };
      assert.deepEqual(decodeLook(encodeLook(look)), look);
      assert.deepEqual(applyStudentOutfit(look, "nursing").head, look.head);
      for (const slot of ["top", "bottom", "shoes"] as const) {
        assert.ok(!slotOptions(body, slot).some((item) => item.id === option.id));
        assert.notEqual(decodeLook(encodeLook({ ...look, [slot]: option.id }))[slot], option.id);
      }
    }
  }
  for (const head of ["afro", "curls", "locs"]) for (const body of ["m", "f"] as const) assert.equal(decodeLook(encodeLook({ ...DEFAULT_LOOK, body, head })).head, head);
  assert.equal(decodeLook(encodeLook({ ...DEFAULT_LOOK, head: "ponytail" })).head, "hoodie");
  assert.equal(decodeLook(encodeLook({ ...DEFAULT_LOOK, body: "f", head: "fade" })).head, "casual");
});

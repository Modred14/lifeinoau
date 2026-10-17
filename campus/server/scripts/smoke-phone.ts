import { Client } from "@colyseus/sdk";
import { joinAs } from "./smoke-account";
import { BACKGROUNDS, Msg, PHONES, STARTING_PHONE, ServerMsg, findPhone } from "@campuslife/shared";

const url = process.env.GAME_SERVER_URL ?? "http://localhost:2567";
const SETTLE_MS = 400;
const SAVE_MS = 2500;
const MAX_ROLLS = 6;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed++;
};

const client = new Client(url);
const join = (fresh: boolean) => joinAs(client, url, "smoke_phone", { fresh });
type CampusClientRoom = Awaited<ReturnType<typeof join>>;
const me = (room: CampusClientRoom) => room.state.players.get(room.sessionId)!;

let room = await join(true);
await sleep(SETTLE_MS);
for (let roll = 1; roll < MAX_ROLLS && BACKGROUNDS[me(room).bg] === "hustler"; roll++) {
  await room.leave();
  await sleep(SETTLE_MS);
  room = await join(true);
  await sleep(SETTLE_MS);
}

const notices: string[] = [];
room.onMessage(ServerMsg.Notice, (text: unknown) => {
  if (typeof text === "string") notices.push(text);
});
room.onMessage("*", () => {});

const background = BACKGROUNDS[me(room).bg];
const startId = me(room).phone;
const startCash = me(room).cash;
check(startId === STARTING_PHONE[background], `a new ${background} student starts on ${startId}`);

const expectUnchanged = async (payload: unknown, label: string) => {
  const before = notices.length;
  room.send(Msg.BuyPhone, payload);
  await sleep(SETTLE_MS);
  check(me(room).phone === startId && me(room).cash === startCash, `${label}: phone and cash unchanged`);
  return notices.length > before;
};

await expectUnchanged({}, "empty payload");
await expectUnchanged({ id: 42 }, "non-string id");
check(await expectUnchanged({ id: "no-such-phone" }, "unknown model"), "unknown model sends a notice");
check(await expectUnchanged({ id: startId }, "same model"), "same model sends a notice");
const tooDear = PHONES.find((phone) => phone.price > startCash && phone.id !== startId);
if (tooDear) check(await expectUnchanged({ id: tooDear.id, price: 1 }, `${tooDear.name} without the cash`), "not enough cash sends a notice");

const affordable = PHONES.find((phone) => phone.price <= startCash && phone.id !== startId);
if (!affordable) {
  console.log(`SKIP  purchase and save checks: every roll was a hustler with ₦${startCash}. Run again.`);
} else {
  room.send(Msg.BuyPhone, { id: affordable.id, price: 1 });
  await sleep(SETTLE_MS);
  check(me(room).phone === affordable.id, `bought ${affordable.name}`);
  check(me(room).cash === startCash - affordable.price, `cash went down by exactly ₦${affordable.price}`);
  check(notices.some((text) => text.includes(affordable.name)), "purchase sends a notice");
  await sleep(SAVE_MS);
  await room.leave();
  await sleep(SAVE_MS);
  room = await join(false);
  await sleep(SETTLE_MS);
  check(me(room).phone === affordable.id, "the phone is still there after rejoining with the same save");
  check(findPhone(me(room).phone) !== undefined, "the saved phone is a catalog model");
}

await room.leave();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll phone checks passed");
process.exit(failed ? 1 : 0);

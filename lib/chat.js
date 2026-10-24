// lib/chat.js
// The one chat connection for the whole game. Started when the player is in the game, so messages, ticks and online status keep
// arriving while the phone is closed (the phone badge lights up and a small notice appears).
//
//   realtime server up   -> everything travels over one WebSocket (instant, nothing polled)
//   realtime server off  -> the same screens work over the plain /api/messages routes, with a light poll
import { useSyncExternalStore } from "react";
import { io } from "socket.io-client";
import { call } from "@/lib/client";
import { playSound } from "@/lib/sound";
import { getPrefs } from "@/lib/prefs";
import { toast } from "@/lib/toast";
import { onReset } from "@/lib/optimistic";
import { createChatStore } from "./chatStore.js";
import { previewOf, KIND } from "./chatShared.js";

const KEY = "oau.chat.v1";
const storage = {
  load() { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } },
  save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode or full: the chat just will not be kept between visits */ } },
  clear() { try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ } },
};

// ---------- the plain-HTTP road (used for reads when the socket is down, and for every send if there is no realtime server) ----------
async function http(event, p = {}) {
  if (event === "inbox") return call("/api/messages");
  if (event === "unread") return call("/api/messages?unread=1");
  if (event === "thread") {
    const q = new URLSearchParams({ with: p.with });
    if (p.before) q.set("before", p.before);
    if (p.after) q.set("after", p.after);
    return call("/api/messages?" + q);
  }
  if (event === "send") return call("/api/messages", p);
  if (event === "read") return call("/api/messages/read", p);
  return { failed: true, status: 0, error: "Unknown request." };
}

let socket = null, pass = null, giveUp = null, poller = null, gen = 0;
// The live market (lib/marketClient.js) rides on this same socket: one connection for the whole game. It registers its handlers here.
const marketHandlers = new Set();
export const marketLink = {
  on: (h) => { marketHandlers.add(h); return () => marketHandlers.delete(h); },
  connected: () => !!socket?.connected,
  /** Ask the server for prices (it then pushes one message a second). Resolves with the first snapshot, rejects if there is no connection. */
  subscribe: () => new Promise((ok, no) => {
    if (!socket?.connected) return no(new Error("offline"));
    socket.timeout(8000).emit("market:sub", {}, (e, r) => (e || !r?.ok ? no(e ?? new Error("refused")) : ok(r)));
  }),
  unsubscribe: () => { try { socket?.connected && socket.emit("market:unsub", {}); } catch { /* the socket is going away anyway */ } },
};
const tellMarket = (name, d) => marketHandlers.forEach((h) => { try { h[name]?.(d); } catch { /* a screen's bug must never break the chat connection */ } });
const transport = {
  connected: () => !!socket?.connected,
  emit: (event, data, ms = 8000) => new Promise((ok, no) => {
    if (!socket?.connected) return no(new Error("offline"));
    const s = socket;
    s.timeout(ms).emit(event, data, (e, r) => {
      if (!e) return ok(r);
      if (s === socket && s.connected) { s.disconnect(); s.connect(); } // no answer: the connection is dead even if it has not noticed yet, so start a new one now
      no(e);
    });
  }),
};

let foreground = false; // is the Messages app on screen right now?
const store = createChatStore({
  transport, http, storage,
  sound: (n) => { if (n === "receive" && !getPrefs().notifications.messageSound) return; playSound(n); }, // Settings > Notifications: the sound of a new message can be switched off
  onIncoming: ({ from, kind, body }) => {
    if (foreground || !getPrefs().notifications.messagePopups) return; // the app is open (the list itself shows it), or the player switched message pop-ups off in Settings
    toast.info(`${from}: ${previewOf(kind, body)}`, { id: "msg:" + from });
  },
});

/** A fresh chat pass (they last two hours; this asks again a little before one runs out). */
async function getPass(force = false) {
  if (!force && pass && pass.exp - Date.now() > 600_000) return pass;
  const r = await call("/api/messages/token");
  if (r.failed) throw new Error(r.status === 401 ? "login" : "pass");
  pass = r.url ? { url: r.url, token: r.token, exp: Date.now() + r.expiresIn * 1000 } : { url: null, exp: Date.now() + 600_000 };
  return pass;
}

function wire(s) {
  s.on("connect", () => { clearTimeout(giveUp); store.onConnected(); tellMarket("connect"); });
  s.on("disconnect", () => { store.onDisconnected(); giveUp = setTimeout(() => store.onUnavailable(), 4000); tellMarket("disconnect"); });
  s.on("market:tick", (d) => tellMarket("tick", d));
  s.on("connect_error", (e) => { if (e?.message === "auth") pass = null; giveUp ??= setTimeout(() => store.onUnavailable(), 4000); });
  s.on("hello", (d) => store.onHello(d));
  s.on("msg", (d) => store.onMsg(d));
  s.on("delivered", (d) => store.onDelivered(d));
  s.on("read", (d) => store.onRead(d));
  s.on("read:me", (d) => store.onReadMe(d));
  s.on("typing", (d) => store.onTyping(d));
  s.on("presence", (d) => store.onPresence(d));
  s.on("block", (d) => store.onBlock(d));
  s.on("deleted", (d) => store.onDeleted(d));
}

async function connect() {
  const mine = gen;
  let p;
  try { p = await getPass(); } catch (e) { if (e.message === "login" || mine !== gen) return; return store.onUnavailable(); }
  if (mine !== gen) return; // logged out while the pass was on its way
  if (!p.url) return store.onUnavailable(); // no realtime server set up: plain HTTP
  if (socket) return;
  socket = io(p.url, {
    transports: ["websocket", "polling"], // straight to WebSocket (no upgrade dance); polling only if WebSockets are blocked
    reconnectionDelay: 800, reconnectionDelayMax: 6000,
    auth: (cb) => getPass().then((x) => cb({ token: x.token })).catch(() => cb({ token: "" })),
  });
  wire(socket);
  giveUp = setTimeout(() => store.onUnavailable(), 5000);
}

function visibility() { store.setVisible(!document.hidden && foreground); }
// the browser knows at once when the network goes away or comes back; waiting for the socket's own heartbeat can take 40 seconds
const goneOffline = () => { store.setNetwork(false); socket?.disconnect(); };
const comeBack = () => { store.setNetwork(true); socket?.connect(); store.poll(); };

export const chat = Object.assign(store, {
  /** Begin (or continue) for this player. Safe to call again. */
  begin(name) {
    if (typeof window === "undefined" || !name) return;
    if (store.getState().me && store.getState().me !== name) chat.end();
    if (store.getState().me === name && (socket || poller)) return;
    store.start(name);
    store.setNetwork(navigator.onLine !== false);
    connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", comeBack);
    window.addEventListener("offline", goneOffline);
    poller = setInterval(() => { if (!document.hidden) store.poll(); }, 4000); // only does anything while the socket is down
  },
  end() {
    gen++; clearTimeout(giveUp); giveUp = null; clearInterval(poller); poller = null;
    window.removeEventListener("online", comeBack);
    window.removeEventListener("offline", goneOffline);
    socket?.removeAllListeners(); socket?.close(); socket = null; pass = null;
    document.removeEventListener("visibilitychange", visibility);
    store.reset();
  },
  /** The Messages app is on screen (true) or not (false): decides whether new messages show a notice and whether open chats count as read. */
  setForeground(on) { foreground = on; visibility(); },
});
onReset(() => chat.end());

/** React: const unread = useChat((s) => s.unread)  — pick a small value so the component only redraws when it changes. */
export const useChat = (pick = (s) => s) => useSyncExternalStore(store.subscribe, () => pick(store.getState()), () => pick(store.getState()));
export { KIND };
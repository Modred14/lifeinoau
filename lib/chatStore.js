// lib/chatStore.js
// The chat as the player's screen sees it. No React and no browser APIs in here (the transport is handed in), so it runs the same in
// the browser and in a Node test.
//
// The rule that makes chat feel instant: a message you send is put on screen BEFORE anything is sent (one clock tick), the request
// goes out in the background, and the bubble then moves through  clock -> sent (one tick) -> delivered (two ticks) -> read (two blue).
// Nothing ever waits for the server. If the connection is down the message waits in the thread and goes out when it is back.
import { KIND, cleanBody, previewOf, moneyBody, tickOf } from "./chatShared.js";

const lc = (n) => String(n ?? "").toLowerCase();
const STALE_MS = 5 * 60_000; // an unsent message older than this is marked "not sent" so the player can retry or delete it
const KEEP_SAVED = 40, SAVED_CHATS = 8;

export function createChatStore({ transport, http, storage, sound = () => {}, onIncoming = () => {}, uuid, now = () => Date.now() }) {
  const newId = uuid ?? (() => (globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.random().toString(36).slice(2)}`));
  let s = { link: "idle", offline: false, me: null, inbox: null, threads: {}, presence: {}, typing: {}, unread: 0, open: null };
  const subs = new Set();
  let saveTimer = null, visible = true, wantInbox = false, tick = 0;
  const typingTimers = {};
  const sentTyping = {}, asked = new Set();

  const emit = () => { s = { ...s, threads: { ...s.threads } }; subs.forEach((f) => f()); save(); };
  const save = () => {
    if (!storage || !s.me) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keep = Object.values(s.threads).sort((a, b) => lastAt(b) - lastAt(a)).slice(0, SAVED_CHATS);
      storage.save({ me: s.me, unread: s.unread, inbox: s.inbox, threads: Object.fromEntries(keep.map((t) => [lc(t.name), { ...t, msgs: t.msgs.slice(-KEEP_SAVED), loadingOlder: false }])) });
    }, 400);
  };
  const lastAt = (t) => (t.msgs.length ? new Date(t.msgs.at(-1).at).getTime() : 0);

  // ---------- helpers ----------
  const thread = (name, make = true) => {
    const k = lc(name);
    if (!s.threads[k] && make) s.threads[k] = { name, msgs: [], hasMore: false, peerRead: 0, peerDel: 0, myRead: 0, blockedByMe: false, loaded: false, loadingOlder: false };
    return s.threads[k];
  };
  const maxId = (t) => t.msgs.reduce((m, x) => (x.id != null && x.id > m ? x.id : m), 0);
  const sumUnread = () => { if (s.inbox) s.unread = s.inbox.reduce((n, c) => n + (c.unread || 0), 0); };
  const sortInbox = () => s.inbox.sort((a, b) => new Date(b.at) - new Date(a.at));

  function touchInbox(name, m, { unreadDelta = 0, reset = false } = {}) {
    if (!s.inbox) return;
    let c = s.inbox.find((x) => lc(x.name) === lc(name));
    if (!c) { c = { name, last: "", kind: 0, mine: true, at: m.at, unread: 0, id: 0, peerRead: 0, peerDel: 0, blocked: false }; s.inbox = [c, ...s.inbox]; }
    if (!c.id || m.id == null || m.id >= c.id) { c.last = previewOf(m.kind, m.body); c.kind = m.kind; c.mine = m.mine; c.at = m.at; c.id = m.id ?? c.id; }
    c.unread = reset ? 0 : (c.unread || 0) + unreadDelta;
    sortInbox(); sumUnread();
  }

  /** Put server messages into a thread: skip ones already there, adopt a waiting "sending" bubble if it is the same message, keep order by id. */
  function merge(t, list) {
    for (const sm of list) {
      if (t.msgs.some((x) => x.id === sm.id)) continue;
      const w = sm.mine && t.msgs.find((x) => x.id == null && x.mine && x.kind === sm.kind && x.body === sm.body && Math.abs(new Date(x.at) - new Date(sm.at)) < STALE_MS * 2);
      if (w) { w.id = sm.id; w.at = sm.at; w.st = "sent"; continue; }
      // newest-by-id goes last, but before any message still waiting to be sent
      const later = t.msgs.findIndex((x) => x.id != null && x.id > sm.id), waiting = t.msgs.findIndex((x) => x.id == null);
      t.msgs.splice(later >= 0 ? later : waiting >= 0 ? waiting : t.msgs.length, 0, { id: sm.id, cid: sm.cid, mine: sm.mine, kind: sm.kind ?? 0, body: sm.body, at: sm.at, st: "sent" });
    }
  }
  const apply = (t, r) => {
    t.peerRead = Math.max(t.peerRead, r.peerRead ?? 0); t.peerDel = Math.max(t.peerDel, r.peerDel ?? 0, t.peerRead);
    t.myRead = Math.max(t.myRead, r.myRead ?? 0);
    if (r.blockedByMe != null) t.blockedByMe = r.blockedByMe;
  };

  // ---------- talking to the server: the socket when it is up, plain HTTP when it is not ----------
  async function rpc(event, payload) {
    if (transport?.connected()) { try { return await transport.emit(event, payload); } catch { /* timed out: try the plain road */ } }
    return http(event, payload);
  }
  const bad = (r) => !r || r.failed || r.ok === false;
  const retriable = (r) => !r || r.status === 0 || r.status >= 500;

  // ---------- sending ----------
  async function dispatch(name, m) {
    if (m.inflight || m.st !== "sending") return;
    m.inflight = true;
    let r;
    try {
      r = transport?.connected()
        ? await transport.emit("send", { to: name, body: m.body, cid: m.cid }, 10_000).catch(() => null)
        : await http("send", { to: name, body: m.body, cid: m.cid });
    } catch { r = null; }
    m.inflight = false;
    const t = thread(name, false);
    if (!t) return;
    if (bad(r)) {
      if (!retriable(r) && r) { m.st = "failed"; m.err = r.error || "Not sent."; }
      else if (now() - new Date(m.at).getTime() > STALE_MS) { m.st = "failed"; m.err = "No connection. Not sent."; }
      // otherwise it stays "sending" (a clock) and goes out again when the connection is back
    } else {
      m.st = "sent"; m.id = r.id ?? m.id ?? null; if (r.at) m.at = r.at;
      if (r.delivered && m.id) t.peerDel = Math.max(t.peerDel, m.id);
    }
    emit();
  }
  async function flush() {
    for (const t of Object.values(s.threads)) {
      const waiting = t.msgs.filter((m) => m.st === "sending" && !m.inflight);
      if (!waiting.length) continue;
      if (t.loaded) { // maybe the server already has them (the answer was lost): adopt those instead of sending twice
        const r = await rpc("thread", { with: t.name, after: maxId(t) });
        if (!bad(r)) { merge(t, r.messages); apply(t, r); emit(); }
      }
      for (const m of t.msgs.filter((x) => x.st === "sending" && !x.inflight)) await dispatch(t.name, m);
    }
  }

  // ---------- the public API ----------
  const api = {
    getState: () => s,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },

    start(me, saved) {
      if (s.me === me) return;
      s = { link: "connecting", offline: s.offline, me, inbox: null, threads: {}, presence: {}, typing: {}, unread: 0, open: null };
      const d = saved ?? storage?.load();
      if (d && d.me === me) s = { ...s, inbox: d.inbox ?? null, unread: d.unread ?? 0, threads: Object.fromEntries(Object.entries(d.threads ?? {}).map(([k, t]) => [k, { ...t, msgs: (t.msgs ?? []).map((m) => ({ ...m, inflight: false })) }])) };
      emit();
    },
    reset() { asked.clear(); clearTimeout(saveTimer); Object.values(typingTimers).forEach(clearTimeout); storage?.clear(); s = { link: "idle", offline: false, me: null, inbox: null, threads: {}, presence: {}, typing: {}, unread: 0, open: null }; subs.forEach((f) => f()); },

    // connection
    onConnected() { asked.clear(); s.link = "live"; emit(); api.loadInbox(); if (s.open) api.syncOpen(); flush(); },
    onDisconnected() { s.link = "connecting"; for (const k in s.presence) s.presence[k] = { ...s.presence[k], online: false, stale: true }; emit(); },
    onUnavailable() { if (s.link !== "live") { s.link = "down"; emit(); } },
    /** The browser says the network went away or came back. */
    setNetwork(on) { if (s.offline === !on) return; s.offline = !on; emit(); },
    setVisible(v) { visible = v; if (v) api.markRead(); },
    watchInbox(on) { wantInbox = on; if (on) api.loadInbox(); },

    // server pushes
    onHello(h) { if (h.unread != null && !s.inbox) { s.unread = h.unread; emit(); } },
    onMsg(m) {
      const peer = m.mine ? m.to : m.from, k = lc(peer), t = thread(peer, !!s.threads[lc(peer)] || s.open === k);
      const isOpen = s.open === k;
      const msg = { id: m.id, cid: m.cid, mine: !!m.mine, kind: m.kind ?? 0, body: m.body, at: m.at, st: "sent" };
      if (t) merge(t, [msg]);
      if (!m.mine) {
        touchInbox(peer, msg, { unreadDelta: isOpen && visible ? 0 : 1 });
        delete s.typing[k];
        if (!(k in s.presence) && !asked.has(k) && transport?.connected()) { // a conversation that just appeared: find out whether they are online, and keep watching
          asked.add(k);
          transport.emit("watch", { names: [peer] }, 5000).then((r) => { const p = r?.presence?.[peer]; if (p) { s.presence[k] = { online: !!p.online, lastSeen: p.lastSeen }; emit(); } }).catch(() => asked.delete(k));
        }
        sound("receive");
        if (!(isOpen && visible)) onIncoming({ from: peer, kind: msg.kind, body: msg.body });
      } else touchInbox(peer, msg, { reset: true });
      if (s.inbox == null && !m.mine && !(isOpen && visible)) s.unread += 1;
      emit();
      if (isOpen && !m.mine) api.markRead();
    },
    onDelivered({ by, upTo }) { const t = thread(by, false), c = s.inbox?.find((x) => lc(x.name) === lc(by)); if (t) t.peerDel = Math.max(t.peerDel, upTo); if (c) c.peerDel = Math.max(c.peerDel, upTo); emit(); },
    onRead({ by, upTo }) {
      const t = thread(by, false), c = s.inbox?.find((x) => lc(x.name) === lc(by));
      if (t) { t.peerRead = Math.max(t.peerRead, upTo); t.peerDel = Math.max(t.peerDel, upTo); }
      if (c) { c.peerRead = Math.max(c.peerRead, upTo); c.peerDel = Math.max(c.peerDel, upTo); }
      emit();
    },
    onReadMe({ with: name }) { const c = s.inbox?.find((x) => lc(x.name) === lc(name)); if (c) { c.unread = 0; sumUnread(); emit(); } },
    onTyping({ from, on }) {
      const k = lc(from); clearTimeout(typingTimers[k]);
      if (on) { s.typing[k] = true; typingTimers[k] = setTimeout(() => { delete s.typing[k]; emit(); }, 4500); } else delete s.typing[k];
      emit();
    },
    onPresence({ name, online, lastSeen }) { s.presence[lc(name)] = { online: !!online, lastSeen: lastSeen ?? s.presence[lc(name)]?.lastSeen ?? null }; if (!online) delete s.typing[lc(name)]; emit(); },
    onBlock({ name, on }) { const t = thread(name, false), c = s.inbox?.find((x) => lc(x.name) === lc(name)); if (t) t.blockedByMe = on; if (c) c.blocked = on; emit(); },

    // loading
    async loadInbox() {
      const r = await rpc("inbox", {});
      if (bad(r)) return r;
      s.inbox = r.conversations.map((c) => ({ ...c }));
      for (const n in r.online ?? {}) s.presence[lc(n)] = { online: true, lastSeen: null };
      for (const c of s.inbox) if (r.online && !r.online[c.name] && s.presence[lc(c.name)]?.stale) delete s.presence[lc(c.name)];
      sumUnread(); emit(); return r;
    },
    async openChat(name) {
      const k = lc(name); s.open = k; const t = thread(name); emit();
      const r = await rpc("thread", { with: name });
      if (s.open !== k) return;
      if (bad(r)) { t.loaded = t.loaded || t.msgs.length > 0; emit(); return r; }
      const waiting = t.msgs.filter((m) => m.id == null);
      t.msgs = waiting; merge(t, r.messages);
      t.hasMore = r.hasMore; t.loaded = true; t.name = r.with ?? t.name; apply(t, r);
      if (r.presence) s.presence[k] = { online: !!r.presence.online, lastSeen: r.presence.lastSeen };
      else if (r.presence === null) delete s.presence[k];
      emit(); api.markRead(); flush();
      return r;
    },
    closeChat() { s.open = null; emit(); },
    async syncOpen() { // after a reconnect, or on a poll: fetch only what is new
      const t = s.open && s.threads[s.open]; if (!t) return;
      const r = await rpc("thread", { with: t.name, ...(t.loaded && maxId(t) ? { after: maxId(t) } : {}) });
      if (bad(r) || s.open !== lc(t.name)) return;
      if (!t.loaded) { t.msgs = t.msgs.filter((m) => m.id == null); t.hasMore = r.hasMore; t.loaded = true; }
      merge(t, r.messages); apply(t, r); if (r.presence) s.presence[lc(t.name)] = r.presence;
      emit(); api.markRead();
    },
    async loadOlder(name) {
      const t = thread(name, false); if (!t || t.loadingOlder || !t.hasMore) return;
      const first = t.msgs.find((m) => m.id != null); if (!first) return;
      t.loadingOlder = true; emit();
      const r = await rpc("thread", { with: name, before: first.id });
      t.loadingOlder = false;
      if (!bad(r)) { merge(t, r.messages); t.hasMore = r.hasMore; }
      emit();
    },

    // actions
    send(name, body) {
      const text = cleanBody(body); if (!text) return null;
      const t = thread(name), m = { id: null, cid: newId(), mine: true, kind: KIND.TEXT, body: text, at: new Date(now()).toISOString(), st: "sending" };
      t.msgs.push(m); touchInbox(name, m, { reset: true }); sound("send"); delete sentTyping[lc(name)];
      api.typing(name, false); emit();
      dispatch(name, m);
      return m;
    },
    retry(name, cid) { const m = thread(name, false)?.msgs.find((x) => x.cid === cid); if (m && m.st === "failed") { m.st = "sending"; m.at = new Date(now()).toISOString(); emit(); dispatch(name, m); } },
    discard(name, cid) { const t = thread(name, false); if (t) { t.msgs = t.msgs.filter((x) => x.cid !== cid); emit(); } },
    /** Show a money card now. Returns a cid; call moneySent / moneyFailed when the server answers. */
    addMoney(name, { naira, note, cid = newId() }) {
      const t = thread(name), m = { id: null, cid, mine: true, kind: KIND.MONEY, body: moneyBody(naira, note), at: new Date(now()).toISOString(), st: "sending" };
      t.msgs.push(m); touchInbox(name, m, { reset: true }); emit(); return cid;
    },
    moneySent(name, cid, msg) {
      const t = thread(name, false), m = t?.msgs.find((x) => x.cid === cid); if (!m) return;
      if (msg?.id && t.msgs.some((x) => x !== m && x.id === msg.id)) t.msgs = t.msgs.filter((x) => x !== m); // the push got here first
      else { m.st = "sent"; if (msg?.id) { m.id = msg.id; m.at = msg.at ?? m.at; } }
      emit();
    },
    moneyFailed(name, cid) { const t = thread(name, false); if (t) { t.msgs = t.msgs.filter((x) => x.cid !== cid); emit(); } if (wantInbox) api.loadInbox(); if (s.open === lc(name)) api.syncOpen(); /* if the money did go (the answer was lost), its card comes back from the server */ },
    markRead() {
      const t = s.open && s.threads[s.open]; if (!t || !visible || !t.loaded) return;
      const last = t.msgs.reduce((m, x) => (!x.mine && x.id != null && x.id > m ? x.id : m), 0);
      const c = s.inbox?.find((x) => lc(x.name) === s.open);
      if (c && c.unread) { c.unread = 0; sumUnread(); emit(); }
      if (last > t.myRead || (c && c.id > t.myRead && !c.mine)) { t.myRead = Math.max(t.myRead, last); rpc("read", { with: t.name, upTo: last || undefined }); }
    },
    typing(name, on) {
      if (!transport?.connected()) return;
      const k = lc(name), t = now();
      if (on && t - (sentTyping[k] ?? 0) < 2500) return;
      if (!on && !sentTyping[k]) return;
      sentTyping[k] = on ? t : 0; transport.emit("typing", { to: name, on }, 1000).catch(() => {});
    },
    patchThread(name, patch) { const t = thread(name); Object.assign(t, patch); const c = s.inbox?.find((x) => lc(x.name) === lc(name)); if (c && "blockedByMe" in patch) c.blocked = patch.blockedByMe; emit(); },

    /** Called every few seconds while the socket is down: resend, and fetch what is new over plain HTTP. */
    async poll() {
      if (!s.me || transport?.connected()) return;
      tick++;
      await flush();
      if (s.open) await api.syncOpen();
      if (wantInbox && (tick % 4 === 0 || !s.inbox)) await api.loadInbox();
      else if (!s.open && !wantInbox && tick % 8 === 0) { const r = await http("unread", {}); if (!bad(r)) { s.unread = r.unread ?? 0; emit(); } }
    },
    flush,
  };
  api.tickOf = (m, t) => (m.st === "sending" ? "sending" : m.st === "failed" ? "failed" : tickOf(m.id, t.peerDel, t.peerRead));
  return api;
}
// lib3d/playerTags.js
// Name tags for OTHER REAL PLAYERS, drawn as small HTML buttons that follow each avatar's head on screen.
//
// Why HTML and not sprites: a button is a real tap target (44 px on touch), the text is crisp at any size, it is announced by screen readers, and the
// tags sit on their own layer above the 3D picture, so a drag that starts anywhere else still turns the camera and a tap that lands on a tag never
// reaches the camera or the joystick.
//
// Who may get a tag is decided here, in one place, whatever the caller passes in:
//   - it must be a real player (a non-empty id and name from the server's list of characters; anything flagged npc is refused),
//   - never the player's own character (compared by id and by name, case-insensitively).
// NPCs are built by other code (avatar/npc.js) and never reach this module: only entries the server listed as players are ever given to set().
import * as THREE from "three";

/** True when `p` may carry a name tag: a real player other than yourself. self = { id, name }. */
export function isTaggable(p, self = {}) {
  if (!p || p.npc === true || p.isNpc === true) return false;
  const id = typeof p.id === "string" ? p.id : "", name = typeof p.name === "string" ? p.name.trim() : "";
  if (!id || !name) return false;
  if (self.id && id === self.id) return false;
  if (self.name && name.toLowerCase() === String(self.name).trim().toLowerCase()) return false;
  return true;
}

const shown = (o) => { for (let n = o; n; n = n.parent) if (n.visible === false) return false; return true; };

/** What a tap on a tag does by default: ask the page's player menu (components/PlayerMenu.js) to open. */
const openMenu = (pick) => window.dispatchEvent(new CustomEvent("oau:player-menu", { detail: pick }));

/**
 * container: the element the 3D canvas lives in (it must be positioned). camera: the scene's camera.
 * selfName / selfId: your own character, which never gets a tag. unit: scene units per metre (the trip scene is drawn at 0.1).
 * visible(tag, cameraPos, headPos) -> false hides a tag (used inside buildings so nobody is named through a wall).
 * onPick(pick) replaces the default menu. Returns { set, remove, has, ids, update, dispose }.
 */
export function createPlayerTags({ container, camera, selfName = "", selfId = "", unit = 1, maxDist = 28, fadeFrom = 20, visible = null, onPick = null }) {
  const layer = document.createElement("div");
  layer.className = "pt-layer"; layer.dataset.playerTags = "1";
  layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:6";
  container.appendChild(layer);
  const tags = new Map(), self = { id: selfId, name: selfName }, cp = new THREE.Vector3(), hp = new THREE.Vector3(), pr = new THREE.Vector3();
  let W = layer.clientWidth || 1, H = layer.clientHeight || 1, dead = false;
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => { W = layer.clientWidth || 1; H = layer.clientHeight || 1; }) : null; ro?.observe(layer);
  const gone = (ids) => { if (ids.length) window.dispatchEvent(new CustomEvent("oau:player-gone", { detail: { ids } })); };

  /** Add or refresh the tag of one player. anchor: an Object3D at the top of their head (it moves with them). Returns false if the player may not have a tag. */
  function set(id, { name, anchor, meta = {}, npc = false } = {}) {
    if (dead) return false;
    if (!isTaggable({ id, name, npc }, self) || !anchor) { remove(id); return false; }
    let t = tags.get(id);
    if (!t) {
      const el = document.createElement("button");
      el.type = "button"; el.className = "pt-tag"; el.dataset.playerId = id; el.style.visibility = "hidden";
      t = { id, el, anchor, name: "", meta, vis: false, x: -9999, y: -9999, s: 1, o: 1, z: 0 };
      el.addEventListener("click", (e) => { e.stopPropagation(); const r = el.getBoundingClientRect(), cur = tags.get(id); if (cur) (onPick ?? openMenu)({ id, name: cur.name, ...cur.meta, x: r.left + r.width / 2, y: r.top, bottom: r.bottom }); });
      el.addEventListener("pointerdown", (e) => e.stopPropagation()); // a tap on a name is never the start of a camera drag
      layer.appendChild(el); tags.set(id, t);
    }
    t.anchor = anchor; t.meta = meta;
    if (t.name !== name) { t.name = name; t.el.textContent = name; t.el.title = name; t.el.setAttribute("aria-label", `${name}: open options`); }
    return true;
  }

  function remove(id) {
    const t = tags.get(id); if (!t) return;
    t.el.remove(); tags.delete(id); gone([id]);
  }

  /** Place every tag: call once per frame, after the camera has moved. */
  function update() {
    if (dead || !tags.size) return;
    camera.updateMatrixWorld(); camera.getWorldPosition(cp);
    for (const t of tags.values()) {
      let on = shown(t.anchor), d = 0;
      if (on) {
        t.anchor.getWorldPosition(hp); d = cp.distanceTo(hp) / unit;
        pr.copy(hp).project(camera);
        on = d <= maxDist && pr.z < 1 && Math.abs(pr.x) < 1.04 && Math.abs(pr.y) < 1.04 && (!visible || visible(t, cp, hp) !== false);
      }
      if (on !== t.vis) { t.vis = on; t.el.style.visibility = on ? "visible" : "hidden"; }
      if (!on) continue;
      const x = (pr.x * 0.5 + 0.5) * W, y = (-pr.y * 0.5 + 0.5) * H, s = d < 8 ? 1 : Math.max(0.82, 1 - (d - 8) / 70), o = d > fadeFrom ? Math.max(0.35, 1 - (d - fadeFrom) / (maxDist - fadeFrom)) : 1;
      if (Math.abs(x - t.x) > 0.4 || Math.abs(y - t.y) > 0.4 || Math.abs(s - t.s) > 0.01) { t.x = x; t.y = y; t.s = s; t.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-100%) scale(${s.toFixed(2)})`; }
      if (Math.abs(o - t.o) > 0.02) { t.o = o; t.el.style.opacity = o.toFixed(2); }
      const z = Math.max(1, 1000 - Math.round(d)); if (z !== t.z) { t.z = z; t.el.style.zIndex = z; } // the nearer one is on top when two overlap
    }
  }

  function dispose() {
    if (dead) return; dead = true; const ids = [...tags.keys()];
    for (const t of tags.values()) t.el.remove(); tags.clear(); ro?.disconnect(); layer.remove(); gone(ids);
  }
  return { set, remove, has: (id) => tags.has(id), ids: () => [...tags.keys()], update, dispose, layer };
}
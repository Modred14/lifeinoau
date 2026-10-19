// components/RoomStage.js
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** The 3D room. It owns the canvas and a small tool bar that floats above the selected piece of furniture.
 *  `apiRef.current` gives the parent the scene's methods (rotateView, pulse, rotateSelected, goToBed, wakeUp, cancelSleep, ...).
 *  Sleep callbacks: onAsleep(id) the character is lying down; onAwake() fully standing again; onWakeTap() the player tapped the floor
 *  to get up (the scene already runs the get-up); onSleepCancel() the player tapped the floor while still walking to the bed. */
export default function RoomStage({ room, items, roomError, onRetry, look, gender, mode, selected, onSelect, onMove, onUse, onAsleep, onAwake, onWakeTap, onSleepCancel, apiRef, tool }) {
  const box = useRef(null), bar = useRef(null), scene = useRef(null), cbs = useRef({}), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  cbs.current = { onSelect, onMove, onUse, onAsleep, onAwake, onWakeTap, onSleepCancel };
  const roomKey = room ? `${room.w}x${room.d}:${room.theme}:${room.layout ?? ""}:${room.grime ?? 0}` : "", lookKey = JSON.stringify([look ?? null, gender]);

  useEffect(() => {
    let alive = true, s = null;
    (async () => {
      try {
        const { createRoomScene } = await import("../lib3d/room.js"); if (!alive) return;
        s = createRoomScene(box.current, {
          onSelect: (id) => cbs.current.onSelect?.(id),
          onMove: (id, p) => cbs.current.onMove?.(id, p),
          onUse: (u) => cbs.current.onUse?.(u),
          onAsleep: (id) => cbs.current.onAsleep?.(id),
          onAwake: () => cbs.current.onAwake?.(),
          onWakeTap: () => cbs.current.onWakeTap?.(),
          onSleepCancel: () => cbs.current.onSleepCancel?.(),
        });
        s.attachToolbar(bar.current); scene.current = s; if (apiRef) apiRef.current = s; setReady(true);
      } catch (e) { console.error("3D room unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; if (apiRef) apiRef.current = null; scene.current = null; s?.dispose(); };
  }, [apiRef]);

  useEffect(() => { if (ready && room) scene.current.setRoom(room); }, [ready, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && room && items) scene.current.setItems(items); }, [ready, items, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) scene.current.setAvatar(look ?? undefined, gender); }, [ready, lookKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) scene.current.setMode(mode); }, [ready, mode]);
  useEffect(() => { if (ready) scene.current.select(selected ?? null, true); }, [ready, selected]);

  return (
    <div className="rs" data-ready={ready && room && items ? "1" : "0"}>
      <div ref={box} className="rs-canvas" role="img" aria-label="Your room in 3D. Drag to look around. In Buy mode, drag furniture to move it." />
      {/* the room is only drawn when the 3D scene AND the room's data (size, look and furniture) are both here: never a half-furnished room */}
      {(!ready || !room || !items) && !failed && !roomError && <div className="rs-loading" aria-busy="true" role="status"><span className="rs-spin" />Setting up your room</div>}
      {roomError && !room && !failed && <div className="rs-loading rs-err" role="alert"><span>{roomError}</span><button type="button" className="go" onClick={() => onRetry?.()}>Try again</button></div>}
      {failed && <div className="rs-loading">Your room could not load on this device.</div>}
      <div ref={bar} className="rs-tb" data-on="0">
        {tool && (
          <div className="rs-tbin" role="toolbar" aria-label={tool.name}>
            <b>{tool.name}</b>
            <button type="button" onClick={tool.onRotate} aria-label="Turn"><Icon name="spin" size={18} /><span>Turn</span></button>
            <button type="button" onClick={tool.onStore} aria-label="Put in storage"><Icon name="box" size={18} /><span>Store</span></button>
            {tool.sellLabel && <button type="button" className="rs-sell" onClick={tool.onSell} aria-label={`Sell for ${tool.sellLabel}`}><Icon name="sell" size={18} /><span>Sell {tool.sellLabel}</span></button>}
          </div>
        )}
      </div>
    </div>
  );
}
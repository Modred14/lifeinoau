// components/RoomStage.js
"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

/** The 3D room. It owns the canvas and a small tool bar that floats above the selected piece of furniture.
 *  `apiRef.current` gives the parent the scene's methods (rotateView, pulse, rotateSelected). */
export default function RoomStage({ room, items, look, gender, mode, selected, onSelect, onMove, apiRef, tool }) {
  const box = useRef(null), bar = useRef(null), scene = useRef(null), cbs = useRef({}), [ready, setReady] = useState(false), [failed, setFailed] = useState(false);
  cbs.current = { onSelect, onMove };
  const roomKey = room ? `${room.w}x${room.d}:${room.theme}:${room.grime ?? 0}` : "", lookKey = JSON.stringify([look ?? null, gender]);

  useEffect(() => {
    let alive = true, s = null;
    (async () => {
      try {
        const { createRoomScene } = await import("../lib3d/room.js"); if (!alive) return;
        s = createRoomScene(box.current, { onSelect: (id) => cbs.current.onSelect?.(id), onMove: (id, p) => cbs.current.onMove?.(id, p) });
        s.attachToolbar(bar.current); scene.current = s; if (apiRef) apiRef.current = s; setReady(true);
      } catch (e) { console.error("3D room unavailable", e); if (alive) setFailed(true); }
    })();
    return () => { alive = false; if (apiRef) apiRef.current = null; scene.current = null; s?.dispose(); };
  }, [apiRef]);

  useEffect(() => { if (ready && room) scene.current.setRoom(room); }, [ready, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready && room) scene.current.setItems(items ?? []); }, [ready, items, roomKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) scene.current.setAvatar(look ?? undefined, gender); }, [ready, lookKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ready) scene.current.setMode(mode); }, [ready, mode]);
  useEffect(() => { if (ready) scene.current.select(selected ?? null, true); }, [ready, selected]);

  return (
    <div className="rs" data-ready={ready ? "1" : "0"}>
      <div ref={box} className="rs-canvas" role="img" aria-label="Your room in 3D. Drag to look around. In Buy mode, drag furniture to move it." />
      {!ready && !failed && <div className="rs-loading" aria-busy="true"><span className="rs-spin" />Setting up your room</div>}
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
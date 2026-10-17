"use client";

/**
 * Client-only game canvas: joins the campus room, then starts the 3D view
 * in a full-screen div. Loaded via next/dynamic with ssr:false (see GameShell).
 */
import { useEffect, useRef } from "react";
import { Callbacks } from "@colyseus/sdk";
import { CampusView } from "@campus/game/CampusView";
import { clearSession, joinCampus, joinErrorMessage, leaveCampus, leaveMessage, type CampusRoom } from "@campus/game/network";

export type ConnectionStatus = "connecting" | "online" | "reconnecting" | "disconnected";

interface Props {
  name: string;
  look: string;
  school: string;
  level: string;
  department: string;
  fresh?: boolean;
  onStatus: (s: ConnectionStatus) => void;
  onOnline: (count: number) => void;
  onError: (message: string) => void;
  onView: (view: CampusView | null) => void;
}

export default function GameCanvas({ name, look, school, level, department, fresh, onStatus, onOnline, onError, onView }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cb = useRef({ onStatus, onOnline, onError, onView });
  cb.current = { onStatus, onOnline, onError, onView };
  // Look is only needed at join time; later changes go through view.setLook().
  const lookAtJoin = useRef(look);
  const schoolAtJoin = useRef(school);
  const levelAtJoin = useRef(level);
  const departmentAtJoin = useRef(department);
  const freshAtJoin = useRef(!!fresh);

  useEffect(() => {
    let disposed = false;
    let room: CampusRoom | undefined;
    let view: CampusView | undefined;

    joinCampus(name, lookAtJoin.current, schoolAtJoin.current, levelAtJoin.current, departmentAtJoin.current, freshAtJoin.current, () => disposed)
      .then((r) => {
        if (!r) return;
        if (disposed) {
          void leaveCampus(r);
          return;
        }
        room = r;
        cb.current.onStatus("online");

        const $ = Callbacks.get(r);
        const report = () => cb.current.onOnline(Math.max(r.state.online, r.state.players.size));
        $.listen("online", report);
        $.onAdd("players", report);
        $.onRemove("players", report);

        r.onDrop(() => cb.current.onStatus("reconnecting"));
        r.onReconnect(() => cb.current.onStatus("online"));
        r.onLeave((code) => {
          if (disposed) return;
          clearSession();
          const reason = leaveMessage(code);
          if (reason) cb.current.onError(reason);
          else cb.current.onStatus("disconnected");
        });

        // Labels are drawn onto canvases once, so make sure the UI font is ready first.
        return document.fonts.ready.then(() => {
          if (disposed || !containerRef.current) return;
          view = new CampusView(containerRef.current, r);
          cb.current.onView(view);
          // Dev-only handle for debugging in the browser console.
          if (process.env.NODE_ENV !== "production") (window as unknown as { __oau?: CampusView }).__oau = view;
        });
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.error("[Campus Life] join failed", err);
        cb.current.onError(joinErrorMessage(err));
      });

    return () => {
      disposed = true;
      cb.current.onView(null);
      view?.destroy();
      if (room) {
        void leaveCampus(room);
        clearSession();
      }
    };
  }, [name]);

  return <div ref={containerRef} className="game-root" />;
}

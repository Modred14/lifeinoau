import { Msg, ServerMsg, parseSocialStatus, type SocialAction, type SocialStatus } from "@campuslife/shared";
import type { CampusRoom } from "../network";

const REFRESH_MS = 60_000;

export class SocialLink {
  status: SocialStatus | null = null;
  private listeners = new Set<() => void>();
  private unsubscribe: () => void;
  private timer: number;

  constructor(private room: CampusRoom) {
    this.unsubscribe = room.onMessage(ServerMsg.Social, (payload: unknown) => {
      const status = parseSocialStatus(payload);
      if (!status) return;
      this.status = status;
      for (const listener of this.listeners) listener();
    });
    this.timer = window.setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  send(action: SocialAction) {
    this.room.send(Msg.Social, action);
  }

  refresh() {
    this.send({ a: "status" });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): SocialStatus | null => this.status;

  dispose() {
    window.clearInterval(this.timer);
    this.unsubscribe();
    this.listeners.clear();
  }
}

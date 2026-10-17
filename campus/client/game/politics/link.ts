import { Msg, ServerMsg, parsePoliticsStatus, parseRace, parseUnionWorld, setKnownHolders, showRentedBanners, termCycle, type GameTime, type PoliticsAction, type PoliticsStatus, type UnionWorld } from "@campuslife/shared";
import type { CampusRoom } from "../network";
import { noteUnion } from "../gist-view";

const REFRESH_MS = 120_000;

export type PoliticsPanel = { kind: "form" } | { kind: "ballot"; unit: string };
export type PoliticsSend = PoliticsAction | { a: "form"; post: string; nick: number; slogan: number; color: number };

export class PoliticsLink {
  status: PoliticsStatus | null = null;
  world: UnionWorld | null = null;
  onPanel?: (panel: PoliticsPanel) => void;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void)[];
  private timer: number;
  private speakingUntil = 0;

  constructor(private room: CampusRoom, private now: () => GameTime) {
    this.unsubscribe = [
      room.onMessage(ServerMsg.Politics, (payload: unknown) => {
        const status = parsePoliticsStatus(payload);
        if (!status) return;
        this.status = status;
        this.speakingUntil = performance.now() + (status.mine?.speakingMs ?? 0);
        setKnownHolders(termCycle(this.now()), status.holders.flatMap((h) => {
          const post = parseRace(h.race)?.post;
          return post ? [{ post: post.id, name: h.name }] : [];
        }));
        this.emit();
      }),
      room.onMessage(ServerMsg.Union, (payload: unknown) => {
        const world = parseUnionWorld(payload);
        if (!world) return;
        this.world = world;
        noteUnion(world);
        showRentedBanners(world.cycle, world.rentals);
        this.emit();
      }),
    ];
    this.timer = window.setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  get speaking(): boolean {
    return performance.now() < this.speakingUntil;
  }

  send(action: PoliticsSend) {
    this.room.send(Msg.Politics, action);
  }

  refresh() {
    this.send({ a: "status" });
  }

  open(panel: PoliticsPanel) {
    this.refresh();
    this.onPanel?.(panel);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): PoliticsStatus | null => this.status;
  worldSnapshot = (): UnionWorld | null => this.world;

  dispose() {
    window.clearInterval(this.timer);
    for (const off of this.unsubscribe) off();
    this.listeners.clear();
    showRentedBanners(-1, []);
    noteUnion(null);
  }
}

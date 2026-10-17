"use client";

/**
 * The phone: a handset on screen with its own lock screen, home screen and
 * apps (food delivery, school, wallet, phone store, maps). Lazily loaded so
 * the map data stays out of the start bundle.
 */
import { useState } from "react";
import dynamic from "next/dynamic";
import type { CampusView, OrdersView } from "@campus/game/CampusView";
import { GameIcon } from "./GameIcon";
import { GamePanel } from "./GamePanel";
import { PhoneOs } from "./phone/phone-os";
import "./phone/phone.css";
import "./phone/lifestyle.css";

const FullMap = dynamic(() => import("./FullMap"), { ssr: false });

export default function PhoneSheet({ view, orders, onClose }: { view: CampusView; orders: OrdersView | null; onClose: () => void }) {
  const [mapOpen, setMapOpen] = useState(false);
  if (mapOpen) return <FullMap view={view} onClose={onClose} />;
  return (
    <GamePanel className="phone-stage" label="Phone" onClose={onClose}>
      <PhoneOs view={view} orders={orders} onClose={onClose} onOpenMap={() => setMapOpen(true)} />
      <button type="button" className="ph-away" onClick={onClose}>
        <GameIcon name="close" />
        Put phone away
      </button>
    </GamePanel>
  );
}

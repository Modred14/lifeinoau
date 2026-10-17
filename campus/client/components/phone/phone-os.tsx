"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { CampusView, OrdersView } from "@campus/game/CampusView";
import { AppChop } from "./app-chop";
import { AppErrands } from "./app-errands";
import { AppEvents } from "./app-events";
import { AppFrame } from "./app-frame";
import { AppSchool } from "./app-school";
import { AppStore } from "./app-store";
import { AppWallet } from "./app-wallet";
import { AppUnion } from "./app-union";
import { AppBrowser, AppWeb } from "./app-web";
import { AppPhoneSettings } from "./app-phone-settings";
import { findApp, type AppId } from "./apps";
import { batteryAt, hhmm, naira } from "./format";
import { HomeScreen } from "./home-screen";
import { lockNotification } from "./lock-notification";
import { LockScreen } from "./lock-screen";
import { NavBar } from "./nav-bar";
import { PhoneDevice } from "./phone-device";
import { StatusBar } from "./status-bar";
import { usePhoneLive } from "./use-phone-live";

type OpenApp = Exclude<AppId, "maps">;

interface PhoneOsProps {
  view: CampusView;
  orders: OrdersView | null;
  onClose: () => void;
  onOpenMap: () => void;
}

export function PhoneOs({ view, orders, onClose, onOpenMap }: PhoneOsProps) {
  const live = usePhoneLive(view);
  const [locked, setLocked] = useState(true);
  const [app, setApp] = useState<OpenApp | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const lastApp = useRef<OpenApp | null>(null);
  const mounted = useRef(false);
  const { phone, timetable } = live;
  const time = hhmm(timetable.minute);
  const screen = locked ? "lock" : (app ?? "home");

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const root = viewRef.current;
    const tile = screen === "home" && lastApp.current ? root?.querySelector<HTMLElement>(`[data-app="${lastApp.current}"]`) : null;
    (tile ?? root?.querySelector<HTMLElement>("button:not(:disabled)"))?.focus({ preventScroll: true });
  }, [screen]);

  const open = (id: AppId) => {
    if (id === "maps") return onOpenMap();
    lastApp.current = id;
    setApp(id);
  };
  const goHome = () => setApp(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !app) return;
    event.preventDefault();
    event.stopPropagation();
    goHome();
  };

  return (
    <PhoneDevice phone={phone}>
      <div className={`ph-os ph-os-${locked ? "lock" : app ? "app" : "home"}`} onKeyDown={onKeyDown}>
        <StatusBar platform={phone.platform} time={time} battery={batteryAt(timetable.minute)} />
        <div className="ph-view" key={screen} ref={viewRef}>
          {locked && (
            <LockScreen platform={phone.platform} day={timetable.today} time={time} notification={lockNotification(orders, timetable)} onUnlock={() => setLocked(false)} />
          )}
          {!locked && !app && <HomeScreen platform={phone.platform} day={timetable.today} badges={{ chop: orders?.packs ?? 0 }} live={live} onOpen={open} />}
          {!locked && app && (
            <AppFrame platform={phone.platform} title={app === "browser" ? (phone.platform === "ios" ? "Safari" : "Chrome") : findApp(app).label} onBack={goHome} balance={naira(live.cash)}>
              {(app === "chop" || app === "chowdeck" || app === "glovo") && <AppChop view={view} orders={orders} live={live} brand={app} onClose={onClose} />}
              {app === "errands" && <AppErrands view={view} onClose={onClose} />}
              {app === "school" && <AppSchool view={view} timetable={timetable} onClose={onClose} />}
              {app === "wallet" && <AppWallet cash={live.cash} debt={live.debt} />}
              {app === "union" && <AppUnion view={view} onClose={onClose} />}
              {app === "store" && <AppStore view={view} phone={phone} cash={live.cash} live={live} />}
              {app === "events" && <AppEvents view={view} timetable={timetable} onClose={onClose} />}
              {app === "browser" && <AppBrowser />}
              {app === "settings" && <AppPhoneSettings phone={phone} onStore={() => open("store")} onLock={() => { setApp(null); setLocked(true); }} />}
              {["facebook", "twitter", "instagram", "whatsapp", "youtube", "spotify"].includes(app) && <AppWeb key={app} app={findApp(app)} />}
            </AppFrame>
          )}
        </div>
        {!locked && <NavBar platform={phone.platform} active={!!app} onHome={goHome} />}
      </div>
    </PhoneDevice>
  );
}

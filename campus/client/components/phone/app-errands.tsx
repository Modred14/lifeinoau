"use client";

import { useMemo } from "react";
import type { CampusView } from "@campus/game/CampusView";
import { MarketFlow } from "@campus/components/market/market-flow";

export function AppErrands({ view, onClose }: { view: CampusView; onClose: () => void }) {
  const from = useMemo(() => view.getRadar().me, [view]);
  return (
    <MarketFlow
      from={from}
      onWalk={(vendor) => {
        if (!vendor.point) return;
        view.goTo(vendor.point, vendor.name);
        onClose();
      }}
    />
  );
}

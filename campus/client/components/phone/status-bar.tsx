import type { PhonePlatform } from "@campuslife/shared";
import { PHONE_CARRIER } from "@campuslife/shared";
import { PiBatteryFullFill, PiBatteryHighFill, PiBatteryLowFill, PiBatteryMediumFill, PiCellSignalHighFill, PiWifiHighFill } from "react-icons/pi";

const BATTERY_STEPS = [
  { above: 80, icon: PiBatteryFullFill },
  { above: 55, icon: PiBatteryHighFill },
  { above: 30, icon: PiBatteryMediumFill },
  { above: -1, icon: PiBatteryLowFill },
];

export function StatusBar({ platform, time, battery }: { platform: PhonePlatform; time: string; battery: number }) {
  const Battery = (BATTERY_STEPS.find((step) => battery > step.above) ?? BATTERY_STEPS[0]).icon;
  return (
    <div className="ph-status" role="group" aria-label={`${time}, ${PHONE_CARRIER}, battery ${battery} percent`}>
      <span className="ph-status-time" aria-hidden="true">{time}</span>
      {platform === "android" && <span className="ph-status-carrier" aria-hidden="true">{PHONE_CARRIER}</span>}
      <span className="ph-status-icons" aria-hidden="true">
        <PiCellSignalHighFill />
        <PiWifiHighFill />
        {platform === "android" && <span className="ph-status-pct">{battery}%</span>}
        <Battery className="ph-status-battery" />
      </span>
    </div>
  );
}

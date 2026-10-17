import type { CSSProperties } from "react";
import Image from "next/image";
import type { PhoneApp } from "./apps";

export function AppIcon({ app, small = false, badge = 0 }: { app: PhoneApp; small?: boolean; badge?: number }) {
  const Icon = app.icon;
  const style = { "--ph-tint-a": app.tint[0], "--ph-tint-b": app.tint[1] } as CSSProperties;
  return (
    <span className={small ? "ph-icon ph-icon-small" : "ph-icon"} style={style} aria-hidden="true">
      {app.image ? <Image src={app.image} alt="" width={128} height={128} unoptimized /> : <Icon />}
      {badge > 0 && <span className="ph-badge">{badge}</span>}
    </span>
  );
}

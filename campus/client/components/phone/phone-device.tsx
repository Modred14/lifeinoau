import type { CSSProperties, ReactNode } from "react";
import type { Phone } from "@campuslife/shared";

function frameVars(phone: Phone): CSSProperties {
  const { frame } = phone;
  return {
    "--ph-body": frame.body,
    "--ph-edge": frame.edge,
    "--ph-aspect": frame.aspect,
    "--ph-radius": frame.radius,
    "--ph-bezel": frame.bezel,
    "--ph-chin": frame.chin,
    "--ph-wall-a": frame.wallpaper[0],
    "--ph-wall-b": frame.wallpaper[1],
    "--ph-wall-c": frame.wallpaper[2],
    "--ph-accent": frame.accent,
    "--ph-wallpaper": phone.wallpaper ? `url("${phone.wallpaper}")` : "none",
  } as CSSProperties;
}

export function PhoneDevice({ phone, preview = false, children }: { phone: Phone; preview?: boolean; children?: ReactNode }) {
  const { frame, platform } = phone;
  const className = `ph-device ph-${platform} ph-cut-${frame.cutout} ph-finish-${frame.finish}${preview ? " ph-preview" : ""}`;
  return (
    <div className={className} data-model={phone.id} style={frameVars(phone)} aria-hidden={preview || undefined}>
      <span className="ph-key ph-key-a" aria-hidden="true" />
      <span className="ph-key ph-key-b" aria-hidden="true" />
      <span className="ph-key ph-key-c" aria-hidden="true" />
      <div className="ph-screen">
        {children}
        <span className="ph-cutout" aria-hidden="true" />
        <span className="ph-glare" aria-hidden="true" />
      </div>
    </div>
  );
}

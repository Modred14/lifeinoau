// components/SoundEngine.js
// Mounted once in the root layout. Starts the background song and the tap/click sounds (see lib/sound.js). Renders nothing.
"use client";
import { useEffect } from "react";
import { initSound } from "@/lib/sound";

export default function SoundEngine() {
  useEffect(() => initSound(), []);
  return null;
}
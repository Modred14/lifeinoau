// components/phoneContext.js
// True for everything drawn inside the handset (components/Phone.js). The shared <Loader> reads it: out in the game it draws the lifeinoau
// logo, but inside the phone it is just a spinner (so every app's loading state matches without editing each app).
"use client";
import { createContext } from "react";

export const InPhone = createContext(false);
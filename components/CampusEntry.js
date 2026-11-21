// components/CampusEntry.js
// Tells the server "this player has entered the game", once per visit (one browser tab's session), so the campus population can grow (docs/CAMPUS-POPULATION.md).
// Mounted by the Shell only while a character is loaded, like BusyAlerts: a refresh or moving between pages in the same visit reports nothing again, and even when
// something is sent twice the server counts at most one entry per player per cool-down. It draws nothing.
"use client";
import { useEffect } from "react";
import { reportEntry } from "@/lib/populationClient";

export default function CampusEntry({ characterId }) {
  useEffect(() => { if (characterId) reportEntry(characterId); }, [characterId]);
  return null;
}

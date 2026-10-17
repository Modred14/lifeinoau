import { useCallback, useMemo, useState } from "react";
import {
  STUDENT_OUTFITS,
  applyStudentOutfit,
  decodeLook,
  encodeLook,
  randomLook,
  slotOptions,
  type Look,
  type OutfitGroup,
} from "@campuslife/shared/avatar";
import { partConfig, wardrobeThumbnailRequests, type WardrobeTab } from "./model";

export function useWardrobe(initialLook: string) {
  const [look, setLook] = useState<Look>(() => decodeLook(initialLook));
  const [tab, setTab] = useState<WardrobeTab>("body");
  const [group, setGroup] = useState<OutfitGroup>("All");
  const [turn, setTurn] = useState(0);
  const encoded = useMemo(() => encodeLook(look), [look]);
  const update = useCallback((patch: Partial<Look>) => {
    setLook((current) => decodeLook(encodeLook({ ...current, ...patch })));
  }, []);
  const chooseOutfit = useCallback((id: string) => setLook((current) => applyStudentOutfit(current, id)), []);
  const shuffle = useCallback(() => setLook(randomLook()), []);
  const reset = useCallback(() => { setLook(decodeLook(initialLook)); setTurn(0); }, [initialLook]);
  const selectedOutfit = useMemo(() => STUDENT_OUTFITS.find((outfit) =>
    Object.entries(outfit.looks[look.body]).every(([key, value]) => look[key as keyof Look] === value),
  ), [look]);
  const visibleOutfits = useMemo(() => STUDENT_OUTFITS.filter((outfit) => group === "All" || outfit.group === group), [group]);
  const part = partConfig(tab);
  const slot = part?.slot ?? "top";
  const options = useMemo(() => slotOptions(look.body, slot), [look.body, slot]);
  const thumbnailRequests = useMemo(() => wardrobeThumbnailRequests(look, tab, options), [look, tab, options]);
  const topLabel = slotOptions(look.body, "top").find((option) => option.id === look.top)?.parts.top;
  const shoesLabel = slotOptions(look.body, "shoes").find((option) => option.id === look.shoes)?.parts.shoes;
  return {
    look, tab, setTab, group, setGroup, turn, setTurn, encoded, update, chooseOutfit,
    shuffle, reset, selectedOutfit, visibleOutfits, part, options, thumbnailRequests, topLabel, shoesLabel,
  };
}

export type WardrobeState = ReturnType<typeof useWardrobe>;

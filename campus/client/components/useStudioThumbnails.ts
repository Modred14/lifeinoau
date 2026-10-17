"use client";

import { useEffect, useRef, useState } from "react";
import type { StudioThumbnailRequest, StudioThumbnails } from "@campus/game/studio-thumbnails";
import { CHARACTER_ASSET_VERSIONS } from "@campus/game/character-assets";

const cache = new Map<string, string>();
const assetVersion = Object.values(CHARACTER_ASSET_VERSIONS).join("");
const cacheKey = (request: StudioThumbnailRequest) => `${assetVersion}:${request.slot}:${request.look}`;

export function useStudioThumbnails(requests: StudioThumbnailRequest[]) {
  const renderer = useRef<StudioThumbnails | null>(null);
  const pending = useRef<Promise<void>>(Promise.resolve());
  const [rendered, setRendered] = useState<{ signature: string; images: Record<string, string> }>({ signature: "", images: {} });
  const signature = JSON.stringify(requests);

  useEffect(() => {
    if (signature === "[]") return;
    let active = true;
    const run = async () => {
      if (!active) return;
      const { StudioThumbnails } = await import("@campus/game/studio-thumbnails");
      if (!active) return;
      renderer.current ??= new StudioThumbnails();
      for (const request of JSON.parse(signature) as StudioThumbnailRequest[]) {
        if (!active) return;
        let image = cache.get(cacheKey(request));
        if (!image) {
          try {
            image = await renderer.current.render(request, () => active);
          } catch {
            continue;
          }
          if (!active) return;
          if (!image) continue;
          cache.set(cacheKey(request), image);
          if (cache.size > 64) cache.delete(cache.keys().next().value!);
        }
        setRendered((current) => ({
          signature,
          images: { ...(current.signature === signature ? current.images : {}), [request.key]: image! },
        }));
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    };
    pending.current = pending.current.then(run).catch(() => {});
    return () => { active = false; };
  }, [signature]);

  useEffect(() => () => {
    renderer.current?.dispose();
    renderer.current = null;
  }, []);

  return rendered.signature === signature ? rendered.images : {};
}

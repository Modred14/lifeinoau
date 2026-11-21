@AGENTS.md

## Assets (3D models, textures, map data, audio)
Never load an asset directly (no `GLTFLoader`, `TextureLoader`, `fetch("/models/...")`, `new Audio("/audio/...")`). Use `lib3d/assets` (`acquireGltf`, `acquireTexture`, `loadJson`, `assetUrl`):
it versions, deduplicates, caches and measures everything, and `npm run assets:check` / `npm run build` fail on a direct load. Procedure and rules: `docs/ASSETS.md`.

## Campus population and building occupancy
The header's visited-today figure (an icon and a number, no words) is simulated and the map's "N people inside" is real. Keep them separate, server-decided and never shown at zero: read `docs/CAMPUS-POPULATION.md` and `docs/BUILDING-OCCUPANCY.md` ("Rules a future change must keep") before changing either.

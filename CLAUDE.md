@AGENTS.md

## Assets (3D models, textures, map data, audio)
Never load an asset directly (no `GLTFLoader`, `TextureLoader`, `fetch("/models/...")`, `new Audio("/audio/...")`). Use `lib3d/assets` (`acquireGltf`, `acquireTexture`, `loadJson`, `assetUrl`):
it versions, deduplicates, caches and measures everything, and `npm run assets:check` / `npm run build` fail on a direct load. Procedure and rules: `docs/ASSETS.md`.

<!-- docs/NPC_AVATARS.md -->
# NPC avatars
Cause of the old gap: the player is a rigged GLB character built by `lib3d/avatar/loadAvatar.js` (`createAvatar`). NPCs bypassed it: road pedestrians were instanced boxes (`traffic.js`), travellers seen on foot used `makeWalker` boxes, and the lecture-fight / DSA cast used the `toonFigure.js` box rig.

Now every person goes through `createAvatar`:
- `avatar/npc.js` – `npcSpec(seed, {gender, role})` (varied skin, gender-appropriate hair, outfit, colours, build, head shape) and `createNpc` (lighter models + distance LOD via `av.tick`).
- `tools/avaters/make_npc_lod.mjs` – builds `public/models/avatars/lod/*` (50% triangles, 1024px textures). Re-run after changing a model.
- `avatar/npcClips.js` – generated clips: run, cheer, sit, phone, talk, lookAround.
- `avatar/figureRig.js` – poses a GLB with the cutscene joint-angle poses (lecture fight, DSA).
- `traffic.js` – walking NPCs are avatars, pause to phone/chat/look around, get a new look when respawned out of sight; walking on foot players are drawn with their own look.
- `lectureScene.js` – player (own look), lecturer, DSA officers, driver and crowd are avatars; box figure remains as fallback.

Limits: models have no face morphs (no expressions/blink variety), no accessory models (backpacks, glasses, caps), skirts can show a knee when legs swing wide.
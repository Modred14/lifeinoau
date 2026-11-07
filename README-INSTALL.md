# Vehicle audio, town ambience and car radio for LifeinOAU
Built on commit d9968e1 (main).

Install (either way):
  A) unzip over the repo root (paths match the repo), or
  B) cd into the repo and run:  git apply vehicle-audio-radio.patch

Then:
  node tests/vehicle-audio.test.mjs && node tests/radio.test.mjs && node tests/trip-controls.test.mjs
  npx next build          (not verified in my sandbox: it cannot download Google Fonts)

Radio: public/data/radio-stations.json is EMPTY on purpose (no stream could be verified from my sandbox).
Add real stream URLs to tools/radio/candidates.json, then on a machine with internet:
  node tools/radio/verify-stations.mjs --write

Optional sound check (offline render, needs a dev-only package):
  npm i --no-save node-web-audio-api && node tools/audio/render-check.mjs --wav   (wav files go to /tmp/lifeinoau-audio)

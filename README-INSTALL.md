# Vehicle audio, town ambience and car radio for LifeinOAU
Built on commit d9968e1 (main).

Install (either way):
  A) unzip over the repo root (paths match the repo), or
  B) cd into the repo and run:  git apply vehicle-audio-radio.patch

Then:
  node tests/vehicle-audio.test.mjs && node tests/radio.test.mjs && node tests/trip-controls.test.mjs
  npx next build          (not verified in my sandbox: it cannot download Google Fonts)

Radio (Nigerian stations only; there is no radio volume control, the radio plays at a fixed level):
public/data/radio-stations.json is EMPTY until you run the steps below. A station gets into it ONLY by playing in a real browser (an HTTP 200 proves nothing about audio).
On a machine with normal internet access:
  npm i -D playwright && npx playwright install chromium     (AAC stations: set PLAYWRIGHT_CHANNEL=chrome to use installed Google Chrome)
  npm run radio:discover                  find Nigerian candidates (radio-browser.info) -> tools/radio/candidates.json  (add --dry to preview)
  npm run radio:verify:browser            play every candidate in Chromium (desktop + emulated phone) and print a report; changes nothing
  npm run radio:verify:browser -- --write make public/data/radio-stations.json exactly the stations that played
  npm run radio:verify:browser -- --check re-test the stations already in the game (run it on a schedule: streams move and die)
Then listen to the list once yourself: a stream can play without being what its name says. The build only re-checks the list and drops streams that are definitely gone; it never adds one.

Optional sound check (offline render, needs a dev-only package):
  npm i --no-save node-web-audio-api && node tools/audio/render-check.mjs --wav   (wav files go to /tmp/lifeinoau-audio)

#!/bin/sh
# tools/oau/import-campus.sh: regenerate tools/oau/maps/osm/oau-campus.json (the OpenStreetMap campus in the game's map schema; activate it with: node tools/oau/use-map.mjs osm) from the campus-archive branch. Run from the repo root.
#   needs: git, node, python3 with numpy and shapely (pip install numpy shapely)
set -e
T=$(mktemp -d)
git fetch -q origin campus-archive
git show origin/campus-archive:campus/shared/src/data/campus.json > "$T/campus.json"
git show origin/campus-archive:campus/shared/src/data/building-heights.json > "$T/heights.json"
node tools/oau/dump-legacy-merged.mjs "$T/legacy-merged.json"
python3 tools/oau/import_campus.py --campus "$T/campus.json" --heights "$T/heights.json" --old "$T/legacy-merged.json" --out tools/oau/maps/osm/oau-campus.json --report docs/new-map-import-report.json
rm -rf "$T"

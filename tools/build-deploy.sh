#!/bin/bash
# Fork "wishes": bin/nodejs/deploy.zip as src/deploy.sh makes it, without questions, with '/' paths (tools/mkzip.py),
# and only when the display check keeps all its rules (tools/display-check: the search on the display at the box's
# sizes, as the parents test it). Usage: bash tools/build-deploy.sh   (a clean working tree; Chrome for the check)
set -e
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "Arbeitsverzeichnis nicht sauber"; git status --short; exit 1; }
LOG="$(mktemp)"
rm -rf src/deploy
npm run build > "$LOG" 2>&1 || { tail -n 30 "$LOG"; exit 1; }
cd src
mv deploy/www/browser/* deploy/www/ && rmdir deploy/www/browser
rm -f deploy/www/3rdpartylicenses.txt deploy/www/prerendered-routes.json
cp backend-player/README.md deploy/
cd ..
# the display check on what goes into the zip: a broken rule stops the build (nothing is zipped)
[ -d tools/display-check/node_modules ] || (cd tools/display-check && npm install --no-audit --no-fund > /dev/null)
if ! node tools/display-check/check.mjs src/deploy/www; then
  echo "Display-Prüfung nicht bestanden - deploy.zip NICHT gebaut"
  exit 1
fi
# (once more in a theme of the children: the boxes use km themes - einhorn, light, with the cover stage)
if ! node tools/display-check/check.mjs src/deploy/www --theme einhorn; then
  echo "Display-Prüfung (Einhorn) nicht bestanden - deploy.zip NICHT gebaut"
  exit 1
fi
cd src
python -I ../tools/mkzip.py deploy ../bin/nodejs/deploy.zip
rm -rf deploy
cd ..
PREV="$(mktemp -d)"
git show HEAD:bin/nodejs/deploy.zip > "$PREV/prev.zip"
diff <(unzip -Z1 "$PREV/prev.zip" | grep -v '/$' | sort) <(unzip -Z1 bin/nodejs/deploy.zip | grep -v '/$' | sort) || true
mkdir -p "$PREV/zp" "$PREV/zn" && unzip -q "$PREV/prev.zip" -d "$PREV/zp" && unzip -q bin/nodejs/deploy.zip -d "$PREV/zn"
echo "inhaltlich geändert:"; (cd "$PREV" && for f in $(diff -rq zp zn | grep differ | awk '{print $2}' | sed 's#^zp/##'); do cmp -s <(tr -d '\r' < "zp/$f") <(tr -d '\r' < "zn/$f") || echo "  $f"; done)
rm -rf "$PREV" "$LOG"

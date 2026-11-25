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
# (once more in a theme of the children - the boxes use km themes: einhorn, light, with the cover stage - but only when
# the display changed since the last deploy.zip: its code, the themes or the check itself. Both at the same time, the
# second on ports moved by 10 (check.mjs --port-offset). A run that fails is run once more on its own - the two at once
# load the computer, and a click may come too late: a rule broken twice stops the build.)
LAST_ZIP="$(git log -1 --format=%H -- bin/nodejs/deploy.zip)"
THEMES=(default)
if [ -z "$LAST_ZIP" ] || ! git diff --quiet "$LAST_ZIP" HEAD -- src/frontend-box themes tools/display-check; then
  THEMES+=(einhorn)
else
  echo "Display seit der letzten deploy.zip unverändert - Prüfung nur im Standard-Theme"
fi
CHECK_DIR="$(mktemp -d)"
check_args() { [ "$1" = default ] && echo "" || echo "--theme $1"; }
declare -A PIDS
i=0
for t in "${THEMES[@]}"; do
  node tools/display-check/check.mjs src/deploy/www $(check_args "$t") --port-offset $((i * 10)) > "$CHECK_DIR/$t.log" 2>&1 &
  PIDS[$t]=$!
  i=$((i + 1))
done
FAILED=()
for t in "${THEMES[@]}"; do
  if wait "${PIDS[$t]}"; then
    echo "== Display-Prüfung ($t)"; tail -n 1 "$CHECK_DIR/$t.log"
  else
    echo "== Display-Prüfung ($t) beim gleichzeitigen Lauf nicht bestanden:"; grep -E "^FAIL|could not run" "$CHECK_DIR/$t.log"
    FAILED+=("$t")
  fi
done
for t in "${FAILED[@]}"; do
  echo "== Display-Prüfung ($t) noch einmal, allein"
  if ! node tools/display-check/check.mjs src/deploy/www $(check_args "$t"); then
    echo "Display-Prüfung ($t) nicht bestanden - deploy.zip NICHT gebaut"
    rm -rf "$CHECK_DIR"
    exit 1
  fi
done
rm -rf "$CHECK_DIR"
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

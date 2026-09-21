#!/usr/bin/env bash
# Runs the Foraxx test suite in a headless PixInsight 1.9.4 instance.
#
# Usage: test/run-headless.sh [output-dir]
# Env:   PIXINSIGHT_DIR  PixInsight install directory (default: ~/PixInsight)
#
# Exits 0 when the suite reports PASS. The report is printed and kept in
# <output-dir>/result.txt.
set -euo pipefail

PI="${PIXINSIGHT_DIR:-$HOME/PixInsight}"
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-${TMPDIR:-/tmp}/foraxx-test}"
mkdir -p "$out"

lib="$(cd "$here/../src/scripts/ForaxxPalette/lib" && pwd)"
engine="$lib/ForaxxEngine.js"
dialog="$lib/ForaxxDialog.js"
result="$out/result.txt"
rm -f "$result"

sed -e "s|@ENGINE_PATH@|$engine|" -e "s|@DIALOG_PATH@|$dialog|" -e "s|@RESULT_PATH@|$result|" \
    "$here/ForaxxTest.js" > "$out/ForaxxTest.js"

(
   cd "$PI/bin"
   export LD_LIBRARY_PATH="$PI/bin/lib:$PI/bin"
   export QT_PLUGIN_PATH="$PI/bin/lib/qt-plugins"
   export QT_QPA_PLATFORM_PLUGIN_PATH="$PI/bin/lib/qt-plugins/platforms"
   export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
   export QT_LOGGING_RULES='*=false'
   export LC_ALL=en_US.utf8
   export MKL_ENABLE_INSTRUCTIONS=AVX2
   timeout "${PIXINSIGHT_TIMEOUT:-600}" ./PixInsight -n --automation-mode \
      --no-startup-check-updates -r="$out/ForaxxTest.js" --force-exit \
      >"$out/pixinsight.log" 2>&1 || true
)

if [ ! -f "$result" ]; then
   echo "No result file was written. PixInsight output:" >&2
   cat "$out/pixinsight.log" >&2
   exit 2
fi

cat "$result"
grep -q '^RESULT: PASS' "$result"

# Load check: run the real entry point, with main() swapped for a marker
# write, through the same preprocessor PixInsight uses when featuring it.
# This catches directive mistakes (a "//" inside #feature-info, for instance)
# that the suite above never sees because it includes the libraries directly.
load="$out/load"
rm -rf "$load"
mkdir -p "$load"
cp -r "$here/../src/scripts/ForaxxPalette" "$load/"
sed -i "s|^main();\$|File.writeTextFile( \"$load/loaded.txt\", \"LOADED\" );|" "$load/ForaxxPalette/ForaxxPalette.js"
grep -q 'LOADED' "$load/ForaxxPalette/ForaxxPalette.js"
(
   cd "$PI/bin"
   export LD_LIBRARY_PATH="$PI/bin/lib:$PI/bin"
   export QT_PLUGIN_PATH="$PI/bin/lib/qt-plugins"
   export QT_QPA_PLATFORM_PLUGIN_PATH="$PI/bin/lib/qt-plugins/platforms"
   export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
   export QT_LOGGING_RULES='*=false'
   export LC_ALL=en_US.utf8
   timeout "${PIXINSIGHT_TIMEOUT:-600}" ./PixInsight -n --automation-mode \
      --no-startup-check-updates -r="$load/ForaxxPalette/ForaxxPalette.js" --force-exit \
      >"$out/pixinsight-load.log" 2>&1 || true
)
if [ ! -f "$load/loaded.txt" ]; then
   echo "LOAD CHECK FAILED: ForaxxPalette.js did not run in PixInsight (directive or syntax error)." >&2
   exit 3
fi
echo "LOAD CHECK: ForaxxPalette.js loads in PixInsight"

#!/usr/bin/env bash
# Builds the PixInsight update package and the repository index.
#
# Usage: ./build.sh [dist-dir]
#
# Produces in <dist-dir> (default: dist/):
#   FPU_<timestamp>.zip      the V8 package for PixInsight 1.9.4 and later 1.9.x
#   FPU_202412230653.zip     the legacy package for PixInsight 1.8.9-3 to 1.9.3
#   updates.xri              the repository index listing both
#
# Upload the contents of <dist-dir> to https://foraxxpaletteutility.com/FPU/
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
dist="${1:-$here/dist}"
version="$(sed -n 's/^const VERSION = "\(.*\)";/\1/p' "$here/src/scripts/ForaxxPalette/ForaxxPalette.js")"
stamp="$(date -u +%Y%m%d%H%M)"
release="$(date -u +%Y%m%d)"
zipname="FPU_${stamp}.zip"
legacy="FPU_202412230653.zip"

rm -rf "$dist"
mkdir -p "$dist"

# Package: the script and icon trees plus LICENSE and NOTICE beside the
# script, staged so the source tree stays clean. No OS metadata files.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/src/scripts" "$stage/rsc/icons/script"
cp -r "$here/src/scripts/ForaxxPalette" "$stage/src/scripts/"
cp -r "$here/rsc/icons/script/ForaxxPalette" "$stage/rsc/icons/script/"
cp "$here/LICENSE" "$here/NOTICE" "$stage/src/scripts/ForaxxPalette/"

# Code signing: with PIXINSIGHT_SIGN=1 and a secure keys file, sign the entry
# script with a headless PixInsight and ship the .xsgn file. The key comes
# from $PIXINSIGHT_XSSK (+ $PIXINSIGHT_XSSK_PASSWORD_FILE), defaulting to
# ~/.pixinsight-signing/theatrus.xssk.
#
# OFF BY DEFAULT. Tested 2026-09-21: PixInsight 1.9.4 refuses to run a script
# whose signature comes from a developer id that is not certified, while an
# unsigned script runs with a warning. Turn this on only once the theatrus id
# is a Certified PixInsight Developer identity.
xssk="${PIXINSIGHT_XSSK:-$HOME/.pixinsight-signing/theatrus.xssk}"
xssk_pw="${PIXINSIGHT_XSSK_PASSWORD_FILE:-${xssk}.password}"
pi="${PIXINSIGHT_DIR:-$HOME/PixInsight}"
if [ "${PIXINSIGHT_SIGN:-0}" = "1" ] && [ -f "$xssk" ] && [ -f "$xssk_pw" ] && [ -x "$pi/bin/PixInsight" ]; then
   # Only the entry point carries a signature, as PixInsight's own packages
   # do: a script signature needs the script id from #feature-id, and the
   # signed source is the preprocessed script, includes and all.
   files="$stage/src/scripts/ForaxxPalette/ForaxxPalette.js"
   signer="$stage/sign-scripts.js"
   python3 - "$here/scripts/sign-scripts.js" "$signer" "$xssk" "$xssk_pw" "$stage/sign-result.txt" "$files" <<'PY'
import sys, json
src, dst, xssk, pw, result, files = sys.argv[1:7]
s = open(src).read()
for a, b in [("@XSSK_PATH@", xssk), ("@XSSK_PASSWORD_FILE@", pw), ("@RESULT_PATH@", result),
             ("@FILES_JSON@", json.dumps([f for f in files.split("\n") if f.strip()]))]:
    s = s.replace(a, b)
open(dst, "w").write(s)
PY
   (
      cd "$pi/bin"
      export LD_LIBRARY_PATH="$pi/bin/lib:$pi/bin"
      export QT_PLUGIN_PATH="$pi/bin/lib/qt-plugins"
      export QT_QPA_PLATFORM_PLUGIN_PATH="$pi/bin/lib/qt-plugins/platforms"
      export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"
      export QT_LOGGING_RULES='*=false'
      export LC_ALL=en_US.utf8
      timeout "${PIXINSIGHT_TIMEOUT:-300}" ./PixInsight -n --automation-mode --no-startup-check-updates \
         -r="$signer" --force-exit >"$stage/sign-pi.log" 2>&1 || true
   )
   rm -f "$signer"
   if ! grep -q '^RESULT: OK' "$stage/sign-result.txt" 2>/dev/null; then
      echo "code signing failed:" >&2
      cat "$stage/sign-result.txt" >&2 2>/dev/null || echo "(no result file; see $stage/sign-pi.log)" >&2
      trap - EXIT
      exit 1
   fi
   grep '^signed' "$stage/sign-result.txt"
   rm -f "$stage/sign-result.txt" "$stage/sign-pi.log"
else
   echo "code signing skipped (set PIXINSIGHT_SIGN=1 once the developer id is certified)"
fi

(
   cd "$stage"
   zip -q -X -r "$dist/$zipname" src rsc -x '*.DS_Store' -x '__MACOSX/*' -x '*~'
)
cp "$here/legacy/$legacy" "$dist/$legacy"

sha1_new="$(sha1sum "$dist/$zipname" | cut -d' ' -f1)"
sha1_legacy="$(sha1sum "$dist/$legacy" | cut -d' ' -f1)"

cat > "$dist/updates.xri" <<XRI
<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <p>
         Foraxx Palette Utility - For the creation of Foraxx Palette Narrowband Images.
      </p>
      <p>
         Original script by Paul Hancock, Paulyman Astro.
         Copyright (c) 2023-2024 Paul Hancock. All Rights Reserved.
      </p>
   </description>
   <platform os="all" arch="noarch" version="1.9.4:1.9.99">
      <package fileName="$zipname"
               sha1="$sha1_new"
               type="script"
               releaseDate="$release">
         <title>
            Foraxx Palette Utility - Version $version
         </title>
         <description>
            <p>
               Rewritten for the V8 JavaScript runtime in PixInsight 1.9.4.
               Same Foraxx expressions and curves as before.
            </p>
            <p>
               Original script by Paul Hancock, Paulyman Astro.
               Copyright (c) 2023-2024 Paul Hancock. Copyright (c) 2026 Yann Ramin.
               All Rights Reserved.
            </p>
         </description>
      </package>
   </platform>
   <platform os="all" arch="noarch" version="1.8.9-3:1.9.3">
      <package fileName="$legacy"
               sha1="$sha1_legacy"
               type="script"
               releaseDate="20241223">
         <title>
            Foraxx Palette Utility - Version 1.16
         </title>
         <description>
            <p>
               1.9 ready. Legacy SpiderMonkey version for PixInsight 1.8.9-3 to 1.9.3.
            </p>
            <p>
               Copyright (c) 2024 Paul Hancock. All Rights Reserved.
            </p>
         </description>
      </package>
   </platform>
</xri>
XRI

echo "Built $dist:"
ls -l "$dist"
echo
echo "sha1 $zipname: $sha1_new"
xmllint --noout "$dist/updates.xri" 2>/dev/null && echo "updates.xri is well-formed XML" || true

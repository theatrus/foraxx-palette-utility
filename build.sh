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

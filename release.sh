#!/usr/bin/env bash
# Builds, signs and publishes a release to the theatr.us PixInsight update
# repository (https://pixinsight.theatr.us/).
#
# Usage: ./release.sh [--dry-run] [summary]
#
# Before running: set VERSION in src/scripts/ForaxxPalette/ForaxxPalette.js,
# add a line to its version history, and commit. Then this script:
#   1. checks that both repositories are clean and up to date with origin,
#   2. runs the headless test suite and the signing tests,
#   3. builds the signed package with build.sh and verifies its signature
#      with scripts/pisign.py,
#   4. replaces the V8 package in the repository checkout and updates its
#      packages.json entry (file, release date, title), then runs
#      build-index.py --check,
#   5. commits there as "Foraxx Palette Utility <version>[: summary]", tags
#      this repository v<version>, and pushes both.
# --dry-run stops after step 4 and leaves the repository checkout modified
# for inspection (git -C <repo> checkout . && git -C <repo> clean -f to undo).
#
# Env:   PIXINSIGHT_REPO  repository checkout (default: ~/repos/pixinsight-repository)
#        plus everything build.sh and test/run-headless.sh read.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="${PIXINSIGHT_REPO:-$HOME/repos/pixinsight-repository}"
dry=0
if [ "${1:-}" = "--dry-run" ]; then
   dry=1
   shift
fi
summary="${1:-}"

die() { echo "release: $*" >&2; exit 1; }

version="$(sed -n 's/^const VERSION = "\(.*\)";/\1/p' "$here/src/scripts/ForaxxPalette/ForaxxPalette.js")"
[ -n "$version" ] || die "no VERSION in ForaxxPalette.js"
title="Foraxx Palette Utility $version"
tag="v$version"

# 1. Both trees clean, on main, and level with origin.
for dir in "$here" "$repo"; do
   [ -d "$dir/.git" ] || die "$dir is not a git checkout"
   [ -z "$(git -C "$dir" status --porcelain)" ] || die "$dir has uncommitted changes"
   [ "$(git -C "$dir" branch --show-current)" = "main" ] || die "$dir is not on main"
   git -C "$dir" fetch -q origin
   git -C "$dir" merge -q --ff-only origin/main || die "$dir has diverged from origin/main"
done
git -C "$here" rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "tag $tag already exists"
grep -q "\"$title\"" "$repo/packages.json" && die "$title is already in packages.json"
grep -q "^ \* $version " "$here/src/scripts/ForaxxPalette/ForaxxPalette.js" ||
   die "no version history line for $version in ForaxxPalette.js"

# 2. Tests.
"$here/test/run-headless.sh" >/tmp/foraxx-release-test.$$ 2>&1 || {
   cat /tmp/foraxx-release-test.$$ >&2
   rm -f /tmp/foraxx-release-test.$$
   die "tests failed"
}
grep -E '^(RESULT|LOAD CHECK)' /tmp/foraxx-release-test.$$
rm -f /tmp/foraxx-release-test.$$
python3 "$here/test/pisign-test.py" | grep '^RESULT' || die "signing tests failed"

# 3. Signed build. build.sh stops if it cannot sign; check the package anyway.
dist="$(mktemp -d)"
trap 'rm -rf "$dist"' EXIT
PIXINSIGHT_SIGN=1 "$here/build.sh" "$dist" >/dev/null
zip="$(cd "$dist" && ls FPU_*.zip | grep -v '^FPU_202412230653\.zip$')"
[ "$(echo "$zip" | wc -l)" = "1" ] || die "expected one new package in $dist, found: $zip"
unzip -l "$dist/$zip" | grep -q 'src/scripts/ForaxxPalette/ForaxxPalette.xsgn' || die "$zip carries no signature"
# Check the signature independently of PixInsight.
mkdir "$dist/check"
unzip -q "$dist/$zip" -d "$dist/check"
python3 "$here/scripts/pisign.py" verify "$dist/check/src/scripts/ForaxxPalette/ForaxxPalette.js" >/dev/null ||
   die "$zip: signature does not verify against the theatrus public key"
echo "built $zip (signed, signature verified)"

# 4. Swap the package into the repository checkout.
old="$(python3 - "$repo/packages.json" "$zip" "$title" <<'PY'
import json, sys, datetime
path, zip_name, title = sys.argv[1:4]
with open(path, encoding="utf-8") as fh:
    data = json.load(fh)
# The V8 package is the Foraxx entry for 1.9.4 and later; the legacy one stays.
hits = [p for p in data["packages"]
        if p["title"].startswith("Foraxx Palette Utility ")
        and any(pl["version"].startswith("1.9.4:") for pl in p["platforms"])]
if len(hits) != 1:
    sys.exit(f"expected one Foraxx 1.9.4+ entry in packages.json, found {len(hits)}")
entry = hits[0]
print(entry["file"])
entry["file"] = "packages/" + zip_name
entry["releaseDate"] = zip_name[len("FPU_"):-len(".zip")][:8]
entry["title"] = title
with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, ensure_ascii=False)
    fh.write("\n")
PY
)"
git -C "$repo" rm -q "$old"
cp "$dist/$zip" "$repo/packages/$zip"
git -C "$repo" add "packages/$zip" packages.json
(cd "$repo" && ./build-index.py --check)
echo "replaced $old with packages/$zip in $repo"

if [ "$dry" = "1" ]; then
   echo "dry run: nothing committed or pushed; review with git -C $repo diff --cached --stat"
   exit 0
fi

# 5. Commit, tag, push.
msg="$title"
[ -n "$summary" ] && msg="$title: $summary"
git -C "$repo" commit -q -m "$msg"
git -C "$here" tag -a "$tag" -m "$title"
git -C "$here" push -q origin main "$tag"
git -C "$repo" push -q origin main
echo "published $title: $repo pushed, $tag pushed"

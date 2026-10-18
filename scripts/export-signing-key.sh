#!/usr/bin/env bash
# Exports the raw Ed25519 private key from a PixInsight .xssk file, for
# scripts/pisign.py and CI. Runs a headless PixInsight to decrypt it.
#
# Usage: scripts/export-signing-key.sh [output]
#
# Writes the 64-byte key in Base64 to <output> (default:
# ~/.pixinsight-signing/theatrus.ed25519) with mode 600, checks that it
# matches the theatrus public key, and never prints it. To store it for CI:
#   gh secret set PIXINSIGHT_ED25519_KEY -R theatrus/foraxx-palette-utility < <output>
#
# Env: PIXINSIGHT_XSSK, PIXINSIGHT_XSSK_PASSWORD_FILE, PIXINSIGHT_DIR as in build.sh.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
xssk="${PIXINSIGHT_XSSK:-$HOME/.pixinsight-signing/theatrus.xssk}"
xssk_pw="${PIXINSIGHT_XSSK_PASSWORD_FILE:-${xssk}.password}"
pi="${PIXINSIGHT_DIR:-$HOME/PixInsight}"
out="${1:-$HOME/.pixinsight-signing/theatrus.ed25519}"

for f in "$xssk" "$xssk_pw" "$pi/bin/PixInsight"; do
   [ -e "$f" ] || { echo "export-signing-key: missing $f" >&2; exit 1; }
done
[ -e "$out" ] && { echo "export-signing-key: $out exists; remove it first" >&2; exit 1; }

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cat > "$work/export.js" <<EOF
#engine v8
(() => {
   let keys = Security.loadSigningKeysFile( "$xssk", File.readTextFile( "$xssk_pw" ).trim() );
   let f = new File;
   f.createForWriting( "$out" );
   f.outText( keys.privateKey.toBase64() + "\n" );
   f.close();
   keys.privateKey.secureFill();
})();
EOF
(
   cd "$pi/bin"
   export LD_LIBRARY_PATH="$pi/bin/lib:$pi/bin"
   export QT_PLUGIN_PATH="$pi/bin/lib/qt-plugins"
   export QT_QPA_PLATFORM=offscreen
   export QT_LOGGING_RULES='*=false'
   export LC_ALL=en_US.utf8
   timeout "${PIXINSIGHT_TIMEOUT:-300}" ./PixInsight -n --automation-mode --no-startup-check-updates \
      -r="$work/export.js" --force-exit >/dev/null 2>&1 || true
)
[ -s "$out" ] || { echo "export-signing-key: PixInsight wrote no key" >&2; exit 1; }
chmod 600 "$out"

python3 - "$here" "$out" <<'PY'
import base64, sys
sys.path.insert(0, sys.argv[1])
import pisign
key = base64.b64decode(open(sys.argv[2]).read().strip())
if len(key) != 64 or pisign.public_key(key) != base64.b64decode(pisign.THEATRUS_PUBLIC_KEY):
    sys.exit("export-signing-key: the exported key does not match the theatrus public key")
PY
echo "wrote $out (mode 600); it matches the theatrus public key"

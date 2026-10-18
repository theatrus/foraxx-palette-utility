#!/usr/bin/env python3
"""Checks scripts/pisign.py against signatures made by PixInsight.

test/signing/ holds small scripts, each probing one canonicalization rule,
signed by PixInsight 1.9.5 build 1706 with the theatrus key, and
test/signing-xml/ holds XML documents it signed. Every one must
verify. Signing is checked with the RFC 8032 test vector and a round trip
with a throwaway key, reusing each fixture's timestamp and entitlements.

Usage: python3 test/pisign-test.py
"""
import base64
import glob
import os
import shutil
import sys
import tempfile

here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, "..", "scripts"))
import pisign  # noqa: E402

failures = 0


def check(ok, what):
    global failures
    print(f"{'ok  ' if ok else 'not ok'} - {what}")
    failures += not ok


# RFC 8032 section 7.1, test 1.
seed = bytes.fromhex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
pub = bytes.fromhex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
sig = bytes.fromhex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
priv = pisign.expand_seed(seed)
check(pisign.public_key(priv) == pub, "RFC 8032: public key from seed")
check(pisign.ed25519_sign(priv, pub, b"") == sig, "RFC 8032: signature")
check(pisign.ed25519_verify(pub, b"", sig) and not pisign.ed25519_verify(pub, b"x", sig), "RFC 8032: verify")

fixtures = sorted(glob.glob(os.path.join(here, "signing", "*.js")) + glob.glob(os.path.join(here, "signing", "*.jsh")))
theatrus = base64.b64decode(pisign.THEATRUS_PUBLIC_KEY)
for f in fixtures:
    check(pisign.verify(f, theatrus), f"PixInsight signature verifies: {os.path.basename(f)}")

# Tampering must fail: one changed character in code that is signed.
with tempfile.TemporaryDirectory() as tmp:
    shutil.copy(os.path.join(here, "signing", "t01.js"), tmp)
    shutil.copy(os.path.join(here, "signing", "t01.xsgn"), tmp)
    path = os.path.join(tmp, "t01.js")
    with open(path) as fh:
        src = fh.read()
    with open(path, "w") as fh:
        fh.write(src.replace("var a = 1;", "var a = 2;"))
    check(not pisign.verify(path, theatrus), "a changed script fails")

# Round trip with a throwaway key: sign every fixture as PixInsight did.
key = pisign.expand_seed(os.urandom(32))
key_pub = pisign.public_key(key)
with tempfile.TemporaryDirectory() as tmp:
    shutil.copytree(os.path.join(here, "signing"), tmp, dirs_exist_ok=True)
    for f in sorted(glob.glob(os.path.join(tmp, "*.js")) + glob.glob(os.path.join(tmp, "*.jsh"))):
        orig = pisign.read_signature(pisign.signature_path(f))
        pisign.sign(f, key, "theatrus", orig["entitlements"], orig["timestamp"])
        mine = pisign.read_signature(pisign.signature_path(f))
        same = all(mine[k] == orig[k] for k in ("scriptId", "developerId", "timestamp", "entitlements"))
        check(same and pisign.verify(f, key_pub), f"sign and verify round trip: {os.path.basename(f)}")

# XML: test/signing-xml/ holds documents signed by PixInsight (.xml, .xri)
# beside the originals it was given (.unsigned).
xml_dir = os.path.join(here, "signing-xml")
signed_docs = sorted(glob.glob(os.path.join(xml_dir, "*.xml")) + glob.glob(os.path.join(xml_dir, "*.xri")))
for f in signed_docs:
    check(pisign.verify_xml(f, theatrus), f"PixInsight XML signature verifies: {os.path.basename(f)}")

with tempfile.TemporaryDirectory() as tmp:
    for f in signed_docs:
        name = os.path.basename(f)
        with open(f, encoding="utf-8") as fh:
            theirs = fh.read()
        sig_line = theirs.rstrip("\n").split("\n")[-1]
        stamp = sig_line.split('timestamp="')[1].split('"')[0]
        mine = os.path.join(tmp, name)
        shutil.copy(os.path.splitext(f)[0] + ".unsigned", mine)
        pisign.sign_xml(mine, key, "theatrus", stamp)
        with open(mine, encoding="utf-8") as fh:
            ours = fh.read()
        body = lambda s: s.rstrip("\n").rsplit("\n", 1)[0]
        check(body(ours) == body(theirs) and pisign.verify_xml(mine, key_pub),
              f"XML rewrite matches PixInsight's and round trips: {name}")
    tampered = os.path.join(tmp, "tampered.xri")
    with open(os.path.join(xml_dir, "updates.xri"), encoding="utf-8") as fh:
        doc = fh.read()
    with open(tampered, "w", encoding="utf-8") as fh:
        fh.write(doc.replace('version="1.9.4:1.9.99"', 'version="1.9.4:1.9.98"'))
    check(not pisign.verify_xml(tampered, theatrus), "a changed XML document fails")

print("RESULT:", "PASS" if failures == 0 else f"FAIL ({failures})")
sys.exit(1 if failures else 0)

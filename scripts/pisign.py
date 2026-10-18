#!/usr/bin/env python3
"""PixInsight script signatures (.xsgn) without PixInsight.

Reproduces the way PixInsight 1.9.5 (build 1706) canonicalizes and signs
JavaScript sources, as worked out in docs/script-signing.md, and checks it
against signatures PixInsight made. Standard library only.

  pisign.py canonical FILE              print the canonical text that is hashed
  pisign.py verify FILE [FILE...]       check FILE's .xsgn against --public-key
  pisign.py sign FILE --key-file KEY    write FILE's .xsgn

Options:
  --include-dir DIR      also look here for "quoted" includes (repeatable)
  --public-key B64       Ed25519 public key (default: the theatrus key)
  --key-file KEY         file holding the 64-byte private key in Base64, in
                         the layout PixInsight uses (clamped scalar || prefix)
  --developer-id ID      developer id to sign as (default: theatrus)
  --entitlement E        entitlement to grant (repeatable)
  --timestamp TS         ISO 8601 UTC timestamp, for reproducing a signature

Copyright 2026 Yann Ramin. Apache License 2.0.
"""
import argparse
import base64
import datetime
import hashlib
import os
import re
import sys

THEATRUS_PUBLIC_KEY = "ZywW3LxwYgSAblgrEEopPlYCaht19NqhWs0PqtdrDV0="


# Ed25519 after RFC 8032 section 6. Slow but small; a signature takes well
# under a second.

_P = 2**255 - 19
_L = 2**252 + 27742317777372353535851937790883648493
_D = -121665 * pow(121666, _P - 2, _P) % _P
_I = pow(2, (_P - 1) // 4, _P)


def _sha512(b):
    return hashlib.sha512(b).digest()


def _inv(x):
    return pow(x, _P - 2, _P)


def _add(a, b):
    x1, y1, z1, t1 = a
    x2, y2, z2, t2 = b
    p = (y1 - x1) * (y2 - x2) % _P
    q = (y1 + x1) * (y2 + x2) % _P
    r = 2 * t1 * t2 * _D % _P
    s = 2 * z1 * z2 % _P
    e, f, g, h = q - p, s - r, s + r, q + p
    return (e * f % _P, g * h % _P, f * g % _P, e * h % _P)


def _mul(n, pt):
    acc = (0, 1, 1, 0)
    while n > 0:
        if n & 1:
            acc = _add(acc, pt)
        pt = _add(pt, pt)
        n >>= 1
    return acc


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1)
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _I % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


_GY = 4 * _inv(5) % _P
_GX = _recover_x(_GY, 0)
_G = (_GX, _GY, 1, _GX * _GY % _P)


def _compress(pt):
    zi = _inv(pt[2])
    x, y = pt[0] * zi % _P, pt[1] * zi % _P
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _decompress(b):
    y = int.from_bytes(b, "little")
    sign = y >> 255
    y &= (1 << 255) - 1
    x = _recover_x(y, sign)
    return None if x is None else (x, y, 1, x * y % _P)


def _equal(a, b):
    return ((a[0] * b[2] - b[0] * a[2]) % _P == 0
            and (a[1] * b[2] - b[1] * a[2]) % _P == 0)


def expand_seed(seed):
    """32-byte seed -> 64-byte private key in PixInsight's layout."""
    h = bytearray(_sha512(seed))
    h[0] &= 248
    h[31] &= 63
    h[31] |= 64
    return bytes(h)


def public_key(private):
    return _compress(_mul(int.from_bytes(private[:32], "little"), _G))


def ed25519_sign(private, public, msg):
    a = int.from_bytes(private[:32], "little")
    r = int.from_bytes(_sha512(private[32:] + msg), "little") % _L
    big_r = _compress(_mul(r, _G))
    h = int.from_bytes(_sha512(big_r + public + msg), "little") % _L
    return big_r + int.to_bytes((r + h * a) % _L, 32, "little")


def ed25519_verify(public, msg, sig):
    if len(public) != 32 or len(sig) != 64:
        return False
    a = _decompress(public)
    r = _decompress(sig[:32])
    s = int.from_bytes(sig[32:], "little")
    if a is None or r is None or s >= _L:
        return False
    h = int.from_bytes(_sha512(sig[:32] + public + msg), "little") % _L
    return _equal(_mul(s, _G), _add(r, _mul(h, a)))


# Canonical source text.

def _find_outside_strings(line, token, start=0):
    # "..." and '...' are strings, with backslash escapes; `...` is not.
    i, quote = 0, None
    while i < len(line):
        c = line[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                quote = None
        else:
            if i >= start and line.startswith(token, i):
                return i
            if c in "\"'":
                quote = c
        i += 1
    return -1


def strip_comments(lines):
    """PixInsight's per-line comment removal, quirks included.

    Each line is searched for "/*" before "//". After a block comment is cut
    out of a line, the search for the next "/*" resumes at the old end index
    in the shortened line, so some later comments on the same line survive.
    """
    out, in_block = [], False
    for line in lines:
        if in_block:
            j = line.find("*/")
            if j < 0:
                continue
            in_block = False
            line = line[j + 2:]
        pos = 0
        while True:
            b = _find_outside_strings(line, "/*", pos)
            if b < 0:
                break
            e = line.find("*/", b + 2)
            if e < 0:
                line = line[:b]
                in_block = True
                break
            line = line[:b] + line[e + 2:]
            pos = e + 2
        c = _find_outside_strings(line, "//")
        if c >= 0:
            line = line[:c]
        out.append(line)
    if in_block:
        raise ValueError("unterminated block comment")
    return out


_INCLUDE = re.compile(r'\s*#include\s+([<"])([^>"]+)[>"]')


def load_lines(path, include_dirs=()):
    """Source lines with continuations joined and #include expanded.

    <...> includes are PixInsight's standard resources ("secure code"): they
    are left out of the signed text altogether.
    """
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"{path}: PixInsight cannot sign a file with a UTF-8 BOM")
    src = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    src = re.sub(r"\\\n[ \t]*", "", src)
    out = []
    for line in src.split("\n"):
        m = _INCLUDE.match(line)
        if m:
            if m.group(1) == '"':
                name = m.group(2)
                candidates = [os.path.join(os.path.dirname(path), name)]
                candidates += [os.path.join(d, name) for d in include_dirs]
                hit = next((c for c in candidates if os.path.isfile(c)), None)
                if hit is None:
                    raise FileNotFoundError(f"{name}, included from {path}")
                out.extend(load_lines(hit, include_dirs))
            continue
        out.append(line)
    return out


def canonical_text(path, include_dirs=()):
    lines = strip_comments(load_lines(path, include_dirs))
    return "".join(s + "\n" for s in (l.strip(" \t\r\n") for l in lines) if s)


def script_id(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"\s*#(feature-id|script-id)\s+(\S+)(\s*:|\s*$)", line)
            if m:
                return m.group(2)
    return None


def digest(code, developer_id, timestamp, entitlements):
    msg = code + "\n" + developer_id + "\n" + timestamp
    msg += "".join("\n" + e for e in entitlements)
    return hashlib.sha512(msg.encode("utf-8")).digest()


# Signature files.

def read_signature(path):
    with open(path, encoding="utf-8") as fh:
        x = fh.read()

    def get(pattern):
        m = re.search(pattern, x)
        return m.group(1) if m else None

    ents = get(r"<Entitlements>([^<]*)</Entitlements>")
    return {
        "scriptId": get(r'<Signature [^>]*scriptId="([^"]*)"'),
        "developerId": get(r'<Signature [^>]*developerId="([^"]*)"'),
        "timestamp": get(r"<Timestamp>([^<]*)</Timestamp>"),
        "entitlements": ents.split(",") if ents else [],
        "signature": base64.b64decode(re.sub(r"\s", "", get(r'<CodeSignature encoding="Base64">([^<]*)<'))),
    }


def write_signature(path, sid, developer_id, timestamp, entitlements, sig):
    sid_attr = f' scriptId="{sid}"' if sid else ""
    ents = f"      <Entitlements>{','.join(entitlements)}</Entitlements>\n" if entitlements else ""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            "<!--\n"
            "PixInsight XML Code Signature Format - XSGN version 1.0\n"
            "Created with PixInsight software - https://pixinsight.com/\n"
            "-->\n"
            '<xsgn version="1.0" xmlns="http://www.pixinsight.com/xsgn" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            'xsi:schemaLocation="http://www.pixinsight.com/xsgn http://pixinsight.com/xsgn/xsgn-1.0.xsd">\n'
            f"   <CreationTime>{timestamp}</CreationTime>\n"
            f'   <Signature version="1.0"{sid_attr} developerId="{developer_id}">\n'
            f"      <Timestamp>{timestamp}</Timestamp>\n"
            f"{ents}"
            f'      <CodeSignature encoding="Base64">{base64.b64encode(sig).decode()}</CodeSignature>\n'
            "   </Signature>\n"
            "</xsgn>\n")


def signature_path(path):
    return os.path.splitext(path)[0] + ".xsgn"


def verify(path, public, include_dirs=()):
    s = read_signature(signature_path(path))
    if path.endswith(".js") and s["scriptId"] != script_id(path):
        return False
    code = canonical_text(path, include_dirs)
    return ed25519_verify(public, digest(code, s["developerId"], s["timestamp"], s["entitlements"]), s["signature"])


def sign(path, private, developer_id, entitlements=(), timestamp=None, include_dirs=()):
    sid = None
    if path.endswith(".js"):
        sid = script_id(path)
        if not sid:
            raise ValueError(f"{path}: needs '#feature-id <id> : <menu>' or '#script-id <id>' to be signed")
    if timestamp is None:
        now = datetime.datetime.now(datetime.timezone.utc)
        timestamp = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    code = canonical_text(path, include_dirs)
    sig = ed25519_sign(private, public_key(private), digest(code, developer_id, timestamp, list(entitlements)))
    write_signature(signature_path(path), sid, developer_id, timestamp, list(entitlements), sig)
    return signature_path(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("command", choices=["canonical", "verify", "sign"])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--include-dir", action="append", default=[])
    ap.add_argument("--public-key", default=THEATRUS_PUBLIC_KEY)
    ap.add_argument("--key-file")
    ap.add_argument("--developer-id", default="theatrus")
    ap.add_argument("--entitlement", action="append", default=[])
    ap.add_argument("--timestamp")
    a = ap.parse_args()

    if a.command == "canonical":
        for f in a.files:
            sys.stdout.write(canonical_text(f, a.include_dir))
        return 0
    if a.command == "verify":
        public = base64.b64decode(a.public_key)
        bad = 0
        for f in a.files:
            ok = verify(f, public, a.include_dir)
            print(f"{'ok  ' if ok else 'BAD '} {f}")
            bad += not ok
        return 1 if bad else 0
    if not a.key_file:
        ap.error("sign needs --key-file")
    with open(a.key_file) as fh:
        private = base64.b64decode(fh.read().strip())
    if len(private) != 64:
        ap.error("--key-file must hold a 64-byte private key in Base64")
    for f in a.files:
        print("signed", sign(f, private, a.developer_id, a.entitlement, a.timestamp, a.include_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())

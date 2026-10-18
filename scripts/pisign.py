#!/usr/bin/env python3
"""PixInsight script (.xsgn) and XML (.xri) signatures without PixInsight.

Reproduces the way PixInsight 1.9.5 (build 1706) canonicalizes and signs
JavaScript sources and XML documents, as worked out in
docs/script-signing.md, and checks it against signatures PixInsight made.
Standard library only. Files ending in .xml or .xri are XML documents, whose
signature is embedded; anything else is a script with a .xsgn beside it.

  pisign.py canonical FILE              print the canonical text that is hashed
  pisign.py verify FILE [FILE...]       check FILE's signature against --public-key
  pisign.py sign FILE --key-file KEY    write FILE's .xsgn, or rewrite an XML
                                        document with its signature

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


# XML documents (update repository .xri files). The signature covers the root
# element as PCL's XML classes write it without formatting; signing rewrites
# the whole document with three-space indentation and appends a Signature
# element after the root.

_XML_SPACE = " \t\r\n"


def _xml_decode(s):
    import html.entities
    out, i = [], 0
    while True:
        a = s.find("&", i)
        if a < 0:
            out.append(s[i:])
            return "".join(out)
        b = s.find(";", a + 1)
        if b < 0:
            out.append(s[i:])
            return "".join(out)
        out.append(s[i:a])
        ref = s[a + 1:b]
        if ref.startswith(("#x", "#X")):
            out.append(chr(int(ref[2:], 16)))
        elif ref.startswith("#"):
            out.append(chr(int(ref[1:], 10)))
        elif ref in ("amp", "lt", "gt", "quot", "apos"):
            out.append({"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}[ref])
        elif ref + ";" in html.entities.html5:
            out.append(html.entities.html5[ref + ";"])
        else:
            raise ValueError(f"unknown XML entity &{ref};")
        i = b + 1


def _xml_encode(s, apos=True):
    s = s.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;").replace(">", "&gt;")
    return s.replace("'", "&apos;") if apos else s


def _xml_collapse(s):
    return re.sub(r"[ \t\r\n]+", " ", s)


def _xml_attributes(params):
    attrs, i = [], 0
    while True:
        while i < len(params) and params[i] in _XML_SPACE:
            i += 1
        if i == len(params):
            return attrs
        j = i
        while j < len(params) and params[j] != "=" and params[j] not in _XML_SPACE:
            j += 1
        name = params[i:j]
        k = j
        while k < len(params) and params[k] in _XML_SPACE:
            k += 1
        if k == len(params) or params[k] != "=":
            raise ValueError("XML attribute: expected '='")
        k += 1
        while k < len(params) and params[k] in _XML_SPACE:
            k += 1
        if k == len(params) or params[k] not in "\"'":
            raise ValueError("XML attribute: expected a quote")
        q = params[k]
        k += 1
        while k < len(params) and params[k] in _XML_SPACE:
            k += 1
        e = params.find(q, k)
        if e < 0:
            raise ValueError("XML attribute: unmatched quote")
        value = _xml_collapse(_xml_decode(params[k:e].rstrip(_XML_SPACE)))
        for n, (an, _) in enumerate(attrs):
            if an == name:
                attrs[n] = (name, value)
                break
        else:
            attrs.append((name, value))
        i = e + 1


def _xml_tag(text, j):
    """PCL's XMLTag: returns (name, params, next, start, end, pi)."""
    while text[j] in _XML_SPACE:
        j += 1
    start = end = pi = False
    if text[j] == "/":
        end = True
        j += 1
    else:
        start = True
        if text[j] == "?":
            pi = end = True
            j += 1
    k, depth = j, 1
    while k < len(text):
        if text[k] == ">":
            depth -= 1
            if depth == 0:
                break
        elif text[k] == "<":
            depth += 1
        k += 1
    if k == len(text):
        raise ValueError("XML: unmatched '<'")
    nxt = k + 1
    if pi:
        k -= 1
    elif text[k - 1] == "/":
        end = True
        k -= 1
    body = text[j:k]
    m = re.match(r"[^ \t\r\n]*", body)
    name = m.group(0)
    params = body[m.end():].strip(_XML_SPACE)
    return name, params, nxt, start, end, pi


def parse_xml(text):
    """Top-level nodes of a document, parsed as PCL's XMLDocument does.

    Nodes are dicts: element (name, attrs, children), text, comment, cdata,
    pi (target, data) and unknown (name, data).
    """
    nodes, stack, i = [], [], 0
    while True:
        j = text.find("<", i)
        if j < 0:
            j = len(text)
        seg = text[i:j]
        if seg:
            blank = all(c in _XML_SPACE for c in seg)
            if not stack:
                if not blank:
                    raise ValueError("XML: stray characters outside markup")
            elif not blank or any(c["type"] == "text" for c in stack[-1]["children"]):
                stack[-1]["children"].append({"type": "text", "text": _xml_decode(seg)})
        if j == len(text):
            break
        j += 1
        while j < len(text) and text[j] in _XML_SPACE:
            j += 1
        parent = stack[-1]["children"] if stack else nodes
        if text.startswith("!--", j):
            k = text.find("-->", j + 3)
            if k < 0:
                raise ValueError("XML: unmatched comment")
            parent.append({"type": "comment", "text": text[j + 3:k]})
            i = k + 3
        elif text.startswith("![CDATA[", j):
            k = text.find("]]>", j + 8)
            if k < 0 or not stack:
                raise ValueError("XML: bad CDATA section")
            parent.append({"type": "cdata", "text": text[j + 8:k]})
            i = k + 3
        elif text.startswith("!", j):
            name, params, i, *_ = _xml_tag(text, j + 1)
            if name != "DOCTYPE":
                parent.append({"type": "unknown", "name": name, "data": params})
        else:
            name, params, i, start, end, pi = _xml_tag(text, j)
            if pi:
                if name != "xml":
                    parent.append({"type": "pi", "name": name, "data": params})
            elif start:
                el = {"type": "element", "name": name, "attrs": _xml_attributes(params), "children": []}
                parent.append(el)
                if not end:
                    stack.append(el)
            else:
                if not stack or stack[-1]["name"] != name:
                    raise ValueError(f"XML: unexpected end tag </{name}>")
                stack.pop()
    if stack:
        raise ValueError(f"XML: missing </{stack[-1]['name']}>")
    return nodes


def _xml_serialize(node, out, auto, level):
    t = node["type"]
    pad = " " * (3 * level) if auto else ""
    if t == "text":
        out.append(_xml_encode(node["text"]))
    elif t == "cdata":
        out.append(pad + "<![CDATA[" + node["text"].replace("]]>", "") + "]]>")
    elif t == "pi":
        out.append(pad + "<?" + node["name"] + " " + node["data"].replace("?>", "") + "?>")
    elif t == "comment":
        c = node["text"].replace("--", "")
        out.append(pad + "<!--" + c + ("->" if c.endswith("-") else "-->"))
    elif t == "unknown":
        out.append(pad + "<!" + node["name"] + " " + node["data"] + ">")
    else:
        out.append(pad + "<" + node["name"])
        if node["attrs"]:
            out.append(" " + " ".join(f'{n}="{_xml_encode(v, False)}"' for n, v in node["attrs"]))
        kids = node["children"]
        if not kids:
            out.append("/>")
            return
        out.append(">")
        # A line break goes between two nodes unless either one is text.
        prev = None
        for kid in kids:
            br = auto and kid["type"] != "text" and (prev is None or prev["type"] != "text")
            if br:
                out.append("\n")
            _xml_serialize(kid, out, br, level + 1)
            prev = kid
        if auto and kids[-1]["type"] != "text":
            out.append("\n" + " " * (3 * level))
        out.append("</" + node["name"] + ">")


def xml_root(nodes):
    return next(n for n in nodes if n["type"] == "element")


def _xml_normalized(node):
    # The signed form is parsed as with PCL's IgnoreComments and
    # NormalizeTextSpaces: no comments, text trimmed with runs of space
    # collapsed to one.
    kids = []
    for c in node["children"]:
        if c["type"] == "comment":
            continue
        if c["type"] == "text":
            c = {"type": "text", "text": _xml_collapse(c["text"].strip(_XML_SPACE))}
        elif c["type"] == "element":
            c = _xml_normalized(c)
        kids.append(c)
    return dict(node, children=kids)


def xml_canonical(nodes):
    out = []
    _xml_serialize(_xml_normalized(xml_root(nodes)), out, False, 0)
    return "".join(out)


def xml_document(nodes):
    out = ['<?xml version="1.0" encoding="UTF-8"?>\n']
    for n in nodes:
        _xml_serialize(n, out, True, 0)
        out.append("\n")
    return "".join(out)


def _xml_load(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    return parse_xml(raw.decode("utf-8"))


def _xml_signature_node(nodes):
    root = xml_root(nodes)
    sigs = [n for n in nodes if n["type"] == "element" and n["name"] == "Signature" and n is not root]
    return sigs[-1] if sigs else None


def verify_xml(path, public):
    nodes = _xml_load(path)
    s = _xml_signature_node(nodes)
    if s is None:
        return False
    a = dict(s["attrs"])
    sig = base64.b64decode(re.sub(r"\s", "", "".join(c["text"] for c in s["children"] if c["type"] == "text")))
    return ed25519_verify(public, digest(xml_canonical(nodes), a.get("developerId", ""), a.get("timestamp", ""), []), sig)


def sign_xml(path, private, developer_id, timestamp=None):
    nodes = _xml_load(path)
    root = xml_root(nodes)
    nodes = [n for n in nodes if not (n["type"] == "element" and n["name"] == "Signature" and n is not root)]
    if timestamp is None:
        now = datetime.datetime.now(datetime.timezone.utc)
        timestamp = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    sig = ed25519_sign(private, public_key(private), digest(xml_canonical(nodes), developer_id, timestamp, []))
    nodes.append({"type": "element", "name": "Signature",
                  "attrs": [("developerId", developer_id), ("timestamp", timestamp), ("encoding", "Base64")],
                  "children": [{"type": "text", "text": base64.b64encode(sig).decode()}]})
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(xml_document(nodes))
    return path


def _is_xml(path):
    return os.path.splitext(path)[1].lower() in (".xml", ".xri")


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
            sys.stdout.write(xml_canonical(_xml_load(f)) + "\n" if _is_xml(f) else canonical_text(f, a.include_dir))
        return 0
    if a.command == "verify":
        public = base64.b64decode(a.public_key)
        bad = 0
        for f in a.files:
            ok = verify_xml(f, public) if _is_xml(f) else verify(f, public, a.include_dir)
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
        if _is_xml(f):
            print("signed", sign_xml(f, private, a.developer_id, a.timestamp))
        else:
            print("signed", sign(f, private, a.developer_id, a.entitlement, a.timestamp, a.include_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main())

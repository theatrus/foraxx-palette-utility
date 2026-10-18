# PixInsight script and XML signatures

How PixInsight 1.9.5 (build 1706, Lockhart) signs a JavaScript script and an
XML document such as an update repository's `updates.xri`, worked out so we
can sign without running PixInsight. `scripts/pisign.py` implements
it; `test/pisign-test.py` checks it against signatures PixInsight made.

PixInsight's own description is in its local docs at
`doc/docs/CodeSigning/CodeSigning.html`. It names the pieces (Ed25519, SHA-512,
comment removal) but not the details below, which come from tests.

## How we know

We had PixInsight sign test scripts with the `theatrus` key, then checked each
signature against candidate messages using only the public key. Ed25519
signatures cannot match a wrong message by chance, so a pass means the message
is exactly right.

- About 50 small scripts, each probing one rule. The ones PixInsight could sign
  are in `test/signing/`.
- 85 single-file wrappers around the source files of PixInsight's bundled
  scripts, used to find where an early model went wrong.
- 55 of the 68 scripts bundled with PixInsight, signed with our key (the other
  13 have no script id, so PixInsight refuses them).
- The real Foraxx package.

The final model matches all 186 signatures. With the real key, `pisign.py`
reproduces PixInsight's signatures byte for byte (all 46 fixtures), and
PixInsight runs a script `pisign.py` signed and refuses it once changed. The bundled scripts were copies on
the scratchpad only; nothing from them is in this repository.

## Signature file

`Name.js` is signed by `Name.xsgn` beside it:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!--
PixInsight XML Code Signature Format - XSGN version 1.0
Created with PixInsight software - https://pixinsight.com/
-->
<xsgn version="1.0" xmlns="http://www.pixinsight.com/xsgn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.pixinsight.com/xsgn http://pixinsight.com/xsgn/xsgn-1.0.xsd">
   <CreationTime>2026-10-18T21:11:27.434Z</CreationTime>
   <Signature version="1.0" scriptId="T11" developerId="theatrus">
      <Timestamp>2026-10-18T21:11:27.434Z</Timestamp>
      <Entitlements>com.pixinsight.security.pjsr.load-resource,com.pixinsight.security.pcl.experimental-features</Entitlements>
      <CodeSignature encoding="Base64">42nR5Ftd...NhnVDQ==</CodeSignature>
   </Signature>
</xsgn>
```

`scriptId` comes from `#feature-id <id> : <menu>` or `#script-id <id>`.
`.jsh` code signatures (`Security.generateCodeSignatureFile`) have no
`scriptId`. `<Entitlements>` appears only when there are some. Timestamps are
UTC with milliseconds.

## What is signed

```
message = canonical_text + "\n" + developerId + "\n" + timestamp
          + "\n" + entitlement   (once per entitlement, in order)
digest  = SHA-512(UTF-8(message))            64 raw bytes
sig     = Ed25519_sign(private, public, digest)
```

The script id is not in the message. `canonical_text` ends with a newline, so
a blank line separates it from the developer id.

## Canonical text

Applied in this order:

1. Read as UTF-8; turn CRLF and CR into LF. A file with a UTF-8 BOM cannot be
   signed.
2. Line continuations: remove a backslash at the end of a line, the newline,
   and the leading spaces and tabs of the next line. Spaces before the
   backslash stay (`First line \` + `   second.` gives `First line second.`).
3. `#include "file"`: replace the line with the file's lines, recursively,
   resolved against the including file's folder. Every include is expanded,
   even a repeat; `#ifdef` guards are not evaluated.
4. `#include <...>` (PixInsight's standard `include/pjsr` files, subfolders
   too): drop the line. Their content is not signed.
5. Remove comments line by line (details below).
6. Trim spaces and tabs (not non-breaking spaces) from each line; drop empty
   lines; end every line with LF.

All other directives (`#feature-id`, `#feature-info`, `#define`, `#ifdef`,
`#engine`...) stay as ordinary lines, without macro substitution. Space inside
a line stays as it is.

### Comment removal

For each line:

- Inside a block comment: drop the line unless it holds `*/`; if it does,
  keep what follows and treat that as a fresh line.
- Look for `/*` outside strings. If there is no `*/` after it on the line,
  cut from `/*` to the end of the line and enter a block comment. Otherwise
  cut out `/* ... */` and look for the next `/*`, **starting at the old end
  index in the now shorter line**. That slip means some later comments on the
  same line survive: `3 /* x */ + /* y */ 4` becomes `3  + /* y */ 4`, while
  `/* a */ var x = 1; /* b */` loses both.
- Then cut from the first `//` outside strings to the end of the line.

`/*` is searched before `//`, so `// see /* here` opens a block comment that
never closes, and PixInsight refuses to sign the file.

Strings are `"..."` and `'...'` with backslash escapes. Template strings are
not strings to PixInsight: `` `a // b` `` loses `// b`. Regex literals are not
recognised either.

## Inputs PixInsight refuses

All fail with the bare error `undefined`:

- no script id (the old `#feature-id Utilities > Name` form has none),
- a UTF-8 BOM,
- an unterminated block comment, including one opened inside a `//`
  comment or a regex such as `/[/*]x/`,
- a regex literal containing `//`, such as `/\/\//g` (pisign.py does not
  catch this case).

## XML documents

`Security.generateXMLSignature` (and the core's `--sign-xml-file`) signs the
whole document in place:

```
message = canonical_root + "\n" + developerId + "\n" + timestamp
digest  = SHA-512(UTF-8(message))
sig     = Ed25519_sign(private, public, digest)
```

`canonical_root` is the root element written by PCL's XML classes
(`src/pcl/XML.cpp`) with no formatting, after parsing as with the
`IgnoreComments` and `NormalizeTextSpaces` options:

- no comments;
- text trimmed, runs of spaces, tabs and line breaks collapsed to one space,
  and text that was only white space between elements dropped;
- attributes as `name="value"` separated by one space, values trimmed and
  collapsed the same way;
- `&`, `"`, `<`, `>` escaped everywhere, `'` escaped as `&apos;` in text but
  not in attribute values;
- an element with no children as `<name/>`; CDATA, processing instructions
  and other `<!...>` nodes as written.

PixInsight then rewrites the file: the XML declaration, each top-level node on
its own line (comments kept), elements indented by three spaces with a line
break between two siblings unless either is text, text as it was (escaped as
above), any earlier top-level `Signature` element removed, and a new one last:

```xml
<Signature developerId="theatrus" timestamp="2026-10-18T22:00:34.710Z" encoding="Base64">...</Signature>
```

`pisign.py` reproduces both the signature and the rewritten file byte for
byte for every document in `test/signing-xml/`, and PixInsight's
`Security.getXMLSignature` reports a document signed by `pisign.py` as
valid (and a changed copy as not valid).

## Keys

- Public key: 32 bytes. Ours is `ZywW3LxwYgSAblgrEEopPlYCaht19NqhWs0PqtdrDV0=`.
- Private key: 64 bytes in the layout of the Orson Peters Ed25519 library the
  PixInsight docs cite: the clamped secret scalar, then the 32-byte nonce
  prefix (SHA-512 of a 32-byte seed, clamped). Checked inside PixInsight
  without the key leaving it.
- The `.xssk` file holds both, encrypted with what the docs call "a custom
  algorithm based on AES-256". We have not reproduced it, so `pisign.py sign`
  takes the raw 64-byte key instead. `scripts/export-signing-key.sh` gets it
  out of the `.xssk` once, with a headless PixInsight, into
  `~/.pixinsight-signing/theatrus.ed25519` (mode 600); `build.sh` uses that
  file when it exists.
- The `.xcdev` developer list stores public keys encrypted too, so it cannot
  be used to verify other developers' signatures; search it for the id.

## Not yet tested

- `#include "..."` that is not beside the including file (pisign.py also
  tries `--include-dir`; PixInsight's search order is unknown).
- `#include <...>` pointing outside `include/pjsr`.
- `#include` inside a block comment.
- Files that are not UTF-8.
- Module signatures.
- XML named entities beyond the five basic ones and numeric references
  (`pisign.py` uses Python's HTML5 table; PCL has its own).

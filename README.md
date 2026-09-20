# Foraxx Palette Utility for PixInsight 1.9.4+

A PixInsight script that builds a Foraxx palette image (or a plain SHO, HOO,
HSO or OHS mapping) from stretched, starless narrowband images, plus an
optional colour stars image from the matching stretched star images.

This is a port of Paul Hancock's (Paulyman Astro) Foraxx Palette Utility to the V8 JavaScript
runtime that PixInsight 1.9.4 Lockhart introduced. The original script ran on
the old SpiderMonkey engine and its update package was limited to PixInsight
1.8.9-3 through 1.9.2. See [Credits](#credits).

## What it does

For SII, Ha and OIII starless images the Foraxx palette is

```
o  = OIII^~OIII
ho = (Ha*OIII)^~(Ha*OIII)
R  = o*SII + ~o*Ha
G  = ho*Ha + ~ho*OIII
B  = OIII
```

where `~x` is PixelMath's `1 - x`. With only Ha and OIII, `R = Ha`. The stars
image uses the same mapping with the star images in the colour terms, while
the dynamic factors still come from the starless images. After combination
the script applies the same curves and selective saturation boost as the
original utility.

## Options

- **Two or three channels.** Ha + OIII, or SII + Ha + OIII.
- **Palette.** Foraxx (dynamic), SHO, HOO, HSO, OHS. Two-channel data offers
  Foraxx and HOO.
- **Channel gains.** Multiply each starless channel (clipped at 1) before
  combination. With Foraxx this also shifts the dynamic factors. Star images
  are not scaled.
- **Output identifier.** Defaults to the palette name. The stars image gets
  `_stars`, the combined image `_combined`. Taken identifiers get a numeric
  suffix, so nothing is overwritten.
- **Stars image.** Optional.
- **Combined image.** Optional: the stars screened onto the result,
  `~(~result*~stars)`.
- **Factor images.** Show the `o` and `ho` factor images (Foraxx only). They
  are informative; the result does not depend on them.
- **Standard adjustments.** Uncheck to get the raw PixelMath output.
- Options are remembered between runs. The reset button restores defaults.

## Install

### From the update repository

Add `https://pixinsight.psf-guard.com/` under Resources > Updates > Manage
Repositories, then check for updates. That repository
([theatrus/pixinsight-repository](https://github.com/theatrus/pixinsight-repository))
serves this version to PixInsight 1.9.4 and later 1.9.x, and the legacy 1.16
package to 1.8.9-3 through 1.9.3. The original publisher's URL,
`https://foraxxpaletteutility.com/FPU/`, still serves 1.16 only.

### By hand

Copy `src/scripts/ForaxxPalette` and `rsc/icons/script/ForaxxPalette` into
the matching directories of your PixInsight install, then run Script >
Feature Scripts and add it. It appears under Script > PSF Guard Scripts >
Foraxx Palette Utility.

## Layout

```
src/scripts/ForaxxPalette/ForaxxPalette.js       entry point, menu metadata
src/scripts/ForaxxPalette/lib/ForaxxEngine.js    parameters, palettes, PixelMath, curves
src/scripts/ForaxxPalette/lib/ForaxxDialog.js    the dialog
rsc/icons/script/ForaxxPalette/ForaxxPalette.svg  the menu icon
test/ForaxxTest.js                               headless test suite
test/run-headless.sh                             runs the suite in PixInsight
build.sh                                         builds the update package and updates.xri
legacy/FPU_202412230653.zip                      the original 1.16 package (SpiderMonkey)
```

## Test

The suite builds synthetic images, runs every mode, and checks output pixels
against the formulas computed in plain JavaScript. It needs a local
PixInsight 1.9.4 install and runs it offscreen, so no display is needed.

```
PIXINSIGHT_DIR=~/PixInsight ./test/run-headless.sh
```

## Build and publish

```
./build.sh
```

writes `dist/` with the new package zip, the legacy zip and a standalone
`updates.xri` with the right SHA-1 digests. To publish, copy the new zip into
`packages/` of
[theatrus/pixinsight-repository](https://github.com/theatrus/pixinsight-repository),
update its `packages.json`, and push; `dist/updates.xri` is only needed if you
host the package somewhere on its own. The scripts are not code-signed; PixInsight runs unsigned
scripts with a console warning. Signing is optional for scripts and can be
done with Script > Development > SigningKeys and CodeSign.

## Porting notes

Changes needed for the V8 runtime, following Pleiades' porting guide:

- `#engine v8` before `#feature-id`, and `CoreApplication.ensureMinimumVersion( 1, 9, 4 )`.
- No `#include <pjsr/*.jsh>`. Constants such as `StdIcon.Warning` and
  `StdButton.Ok` are built in.
- Dialogs are `class ... extends Dialog`. The old `this.__base__ = Dialog`
  pattern silently does nothing on V8.
- Process constants live on the class: `PixelMath.RGB`, not
  `PixelMath.prototype.RGB`.
- `View.viewById` returns `null` for a missing view instead of an invalid
  View object.
- `jsAutoGC` and the other global extensions are deprecated and removed.

## Credits

- **Paul Hancock (Paulyman Astro)** wrote and published the original
  Foraxx Palette Utility (versions 1.0 to 1.16, 2023-2024), distributed
  from <https://foraxxpaletteutility.com/> and presented on the Paulyman
  Astro YouTube channel (<https://www.youtube.com/watch?v=cl3_r3bL8Ys>).
  The expressions, curves and saturation settings here are his.
  Copyright (c) 2023-2024 Paul Hancock.
- The Foraxx palette and its dynamic PixelMath expressions come from
  **The Coldest Nights**:
  <https://thecoldestnights.com/2020/06/pixinsight-dynamic-narrowband-combinations-with-pixelmath/>.
- Porting guidance: Juan Conejero, "The New V8 JavaScript Runtime in
  PixInsight 1.9.4: Script Porting Guide",
  <https://pixinsight.net/dev/index.php?articles/the-new-v8-javascript-runtime-in-pixinsight-1-9-4-script-porting-guide.13/>.
- This product is based on software from the PixInsight project, developed
  by Pleiades Astrophoto and its contributors (<https://pixinsight.com/>).

## License

Copyright (c) 2023-2024 Paul Hancock (Paulyman Astro) for the original script.
Copyright (c) 2026 Yann Ramin for the V8 rewrite and the palette tools. The
original script is marked "All Rights Reserved"; this port is published with
attribution as a derivative of that work and does not grant rights beyond
those the original author allows.

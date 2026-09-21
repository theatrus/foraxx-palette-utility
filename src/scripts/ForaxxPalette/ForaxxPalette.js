/*
 ****************************************************************************
 * Foraxx Palette Utility
 *
 * ForaxxPalette.js
 * Copyright (C) 2023-2024 Paul Hancock (Paulyman Astro), original script,
 *                         published at https://foraxxpaletteutility.com/
 * Copyright (C) 2026 Yann Ramin, V8 rewrite and palette tools
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0. See LICENSE
 * and NOTICE in this distribution.
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Foraxx palette and its expressions are the work of The Coldest Nights:
 * https://thecoldestnights.com/2020/06/pixinsight-dynamic-narrowband-combinations-with-pixelmath/
 *
 * Builds a Foraxx palette image from stretched, starless narrowband images,
 * plus an optional colour stars image from the matching stretched star
 * images.
 *
 * With SII, Ha and OIII data, choose three channels and select the starless
 * and stars image for each. With only Ha and OIII (mono, or OSC with a dual
 * narrowband filter), choose two channels.
 *
 * The script creates the dynamic PixelMath factor images (o, ho) and then
 * runs the Foraxx expressions for the number of channels chosen. The result
 * is a Foraxx image and, if requested, a Foraxx_stars image.
 *
 * This product is based on software from the PixInsight project, developed
 * by Pleiades Astrophoto and its contributors (https://pixinsight.com/).
 *
 * Version history
 * 1.0     2023-01-13 first release v1 (Didn't go so well).
 * 1.01    2023-01-14 Hopefully fixed the web host bugs.
 * 1.15    2023-08-19 PI 1.8.9-2 ready.
 * 1.16    2024-12-23 PI 1.9 ready.
 * 2.3.0   2026-09-21 Live preview: the real build on downsampled copies of
 *                    the inputs in hidden windows, rebuilt a moment after
 *                    any change.
 * 2.2.4   2026-09-21 Fix: 2.2.2 and 2.2.3 failed to load. A URL in the
 *                    #feature-info directive was cut at "//" by the
 *                    preprocessor. The test runner now loads the script.
 * 2.2.3   2026-09-21 Apache License 2.0; LICENSE and NOTICE ship in the
 *                    package.
 * 2.2.2   2026-09-20 Credit The Coldest Nights, the palette's origin, in the
 *                    dialog and the feature info.
 * 2.2.1   2026-09-20 Menu category renamed to theatr.us; repository moved
 *                    to https://pixinsight.theatr.us/.
 * 2.2.0   2026-09-20 Mask bias and contrast for the Foraxx factors,
 *                    per-channel midtone shaping, channel-ratio masks,
 *                    protected saturation, and a colour-preserving L*
 *                    brightness curve.
 * 2.1.0   2026-09-20 Moves to the PSF Guard Scripts menu with an icon;
 *                    Yann Ramin added to the copyright.
 * 2.0.0   2026-09-19 Rewritten for the PixInsight 1.9.4 V8 JavaScript
 *                    runtime. Same Foraxx expressions and curves. Adds
 *                    static SHO/HOO/HSO/OHS palettes, channel gains, a
 *                    custom output identifier, an optional combined image
 *                    with the stars screened in, a switch for the factor
 *                    images and for the standard adjustments, remembered
 *                    settings, an image size check, and a test suite.
 ****************************************************************************
 */

#engine v8

// No "//" may appear on a preprocessor directive line below (a URL, for
// instance): the preprocessor treats it as a comment, which drops the line
// continuation and turns the rest of the directive into a syntax error.
// test/run-headless.sh loads this file in PixInsight to catch that.

#feature-id    ForaxxPalette : theatr.us > Foraxx Palette Utility

#feature-icon  @script_icons_dir/ForaxxPalette.svg

#feature-info  Builds a Foraxx (or SHO, HOO, HSO, OHS) palette image from stretched, \
               starless SII/Ha/OIII or Ha/OIII images, plus an optional colour \
               stars image.<br/>\
               <br/>\
               Palette by The Coldest Nights (thecoldestnights.com).<br/>\
               Original script by Paul Hancock, Paulyman Astro.<br/>\
               Copyright &copy; 2023-2024 Paul Hancock. \
               Copyright &copy; 2026 Yann Ramin.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

const TITLE = "Foraxx Palette Utility";
const VERSION = "2.3.0";
const WEBSITE = "https://thecoldestnights.com/2020/06/pixinsight-dynamic-narrowband-combinations-with-pixelmath/";

#include "lib/ForaxxEngine.js"
#include "lib/ForaxxDialog.js"

function main()
{
   if ( Parameters.isGlobalTarget || Parameters.isViewTarget )
   {
      (new MessageBox( TITLE + " must be run from the Script menu.",
                       TITLE, StdIcon.Warning, StdButton.Ok )).execute();
      return;
   }

   let params = new ForaxxParameters;
   params.load();
   let dialog = new ForaxxDialog( params );
   if ( !dialog.execute() )
      return;
   params.save();

   console.show();
   try
   {
      buildForaxx( params );
   }
   catch ( error )
   {
      console.criticalln( "<end><cbr>*** " + TITLE + ": " + error.message );
      (new MessageBox( error.message, TITLE, StdIcon.Error, StdButton.Ok )).execute();
   }
}

main();

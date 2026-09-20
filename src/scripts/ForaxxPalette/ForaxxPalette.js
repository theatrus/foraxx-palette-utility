/*
 ****************************************************************************
 * Foraxx Palette Utility
 *
 * ForaxxPalette.js
 * Copyright (C) 2023-2024 Paul Hancock (Paulyman Astro), original script,
 *                         published at https://foraxxpaletteutility.com/
 * Copyright (C) 2026 Yann Ramin, V8 rewrite and palette tools
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

#feature-id    ForaxxPalette : PSF Guard Scripts > Foraxx Palette Utility

#feature-icon  @script_icons_dir/ForaxxPalette.svg

#feature-info  Builds a Foraxx (or SHO, HOO, HSO, OHS) palette image from stretched, \
               starless SII/Ha/OIII or Ha/OIII images, plus an optional colour \
               stars image.<br/>\
               <br/>\
               Original script by Paul Hancock, Paulyman Astro.<br/>\
               Copyright &copy; 2023-2024 Paul Hancock. \
               Copyright &copy; 2026 Yann Ramin.

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

const TITLE = "Foraxx Palette Utility";
const VERSION = "2.1.0";
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

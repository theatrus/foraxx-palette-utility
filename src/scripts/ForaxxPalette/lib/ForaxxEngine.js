/*
 ****************************************************************************
 * Foraxx Palette Utility
 *
 * lib/ForaxxEngine.js
 *
 * Parameters, palette definitions, PixelMath expression builders, image
 * construction and the standard curves adjustments. This file has no user
 * interface and can be included on its own (the test suite does this).
 *
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
 * Foraxx expressions: The Coldest Nights, "Dynamic Narrowband Combinations
 * with PixelMath".
 ****************************************************************************
 */

const SETTINGS_KEY = "ForaxxPalette";

/*
 * True if view is a usable View object. Handles both the V8 runtime, where
 * missing views are null, and old code paths that hand out invalid View
 * objects.
 */
function isValidView( view )
{
   return view != null && view.isView && !view.isNull;
}

/*
 * True if a main view or preview with the given identifier exists.
 */
function viewExists( id )
{
   let view = View.viewById( id );
   return view != null && !view.isNull;
}

/*
 * True if id can be used as a PixInsight view identifier.
 */
function isValidViewId( id )
{
   return /^[A-Za-z_][A-Za-z0-9_]*$/.test( id );
}

/*
 * Returns baseId, or baseId plus a two-digit suffix, such that the result
 * and every result + suffix (for each string in suffixes) is a free view
 * identifier.
 */
function uniqueViewId( baseId, suffixes = [] )
{
   for ( let n = 0; ; ++n )
   {
      let id = (n == 0) ? baseId : baseId + format( "%02d", n );
      if ( !viewExists( id ) && suffixes.every( s => !viewExists( id + s ) ) )
         return id;
   }
}

/*
 * Palettes. 'map' lists the channel (s, h, o) placed in R, G and B for the
 * static palettes. The Foraxx palette is dynamic, see paletteExpressions().
 */
const ForaxxPalettes = [
   { id: "Foraxx", name: "Foraxx (dynamic)",  dynamic: true, twoChannels: true },
   { id: "SHO",    name: "SHO (Hubble)",      map: [ "s", "h", "o" ], twoChannels: false },
   { id: "HOO",    name: "HOO",               map: [ "h", "o", "o" ], twoChannels: true },
   { id: "HSO",    name: "HSO",               map: [ "h", "s", "o" ], twoChannels: false },
   { id: "OHS",    name: "OHS",               map: [ "o", "h", "s" ], twoChannels: false }
];

function paletteById( id )
{
   return ForaxxPalettes.find( p => p.id == id ) || null;
}

/*
 * The palettes that can be built from the given number of channels.
 */
function palettesFor( threeChannels )
{
   return ForaxxPalettes.filter( p => threeChannels || p.twoChannels );
}

/*
 * User selection: input views and options.
 */
class ForaxxParameters
{
   constructor()
   {
      this.reset();
      this.sii = null;
      this.siiStars = null;
      this.ha = null;
      this.haStars = null;
      this.oiii = null;
      this.oiiiStars = null;
   }

   /*
    * Restores the default options. Selected views are kept.
    */
   reset()
   {
      this.threeChannels = true;       // false: Ha + OIII only
      this.palette = "Foraxx";         // one of ForaxxPalettes[].id
      this.siiGain = 1.0;              // channel gains, applied to the starless images
      this.haGain = 1.0;
      this.oiiiGain = 1.0;
      this.outputId = "Foraxx";        // identifier of the result image
      this.createStars = true;         // also build a stars image
      this.createCombined = false;     // also screen the stars onto the result
      this.createFactorImages = true;  // show the o and ho factor images (Foraxx only)
      this.applyAdjustments = true;    // apply the standard curves and saturation boost

      // Channel shaping: a midtones transfer after the gain (0.5 = none;
      // lower lifts faint signal without pushing highlights into clipping).
      this.siiMidtone = 0.5;
      this.haMidtone = 0.5;
      this.oiiiMidtone = 0.5;

      // Mask shaping for the dynamic factors (Foraxx only). Bias is a
      // midtones balance (0.5 = none; lower brightens the mask, so SII
      // replaces Ha in red, and Ha replaces OIII in green, over more of the
      // image). Contrast steepens the mask around 0.5 (1 = none).
      this.oBias = 0.5;
      this.oContrast = 1.0;
      this.hoBias = 0.5;
      this.hoContrast = 1.0;

      // Channel-ratio masks: OIII/(Ha+OIII) and SII/(Ha+SII), faded out
      // where the mean signal is below the threshold.
      this.createRatioMasks = false;
      this.ratioThreshold = 0.05;

      // Protected saturation: boost through a mask that excludes the dark
      // background and already saturated pixels.
      this.protectedSaturation = false;
      this.saturationAmount = 0.25;
      this.saturationBackground = 0.10;

      // Colour-preserving brightness: a curve on CIE L* only (0 = none).
      this.lightnessLift = 0.0;
   }

   /*
    * Every option that is remembered between runs: [property, DataType].
    */
   static get persisted()
   {
      return [
         [ "threeChannels", DataType.Boolean ], [ "palette", DataType.String ],
         [ "siiGain", DataType.Double ], [ "haGain", DataType.Double ], [ "oiiiGain", DataType.Double ],
         [ "siiMidtone", DataType.Double ], [ "haMidtone", DataType.Double ], [ "oiiiMidtone", DataType.Double ],
         [ "oBias", DataType.Double ], [ "oContrast", DataType.Double ],
         [ "hoBias", DataType.Double ], [ "hoContrast", DataType.Double ],
         [ "outputId", DataType.String ],
         [ "createStars", DataType.Boolean ], [ "createCombined", DataType.Boolean ],
         [ "createFactorImages", DataType.Boolean ], [ "applyAdjustments", DataType.Boolean ],
         [ "createRatioMasks", DataType.Boolean ], [ "ratioThreshold", DataType.Double ],
         [ "protectedSaturation", DataType.Boolean ], [ "saturationAmount", DataType.Double ],
         [ "saturationBackground", DataType.Double ], [ "lightnessLift", DataType.Double ]
      ];
   }

   /*
    * The [label, view] pairs the current mode needs.
    */
   requiredInputs()
   {
      let inputs = [ [ "Ha", this.ha ], [ "OIII", this.oiii ] ];
      if ( this.threeChannels )
         inputs.unshift( [ "SII", this.sii ] );
      if ( this.createStars )
      {
         if ( this.threeChannels )
            inputs.push( [ "SII stars", this.siiStars ] );
         inputs.push( [ "Ha stars", this.haStars ], [ "OIII stars", this.oiiiStars ] );
      }
      return inputs;
   }

   /*
    * Returns an error message, or an empty string if the selection can run.
    */
   validate()
   {
      let palette = paletteById( this.palette );
      if ( palette == null )
         return "Unknown palette '" + this.palette + "'.";
      if ( !this.threeChannels && !palette.twoChannels )
         return "The " + palette.name + " palette needs SII data. Choose three channels or another palette.";

      if ( !isValidViewId( this.outputId ) )
         return "'" + this.outputId + "' is not a valid image identifier. Use letters, digits and underscores, and do not start with a digit.";

      for ( let [label, gain] of [ [ "SII", this.siiGain ], [ "Ha", this.haGain ], [ "OIII", this.oiiiGain ] ] )
         if ( !(gain > 0) || !isFinite( gain ) )
            return "The " + label + " gain must be a positive number.";
      for ( let [label, m] of [ [ "SII", this.siiMidtone ], [ "Ha", this.haMidtone ], [ "OIII", this.oiiiMidtone ],
                                [ "o mask bias", this.oBias ], [ "ho mask bias", this.hoBias ] ] )
         if ( !(m > 0 && m < 1) )
            return "The " + label + " midtone must be between 0 and 1 (0.5 is neutral).";
      for ( let [label, c] of [ [ "o", this.oContrast ], [ "ho", this.hoContrast ] ] )
         if ( !(c > 0) || !isFinite( c ) )
            return "The " + label + " mask contrast must be a positive number.";
      if ( !(this.ratioThreshold >= 0 && this.ratioThreshold < 1) )
         return "The ratio mask threshold must be between 0 and 1.";
      if ( !(this.saturationAmount >= 0) || !(this.saturationBackground >= 0 && this.saturationBackground < 1) )
         return "Saturation amount must be 0 or more and the background threshold between 0 and 1.";
      if ( !(this.lightnessLift > -0.5 && this.lightnessLift < 0.5) )
         return "The lightness lift must be between -0.5 and 0.5.";

      let inputs = this.requiredInputs();
      let missing = inputs.filter( i => !isValidView( i[1] ) ).map( i => i[0] );
      if ( missing.length > 0 )
         return "Please select an image for: " + missing.join( ", " ) + ".";

      let [refLabel, refView] = inputs[0];
      let refImage = refView.image;
      for ( let [label, view] of inputs )
      {
         let image = view.image;
         if ( image.width != refImage.width || image.height != refImage.height )
            return "All selected images must have the same dimensions: "
                 + label + " (" + view.id + ", " + image.width + "x" + image.height + ") differs from "
                 + refLabel + " (" + refView.id + ", " + refImage.width + "x" + refImage.height + ").";
      }
      return "";
   }

   /*
    * Stores the options (not the views) in PixInsight settings.
    */
   save()
   {
      try
      {
         for ( let [key, type] of ForaxxParameters.persisted )
            Settings.write( SETTINGS_KEY + "/" + key, type, this[key] );
      }
      catch ( e )
      {
         console.warningln( "<end><cbr>** Could not save settings: " + e.message );
      }
   }

   /*
    * Loads the options stored by save(). Missing keys keep their defaults.
    */
   load()
   {
      try
      {
         for ( let [key, type] of ForaxxParameters.persisted )
         {
            let value = Settings.read( SETTINGS_KEY + "/" + key, type );
            if ( Settings.lastReadOK )
               this[key] = value;
         }
      }
      catch ( e )
      {
         console.warningln( "<end><cbr>** Could not load settings: " + e.message );
      }
      if ( paletteById( this.palette ) == null )
         this.palette = "Foraxx";
      if ( !isValidViewId( this.outputId ) )
         this.outputId = this.palette;
   }
}

/*
 * PixelMath expression builders. Arguments are view identifiers or
 * expressions. '~x' is PixelMath's pixel inversion, 1 - x.
 */
const ForaxxExpressions = {
   // The dynamic OIII factor: O^~O
   oFactor( oiii )
   {
      return `(${oiii})^~(${oiii})`;
   },

   // The dynamic Ha*OIII factor: (Ha*O)^~(Ha*O)
   hoFactor( ha, oiii )
   {
      return `(${ha}*${oiii})^~(${ha}*${oiii})`;
   },

   // Weighted mix of a and b: factor*a + ~factor*b
   blend( factor, a, b )
   {
      return `(${factor})*${a} + ~(${factor})*${b}`;
   },

   // A channel scaled by a gain and clipped to 1
   scaled( id, gain )
   {
      return (gain == 1) ? id : `min(1, ${gain}*${id})`;
   },

   // A midtones transfer; 0.5 is the identity
   midtones( expr, m )
   {
      return (m == 0.5) ? expr : `mtf(${m}, ${expr})`;
   },

   // A channel after gain and midtone shaping
   shaped( id, gain, midtone )
   {
      return ForaxxExpressions.midtones( ForaxxExpressions.scaled( id, gain ), midtone );
   },

   // A factor after bias (midtones) and contrast around 0.5, clipped to [0,1]
   shapedFactor( expr, bias, contrast )
   {
      let e = ForaxxExpressions.midtones( expr, bias );
      if ( contrast != 1 )
         e = `max(0, min(1, (${e} - 0.5)*${contrast} + 0.5))`;
      return e;
   },

   // Relative strength of a over a+b, faded to 0 where the mean of the listed
   // channels is below threshold
   ratio( a, b, channels, threshold )
   {
      let mean = `mean(${channels.join( ", " )})`;
      return `(${a}/(${a} + ${b} + 1e-6)) * min(1, ${mean}/${threshold})`;
   },

   // Protected-saturation mask for an RGB image: L* above the background
   // threshold, times one minus the current saturation
   saturationMask( background )
   {
      let mx = "max($T[0], $T[1], $T[2])";
      let mn = "min($T[0], $T[1], $T[2])";
      let sat = `(${mx} - ${mn})/max(1e-6, ${mx})`;
      return `max(0, (CIEL($T) - ${background})/(1 - ${background})) * (1 - ${sat})`;
   },

   // Screen blend: ~(~a*~b)
   screen( a, b )
   {
      return `~(~${a}*~${b})`;
   }
};

/*
 * Builds the [R, G, B] expressions for a palette.
 *
 * factors: { h, o } expressions of the (gain-scaled) starless channels that
 *          drive the dynamic Foraxx factors.
 * sources: { s, h, o } expressions placed in the palette's colour terms:
 *          the starless channels for the nebula image, the star channels for
 *          the stars image.
 */
function paletteExpressions( palette, threeChannels, factors, sources, shaping = {} )
{
   let X = ForaxxExpressions;
   if ( palette.dynamic )
   {
      let ho = X.shapedFactor( X.hoFactor( factors.h, factors.o ), shaping.hoBias ?? 0.5, shaping.hoContrast ?? 1 );
      let o = X.shapedFactor( X.oFactor( factors.o ), shaping.oBias ?? 0.5, shaping.oContrast ?? 1 );
      let r = threeChannels ? X.blend( o, sources.s, sources.h ) : sources.h;
      let g = X.blend( ho, sources.h, sources.o );
      let b = sources.o;
      return [ r, g, b ];
   }
   return palette.map.map( c => sources[c] );
}

/*
 * Runs PixelMath on targetView to create a new image with the given
 * identifier. For a grayscale image only r is used. Returns the new view.
 */
function createImage( targetView, newImageId, colorSpace, r, g = "", b = "", show = true )
{
   let P = new PixelMath;
   P.expression = r;
   P.expression1 = g;
   P.expression2 = b;
   P.expression3 = "";
   P.useSingleExpression = (colorSpace == PixelMath.Gray);
   P.symbols = "";
   P.clearImageCacheAndExit = false;
   P.cacheGeneratedImages = false;
   P.generateOutput = true;
   P.singleThreaded = false;
   P.optimization = true;
   P.use64BitWorkingImage = false;
   P.rescale = false;
   P.rescaleLower = 0;
   P.rescaleUpper = 1;
   P.truncate = true;
   P.truncateLower = 0;
   P.truncateUpper = 1;
   P.createNewImage = true;
   P.showNewImage = show;
   P.newImageId = newImageId;
   P.newImageWidth = 0;
   P.newImageHeight = 0;
   P.newImageAlpha = false;
   P.newImageColorSpace = colorSpace;
   P.newImageSampleFormat = PixelMath.SameAsTarget;

   // The target is not modified, so no swap file is needed.
   if ( !P.executeOn( targetView, false/*swapFile*/ ) )
      throw new Error( "PixelMath failed while creating '" + newImageId + "'." );

   let view = View.viewById( newImageId );
   if ( !isValidView( view ) )
      throw new Error( "PixelMath did not create the expected image '" + newImageId + "'." );
   return view;
}

/*
 * Standard adjustments applied to the palette image.
 */
function applyForaxxAdjustments( view )
{
   let C1 = new CurvesTransformation;
   C1.H = [ // x, y
      [0.00000, 0.00000],
      [0.02517, 0.05952],
      [0.07323, 0.08571],
      [0.11442, 0.13810],
      [0.62014, 0.67619],
      [1.00000, 1.00000]
   ];
   C1.Ht = CurvesTransformation.AkimaSubsplines;
   C1.S = [ // x, y
      [0.00000, 0.00000],
      [0.50801, 0.61667],
      [1.00000, 1.00000]
   ];
   C1.St = CurvesTransformation.AkimaSubsplines;
   C1.executeOn( view );

   let C2 = new CurvesTransformation;
   C2.H = [ // x, y
      [0.00000, 0.00000],
      [0.05034, 0.03571],
      [0.08238, 0.10238],
      [0.24943, 0.25000],
      [1.00000, 1.00000]
   ];
   C2.Ht = CurvesTransformation.AkimaSubsplines;
   C2.executeOn( view );

   let S = new ColorSaturation;
   S.HS = [ // x, y
      [0.00000,  0.00000],
      [0.04910,  0.00909],
      [0.07235,  0.00909],
      [0.10594,  0.15455],
      [0.19380,  0.00909],
      [0.37726,  0.00000],
      [0.52972,  0.00909],
      [0.60465,  0.13636],
      [0.68475, -0.00909],
      [0.84496,  0.00000],
      [1.00000,  0.00000]
   ];
   S.HSt = ColorSaturation.AkimaSubsplines;
   S.hueShift = 0.000;
   // The original script applies the saturation boost twice.
   S.executeOn( view );
   S.executeOn( view );
}

/*
 * Standard adjustment applied to the stars image.
 */
function applyStarAdjustments( view )
{
   let C = new CurvesTransformation;
   C.H = [ // x, y
      [0.00000, 0.05476],
      [0.12815, 0.12857],
      [0.24943, 0.24524],
      [0.37300, 0.37857],
      [0.49886, 0.60000],
      [0.62471, 0.62619],
      [0.75057, 0.74048],
      [0.87872, 0.87381],
      [1.00000, 1.00000]
   ];
   C.Ht = CurvesTransformation.AkimaSubsplines;
   C.executeOn( view );
}

/*
 * Boosts saturation on view through a generated mask (L* above the
 * background threshold, times one minus the current saturation). The mask
 * image is left open as maskId for reuse. Returns the mask view.
 */
function applyProtectedSaturation( view, maskId, amount, background, show = true )
{
   let mask = createImage( view, maskId, PixelMath.Gray, ForaxxExpressions.saturationMask( background ), "", "", show );
   let window = view.window;
   window.mask = mask.window;
   window.maskEnabled = true;
   window.maskInverted = false;
   try
   {
      let S = new ColorSaturation;
      S.HS = [ [0.00000, amount], [0.50000, amount], [1.00000, amount] ];
      S.HSt = ColorSaturation.AkimaSubsplines;
      S.hueShift = 0.000;
      S.executeOn( view );
   }
   finally
   {
      window.removeMask();
   }
   return mask;
}

/*
 * Colour-preserving brightness: a curve on CIE L* only, through
 * (0.5, 0.5 + lift).
 */
function applyLightnessLift( view, lift )
{
   let C = new CurvesTransformation;
   C.L = [ [0.00000, 0.00000], [0.50000, 0.50000 + lift], [1.00000, 1.00000] ];
   C.Lt = CurvesTransformation.AkimaSubsplines;
   C.executeOn( view );
}

/*
 * Builds the palette image and, if requested, the stars and combined
 * images, from a validated ForaxxParameters object.
 *
 * options.show (default true): show the created image windows. The preview
 * passes false and closes them itself.
 *
 * Returns { foraxx: View, stars: View|null, combined: View|null,
 *           factors: Array of View, masks: Array of View }.
 */
function buildForaxx( params, options = {} )
{
   let error = params.validate();
   if ( error )
      throw new Error( error );
   let show = options.show !== false;

   let palette = paletteById( params.palette );
   let X = ForaxxExpressions;

   let suffixes = [ "_stars", "_combined", "_ratio_OIII", "_ratio_SII", "_satmask" ];
   let ids = {
      ho: uniqueViewId( "ho" ),
      o: uniqueViewId( "o" ),
      result: uniqueViewId( params.outputId, suffixes )
   };
   for ( let sfx of suffixes )
      ids[sfx.substring( 1 )] = ids.result + sfx;

   let shaping = { oBias: params.oBias, oContrast: params.oContrast,
                   hoBias: params.hoBias, hoContrast: params.hoContrast };

   // Starless channels after gain and midtone shaping.
   let nebula = {
      s: params.threeChannels ? X.shaped( params.sii.id, params.siiGain, params.siiMidtone ) : "",
      h: X.shaped( params.ha.id, params.haGain, params.haMidtone ),
      o: X.shaped( params.oiii.id, params.oiiiGain, params.oiiiMidtone )
   };

   console.writeln( "<end><cbr><br>" + TITLE + ": building " + palette.name + " from "
                    + (params.threeChannels ? "SII, Ha and OIII" : "Ha and OIII") );

   let factors = [];
   if ( palette.dynamic && params.createFactorImages )
   {
      console.writeln( "Creating the 'HO' dynamic PixelMath factor image: " + ids.ho );
      factors.push( createImage( params.ha, ids.ho, PixelMath.Gray,
                                 X.shapedFactor( X.hoFactor( nebula.h, nebula.o ), shaping.hoBias, shaping.hoContrast ), "", "", show ) );
      if ( params.threeChannels )
      {
         console.writeln( "Creating the 'O' dynamic PixelMath factor image: " + ids.o );
         factors.push( createImage( params.ha, ids.o, PixelMath.Gray,
                                    X.shapedFactor( X.oFactor( nebula.o ), shaping.oBias, shaping.oContrast ), "", "", show ) );
      }
   }

   let masks = [];
   if ( params.createRatioMasks )
   {
      let channels = params.threeChannels ? [ nebula.h, nebula.o, nebula.s ] : [ nebula.h, nebula.o ];
      console.writeln( "Creating the OIII ratio mask: " + ids.ratio_OIII );
      masks.push( createImage( params.ha, ids.ratio_OIII, PixelMath.Gray,
                               X.ratio( nebula.o, nebula.h, channels, params.ratioThreshold ), "", "", show ) );
      if ( params.threeChannels )
      {
         console.writeln( "Creating the SII ratio mask: " + ids.ratio_SII );
         masks.push( createImage( params.ha, ids.ratio_SII, PixelMath.Gray,
                                  X.ratio( nebula.s, nebula.h, channels, params.ratioThreshold ), "", "", show ) );
      }
   }

   console.writeln( "Creating the " + palette.id + " image: " + ids.result );
   let [r, g, b] = paletteExpressions( palette, params.threeChannels, nebula, nebula, shaping );
   let foraxx = createImage( params.ha, ids.result, PixelMath.RGB, r, g, b, show );
   if ( params.applyAdjustments )
   {
      console.writeln( "Applying curves and saturation adjustments ..." );
      applyForaxxAdjustments( foraxx );
   }
   if ( params.protectedSaturation && params.saturationAmount > 0 )
   {
      console.writeln( "Applying protected saturation through " + ids.satmask + " ..." );
      masks.push( applyProtectedSaturation( foraxx, ids.satmask, params.saturationAmount, params.saturationBackground, show ) );
   }
   if ( params.lightnessLift != 0 )
   {
      console.writeln( "Applying the L* brightness curve ..." );
      applyLightnessLift( foraxx, params.lightnessLift );
   }

   let stars = null;
   if ( params.createStars )
   {
      let starSources = {
         s: params.threeChannels ? params.siiStars.id : "",
         h: params.haStars.id,
         o: params.oiiiStars.id
      };
      console.writeln( "Creating the stars image: " + ids.stars );
      let [rs, gs, bs] = paletteExpressions( palette, params.threeChannels, nebula, starSources, shaping );
      stars = createImage( params.ha, ids.stars, PixelMath.RGB, rs, gs, bs, show );
      if ( params.applyAdjustments )
      {
         console.writeln( "Applying curves adjustments to the stars ..." );
         applyStarAdjustments( stars );
      }
   }

   let combined = null;
   if ( params.createStars && params.createCombined )
   {
      console.writeln( "Creating the combined image (stars screened in): " + ids.combined );
      let e = X.screen( ids.result, ids.stars );
      combined = createImage( foraxx, ids.combined, PixelMath.RGB, e, e, e, show );
   }

   console.noteln( TITLE + ": done." );
   return { foraxx, stars, combined, factors, masks };
}

/*
 * Downsampled, optionally cropped copies of the selected images in hidden
 * windows, kept between previews so that a parameter change does not copy
 * and resample the full-size sources again. Rebuilt when the views, the
 * selection or the scale change. Call dispose() when done.
 */
class PreviewSourceCache
{
   constructor()
   {
      this.key = null;
      this.windows = [];
      this.views = {};
   }

   /*
    * Returns { sii, ha, oiii, siiStars, haStars, oiiiStars } small views for
    * the given selection (a Rect in image coordinates, or null for the whole
    * image) and scale (0 < scale <= 1).
    */
   sources( params, selection, scale )
   {
      let keys = [ "ha", "oiii" ];
      if ( params.threeChannels )
         keys.push( "sii" );
      if ( params.createStars )
      {
         keys.push( "haStars", "oiiiStars" );
         if ( params.threeChannels )
            keys.push( "siiStars" );
      }
      let sel = selection ? [ selection.x0, selection.y0, selection.x1, selection.y1 ] : null;
      let key = JSON.stringify( [ keys.map( k => params[k].fullId ), sel, scale ] );
      if ( key != this.key )
      {
         this.dispose();
         for ( let k of keys )
            this.views[k] = this.smallCopy( params[k], k, selection, scale );
         this.key = key;
      }
      return this.views;
   }

   smallCopy( view, tag, selection, scale )
   {
      let img = new Image( view.image );
      if ( selection )
         img.cropTo( selection.x0, selection.y0, selection.x1, selection.y1 );
      if ( scale < 1 )
         img.resample( scale );
      let window = new ImageWindow( img.width, img.height, img.numberOfChannels, 32, true, img.isColor,
                                    uniqueViewId( "fpv_" + tag ) );
      this.windows.push( window );
      window.mainView.beginProcess( UndoFlag.NoSwapFile );
      window.mainView.image.assign( img );
      window.mainView.endProcess();
      img.free();
      return window.mainView;
   }

   dispose()
   {
      for ( let w of this.windows )
         try { w.forceClose(); } catch ( e ) {}
      this.windows = [];
      this.views = {};
      this.key = null;
   }
}

/*
 * Renders a preview of the result: the real build, run on downsampled
 * copies of the selected images in hidden windows, returned as a Bitmap.
 * Every window it creates is closed before returning, except the cached
 * source copies when a cache is supplied.
 *
 * options: a number (the longest side of the preview) or an object
 *   { width, height }   the space the preview must fit in, in pixels
 *   selection           a Rect in image coordinates to preview, or null
 *   cache               a PreviewSourceCache to reuse source copies
 *
 * The render scale is min( 1, width/selection.width, height/selection.height ):
 * a small selection is rendered at 1:1 and left to the caller to enlarge.
 *
 * Returns { bitmap, scale, width, height, selection }.
 */
function renderPreview( params, options = 480 )
{
   let error = params.validate();
   if ( error )
      throw new Error( error );

   let ref = params.ha.image;
   let full = new Rect( 0, 0, ref.width, ref.height );
   let selection = null, fitW, fitH;
   if ( typeof options == "number" )
      fitW = fitH = options;
   else
   {
      fitW = options.width;
      fitH = options.height;
      if ( options.selection )
      {
         selection = new Rect( Math.max( 0, Math.floor( options.selection.x0 ) ), Math.max( 0, Math.floor( options.selection.y0 ) ),
                               Math.min( ref.width, Math.ceil( options.selection.x1 ) ), Math.min( ref.height, Math.ceil( options.selection.y1 ) ) );
         if ( selection.width < 2 || selection.height < 2 )
            selection = null;
      }
   }
   let region = selection || full;
   let scale = Math.min( 1, fitW/region.width, fitH/region.height );

   let cache = (typeof options == "object" && options.cache) ? options.cache : new PreviewSourceCache;
   let ownCache = !(typeof options == "object" && options.cache);
   let created = [];
   let p = new ForaxxParameters;
   try
   {
      let small = cache.sources( params, selection, scale );
      for ( let [key, type] of ForaxxParameters.persisted )
         p[key] = params[key];
      p.createFactorImages = false;
      p.createRatioMasks = false;
      p.outputId = uniqueViewId( "fpv_result" );
      for ( let k in small )
         p[k] = small[k];

      let r = buildForaxx( p, { show: false } );
      for ( let v of [ r.foraxx, r.stars, r.combined ].concat( r.factors, r.masks ) )
         if ( v != null )
            created.push( v.window );

      let shown = r.combined || r.foraxx;
      let bitmap = shown.image.render( 1, false/*transparency*/, true/*fast*/ );
      return { bitmap, scale, width: bitmap.width, height: bitmap.height, selection: region };
   }
   finally
   {
      for ( let w of created )
         try { w.forceClose(); } catch ( e ) {}
      if ( ownCache )
         cache.dispose();
   }
}

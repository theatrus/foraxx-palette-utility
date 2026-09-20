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
         Settings.write( SETTINGS_KEY + "/threeChannels", DataType.Boolean, this.threeChannels );
         Settings.write( SETTINGS_KEY + "/palette", DataType.String, this.palette );
         Settings.write( SETTINGS_KEY + "/siiGain", DataType.Double, this.siiGain );
         Settings.write( SETTINGS_KEY + "/haGain", DataType.Double, this.haGain );
         Settings.write( SETTINGS_KEY + "/oiiiGain", DataType.Double, this.oiiiGain );
         Settings.write( SETTINGS_KEY + "/outputId", DataType.String, this.outputId );
         Settings.write( SETTINGS_KEY + "/createStars", DataType.Boolean, this.createStars );
         Settings.write( SETTINGS_KEY + "/createCombined", DataType.Boolean, this.createCombined );
         Settings.write( SETTINGS_KEY + "/createFactorImages", DataType.Boolean, this.createFactorImages );
         Settings.write( SETTINGS_KEY + "/applyAdjustments", DataType.Boolean, this.applyAdjustments );
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
      let read = ( key, type, current ) =>
      {
         let value = Settings.read( SETTINGS_KEY + "/" + key, type );
         return Settings.lastReadOK ? value : current;
      };
      try
      {
         this.threeChannels = read( "threeChannels", DataType.Boolean, this.threeChannels );
         this.palette = read( "palette", DataType.String, this.palette );
         this.siiGain = read( "siiGain", DataType.Double, this.siiGain );
         this.haGain = read( "haGain", DataType.Double, this.haGain );
         this.oiiiGain = read( "oiiiGain", DataType.Double, this.oiiiGain );
         this.outputId = read( "outputId", DataType.String, this.outputId );
         this.createStars = read( "createStars", DataType.Boolean, this.createStars );
         this.createCombined = read( "createCombined", DataType.Boolean, this.createCombined );
         this.createFactorImages = read( "createFactorImages", DataType.Boolean, this.createFactorImages );
         this.applyAdjustments = read( "applyAdjustments", DataType.Boolean, this.applyAdjustments );
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
function paletteExpressions( palette, threeChannels, factors, sources )
{
   let X = ForaxxExpressions;
   if ( palette.dynamic )
   {
      let ho = X.hoFactor( factors.h, factors.o );
      let r = threeChannels ? X.blend( X.oFactor( factors.o ), sources.s, sources.h ) : sources.h;
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
function createImage( targetView, newImageId, colorSpace, r, g = "", b = "" )
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
   P.showNewImage = true;
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
 * Builds the palette image and, if requested, the stars and combined
 * images, from a validated ForaxxParameters object.
 *
 * Returns { foraxx: View, stars: View|null, combined: View|null,
 *           factors: Array of View }.
 */
function buildForaxx( params )
{
   let error = params.validate();
   if ( error )
      throw new Error( error );

   let palette = paletteById( params.palette );
   let X = ForaxxExpressions;

   let ids = {
      ho: uniqueViewId( "ho" ),
      o: uniqueViewId( "o" ),
      result: uniqueViewId( params.outputId, [ "_stars", "_combined" ] )
   };
   ids.stars = ids.result + "_stars";
   ids.combined = ids.result + "_combined";

   // Gain-scaled starless channels.
   let nebula = {
      s: params.threeChannels ? X.scaled( params.sii.id, params.siiGain ) : "",
      h: X.scaled( params.ha.id, params.haGain ),
      o: X.scaled( params.oiii.id, params.oiiiGain )
   };

   console.writeln( "<end><cbr><br>" + TITLE + ": building " + palette.name + " from "
                    + (params.threeChannels ? "SII, Ha and OIII" : "Ha and OIII") );

   let factors = [];
   if ( palette.dynamic && params.createFactorImages )
   {
      console.writeln( "Creating the 'HO' dynamic PixelMath factor image: " + ids.ho );
      factors.push( createImage( params.ha, ids.ho, PixelMath.Gray, X.hoFactor( nebula.h, nebula.o ) ) );
      if ( params.threeChannels )
      {
         console.writeln( "Creating the 'O' dynamic PixelMath factor image: " + ids.o );
         factors.push( createImage( params.ha, ids.o, PixelMath.Gray, X.oFactor( nebula.o ) ) );
      }
   }

   console.writeln( "Creating the " + palette.id + " image: " + ids.result );
   let [r, g, b] = paletteExpressions( palette, params.threeChannels, nebula, nebula );
   let foraxx = createImage( params.ha, ids.result, PixelMath.RGB, r, g, b );
   if ( params.applyAdjustments )
   {
      console.writeln( "Applying curves and saturation adjustments ..." );
      applyForaxxAdjustments( foraxx );
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
      let [rs, gs, bs] = paletteExpressions( palette, params.threeChannels, nebula, starSources );
      stars = createImage( params.ha, ids.stars, PixelMath.RGB, rs, gs, bs );
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
      combined = createImage( foraxx, ids.combined, PixelMath.RGB, e, e, e );
   }

   console.noteln( TITLE + ": done." );
   return { foraxx, stars, combined, factors };
}

/*
 ****************************************************************************
 * Foraxx Palette Utility - headless test suite
 *
 * Run with test/run-headless.sh, which fills in the two placeholders below
 * and starts PixInsight in automation mode. The suite builds synthetic
 * SII/Ha/OIII images, runs the engine in every mode, and checks the output
 * pixels against the Foraxx formulas computed in plain JavaScript.
 ****************************************************************************
 */

#engine v8

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

const TITLE = "Foraxx Palette Utility";
const VERSION = "test";
const WEBSITE = "https://thecoldestnights.com/2020/06/pixinsight-dynamic-narrowband-combinations-with-pixelmath/";
const RESULT_PATH = "@RESULT_PATH@";

#include "@ENGINE_PATH@"
#include "@DIALOG_PATH@"

const W = 64, H = 48;
const TOLERANCE = 1e-5;

let report = [];
let failures = 0;

function log( text )
{
   report.push( text );
   console.writeln( text );
}

function check( condition, what )
{
   if ( condition )
      log( "ok   - " + what );
   else
   {
      ++failures;
      log( "FAIL - " + what );
   }
}

function near( a, b )
{
   return Math.abs( a - b ) <= TOLERANCE;
}

/*
 * Creates a 32-bit float grayscale image whose pixel (x,y) is fn( x, y ).
 */
function makeImage( id, fn )
{
   let window = new ImageWindow( W, H, 1, 32, true, false, id );
   let view = window.mainView;
   view.beginProcess( UndoFlag.NoSwapFile );
   let it = new ImageIterator( view.image, 0 );
   for ( let y = 0; y < H; ++y )
      for ( let x = 0; x < W; ++x )
         it[y][x] = fn( x, y );
   it.free();
   view.endProcess();
   window.show();
   return view;
}

/*
 * The Foraxx formulas in plain JavaScript. ~x is 1-x in PixelMath.
 */
const F = {
   o( O ) { return Math.pow( O, 1 - O ); },
   ho( Ha, O ) { let p = Ha*O; return Math.pow( p, 1 - p ); },
   blend( f, a, b ) { return f*a + (1 - f)*b; },
   clamp( v ) { return Math.min( 1, Math.max( 0, v ) ); }
};

/*
 * Pixel value functions for the synthetic inputs. All stay inside [0,1] and
 * avoid exact zeros so that pow() is well behaved.
 */
const src = {
   sii:       ( x, y ) => 0.05 + 0.9*( 1 - x/(W-1) )*0.5 + 0.25*( y/(H-1) ),
   ha:        ( x, y ) => 0.05 + 0.9*( x/(W-1) ),
   oiii:      ( x, y ) => 0.05 + 0.9*( y/(H-1) ),
   siiStars:  ( x, y ) => 0.10 + 0.6*( ( x + y ) % 7 )/6,
   haStars:   ( x, y ) => 0.20 + 0.7*( ( x*3 + y ) % 5 )/4,
   oiiiStars: ( x, y ) => 0.15 + 0.5*( ( x + y*2 ) % 9 )/8
};

const samplePoints = [ [0, 0], [W-1, 0], [0, H-1], [W-1, H-1], [17, 23], [40, 9], [31, 31] ];

function checkGray( view, what, expected )
{
   let image = view.image;
   check( image.numberOfChannels == 1 && image.width == W && image.height == H, what + ": grayscale " + W + "x" + H );
   let bad = 0;
   for ( let [x, y] of samplePoints )
      if ( !near( image.sample( x, y, 0 ), expected( x, y ) ) )
         ++bad;
   check( bad == 0, what + ": pixel values match formula" );
}

function checkRGB( view, what, expected )
{
   let image = view.image;
   check( image.isColor && image.numberOfChannels == 3 && image.width == W && image.height == H, what + ": RGB " + W + "x" + H );
   let bad = 0;
   for ( let [x, y] of samplePoints )
   {
      let e = expected( x, y );
      for ( let c = 0; c < 3; ++c )
         if ( !near( image.sample( x, y, c ), e[c] ) )
            ++bad;
   }
   check( bad == 0, what + ": pixel values match formula" );
}

function checkInRange( view, what )
{
   let image = view.image;
   let ok = true;
   for ( let c = 0; c < image.numberOfChannels; ++c )
      if ( image.minimum( new Rect, c, c ) < 0 || image.maximum( new Rect, c, c ) > 1 )
         ok = false;
   check( ok, what + ": all samples in [0,1]" );
}

function run()
{
   log( "Foraxx Palette Utility test suite - " + (new Date).toISOString() );
   log( "PixInsight " + CoreApplication.versionMajor + "." + CoreApplication.versionMinor + "." + CoreApplication.versionRelease );

   let views = {};
   for ( let key in src )
      views[key] = makeImage( "T_" + key, src[key] );

   // ---- Parameter validation -------------------------------------------

   {
      let p = new ForaxxParameters;
      check( p.validate().indexOf( "SII" ) >= 0 && p.validate().indexOf( "Ha stars" ) >= 0, "validate: reports missing inputs" );

      p.threeChannels = false;
      p.createStars = false;
      p.ha = views.ha;
      p.oiii = views.oiii;
      check( p.validate() == "", "validate: Ha + OIII only is complete" );

      p.createStars = true;
      check( p.validate().indexOf( "Ha stars" ) >= 0, "validate: stars mode needs star images" );

      let small = makeImage( "T_small", () => 0.5 );
      let smallWindow = small.window;
      let old = p.oiii;
      p.oiii = new ImageWindow( 10, 10, 1, 32, true, false, "T_tiny" ).mainView;
      p.createStars = false;
      check( p.validate().indexOf( "same dimensions" ) >= 0, "validate: rejects mismatched image sizes" );
      p.oiii.window.forceClose();
      p.oiii = old;
      smallWindow.forceClose();
   }

   // ---- Mode A: three channels, stars, raw output ----------------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = true;
      p.createStars = true;
      p.applyAdjustments = false;
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;
      p.siiStars = views.siiStars; p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let r = buildForaxx( p );
      check( r.foraxx.id == "Foraxx", "A: Foraxx image id is 'Foraxx' (got " + r.foraxx.id + ")" );
      check( r.stars != null && r.stars.id == "Foraxx_stars", "A: stars image id is 'Foraxx_stars'" );
      check( r.factors.length == 2 && r.factors[0].id == "ho" && r.factors[1].id == "o", "A: factor images 'ho' and 'o' created" );

      checkGray( r.factors[0], "A: ho", ( x, y ) => F.ho( src.ha( x, y ), src.oiii( x, y ) ) );
      checkGray( r.factors[1], "A: o", ( x, y ) => F.o( src.oiii( x, y ) ) );
      checkRGB( r.foraxx, "A: Foraxx", ( x, y ) =>
      {
         let Ha = src.ha( x, y ), O = src.oiii( x, y ), S = src.sii( x, y );
         let o = F.o( O ), ho = F.ho( Ha, O );
         return [ F.clamp( F.blend( o, S, Ha ) ), F.clamp( F.blend( ho, Ha, O ) ), O ];
      } );
      checkRGB( r.stars, "A: Foraxx_stars", ( x, y ) =>
      {
         let Ha = src.ha( x, y ), O = src.oiii( x, y );
         let o = F.o( O ), ho = F.ho( Ha, O );
         let Hs = src.haStars( x, y ), Os = src.oiiiStars( x, y ), Ss = src.siiStars( x, y );
         return [ F.clamp( F.blend( o, Ss, Hs ) ), F.clamp( F.blend( ho, Hs, Os ) ), Os ];
      } );
   }

   // ---- Mode B: two channels, stars, raw output; ids get suffixes ------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.createStars = true;
      p.applyAdjustments = false;
      p.ha = views.ha; p.oiii = views.oiii;
      p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let r = buildForaxx( p );
      check( r.foraxx.id == "Foraxx01", "B: second Foraxx image id is 'Foraxx01' (got " + r.foraxx.id + ")" );
      check( r.stars != null && r.stars.id == "Foraxx01_stars", "B: stars image id is 'Foraxx01_stars'" );
      check( r.factors.length == 1 && r.factors[0].id == "ho01", "B: only the 'ho' factor is created, as 'ho01'" );

      checkRGB( r.foraxx, "B: Foraxx01", ( x, y ) =>
      {
         let Ha = src.ha( x, y ), O = src.oiii( x, y );
         let ho = F.ho( Ha, O );
         return [ Ha, F.clamp( F.blend( ho, Ha, O ) ), O ];
      } );
      checkRGB( r.stars, "B: Foraxx01_stars", ( x, y ) =>
      {
         let Ha = src.ha( x, y ), O = src.oiii( x, y );
         let ho = F.ho( Ha, O );
         let Hs = src.haStars( x, y ), Os = src.oiiiStars( x, y );
         return [ Hs, F.clamp( F.blend( ho, Hs, Os ) ), Os ];
      } );
   }

   // ---- Mode C: three channels, no stars, with adjustments -------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = true;
      p.createStars = false;
      p.applyAdjustments = true;
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      check( r.foraxx.id == "Foraxx02", "C: Foraxx image id is 'Foraxx02' (got " + r.foraxx.id + ")" );
      check( r.stars == null && View.viewById( "Foraxx02_stars" ) == null, "C: no stars image" );
      check( r.foraxx.image.isColor, "C: Foraxx02 is RGB" );
      checkInRange( r.foraxx, "C: Foraxx02" );

      // The adjustments must change the image: compare with the raw result.
      let raw = View.viewById( "Foraxx" ).image;
      let adjusted = r.foraxx.image;
      let differs = false;
      for ( let [x, y] of samplePoints )
         for ( let c = 0; c < 3; ++c )
            if ( !near( raw.sample( x, y, c ), adjusted.sample( x, y, c ) ) )
               differs = true;
      check( differs, "C: curves and saturation adjustments were applied" );
      check( r.foraxx.canGoBackward, "C: adjustments are on the undo history" );
   }

   // ---- Mode D: two channels, no stars, with adjustments ---------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.createStars = false;
      p.applyAdjustments = true;
      p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      check( r.foraxx.id == "Foraxx03", "D: Foraxx image id is 'Foraxx03' (got " + r.foraxx.id + ")" );
      check( r.stars == null, "D: no stars image" );
      checkInRange( r.foraxx, "D: Foraxx03" );
   }

   // ---- Stars adjustments ----------------------------------------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.createStars = true;
      p.applyAdjustments = true;
      p.ha = views.ha; p.oiii = views.oiii;
      p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let r = buildForaxx( p );
      check( r.stars != null && r.stars.id == "Foraxx04_stars", "E: stars image id is 'Foraxx04_stars'" );
      checkInRange( r.stars, "E: Foraxx04_stars" );
      let raw = View.viewById( "Foraxx01_stars" ).image;
      let differs = false;
      for ( let [x, y] of samplePoints )
         if ( !near( raw.sample( x, y, 0 ), r.stars.image.sample( x, y, 0 ) ) )
            differs = true;
      check( differs, "E: star curves were applied" );
   }

   // ---- Mode F: static SHO palette, three channels, stars, raw ---------

   {
      let p = new ForaxxParameters;
      p.palette = "SHO";
      p.outputId = "SHO";
      p.applyAdjustments = false;
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;
      p.siiStars = views.siiStars; p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let before = ImageWindow.windows.length;
      let r = buildForaxx( p );
      check( r.foraxx.id == "SHO" && r.stars.id == "SHO_stars", "F: SHO ids (got " + r.foraxx.id + ")" );
      check( r.factors.length == 0 && ImageWindow.windows.length == before + 2, "F: static palette creates no factor images" );
      checkRGB( r.foraxx, "F: SHO", ( x, y ) => [ src.sii( x, y ), src.ha( x, y ), src.oiii( x, y ) ] );
      checkRGB( r.stars, "F: SHO_stars", ( x, y ) => [ src.siiStars( x, y ), src.haStars( x, y ), src.oiiiStars( x, y ) ] );
   }

   // ---- Mode G: HOO, two channels, custom output identifier ------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.palette = "HOO";
      p.outputId = "M16_HOO";
      p.createStars = false;
      p.applyAdjustments = false;
      p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      check( r.foraxx.id == "M16_HOO" && r.stars == null, "G: custom identifier is used (got " + r.foraxx.id + ")" );
      checkRGB( r.foraxx, "G: M16_HOO", ( x, y ) => [ src.ha( x, y ), src.oiii( x, y ), src.oiii( x, y ) ] );
   }

   // ---- Mode H: channel gains, no factor images ------------------------

   {
      let p = new ForaxxParameters;
      p.siiGain = 0.8;
      p.haGain = 1.0;
      p.oiiiGain = 1.5;
      p.createFactorImages = false;
      p.createStars = true;
      p.applyAdjustments = false;
      p.outputId = "Gain";
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;
      p.siiStars = views.siiStars; p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let before = ImageWindow.windows.length;
      let r = buildForaxx( p );
      check( r.factors.length == 0 && ImageWindow.windows.length == before + 2, "H: factor images skipped when disabled" );
      let gained = ( x, y ) =>
      {
         let S = Math.min( 1, 0.8*src.sii( x, y ) ), Ha = src.ha( x, y ), O = Math.min( 1, 1.5*src.oiii( x, y ) );
         return { S, Ha, O, o: F.o( O ), ho: F.ho( Ha, O ) };
      };
      checkRGB( r.foraxx, "H: Gain (gains applied inside the Foraxx factors)", ( x, y ) =>
      {
         let g = gained( x, y );
         return [ F.clamp( F.blend( g.o, g.S, g.Ha ) ), F.clamp( F.blend( g.ho, g.Ha, g.O ) ), g.O ];
      } );
      checkRGB( r.stars, "H: Gain_stars (stars unscaled, factors from scaled starless)", ( x, y ) =>
      {
         let g = gained( x, y );
         let Hs = src.haStars( x, y ), Os = src.oiiiStars( x, y ), Ss = src.siiStars( x, y );
         return [ F.clamp( F.blend( g.o, Ss, Hs ) ), F.clamp( F.blend( g.ho, Hs, Os ) ), Os ];
      } );
   }

   // ---- Mode I: combined image with the stars screened in --------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.createStars = true;
      p.createCombined = true;
      p.applyAdjustments = true;
      p.outputId = "Comb";
      p.ha = views.ha; p.oiii = views.oiii;
      p.haStars = views.haStars; p.oiiiStars = views.oiiiStars;

      let r = buildForaxx( p );
      check( r.combined != null && r.combined.id == "Comb_combined", "I: combined image id is 'Comb_combined'" );
      let fi = r.foraxx.image, si = r.stars.image;
      checkRGB( r.combined, "I: Comb_combined = ~(~result*~stars)", ( x, y ) =>
         [0, 1, 2].map( c => 1 - (1 - fi.sample( x, y, c ))*(1 - si.sample( x, y, c )) ) );

      // Without stars there is no combined image even if requested.
      p.createStars = false;
      let r2 = buildForaxx( p );
      check( r2.combined == null && r2.foraxx.id == "Comb01", "I: no combined image without a stars image" );
   }

   // ---- Settings round trip -------------------------------------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.palette = "HOO";
      p.siiGain = 0.75; p.haGain = 1.25; p.oiiiGain = 2.0;
      p.outputId = "Saved_Id";
      p.createStars = false;
      p.createCombined = true;
      p.createFactorImages = false;
      p.applyAdjustments = false;
      p.save();

      let q = new ForaxxParameters;
      q.load();
      check( q.threeChannels === false && q.palette == "HOO" && q.outputId == "Saved_Id", "settings: booleans and strings round trip" );
      check( near( q.siiGain, 0.75 ) && near( q.haGain, 1.25 ) && near( q.oiiiGain, 2.0 ), "settings: gains round trip" );
      check( q.createStars === false && q.createCombined === true && q.createFactorImages === false && q.applyAdjustments === false, "settings: option flags round trip" );

      for ( let key of [ "threeChannels", "palette", "siiGain", "haGain", "oiiiGain", "outputId", "createStars", "createCombined", "createFactorImages", "applyAdjustments" ] )
         Settings.remove( SETTINGS_KEY + "/" + key );
      let d = new ForaxxParameters;
      d.load();
      check( d.threeChannels === true && d.palette == "Foraxx" && d.outputId == "Foraxx", "settings: defaults after removal" );
   }

   // ---- Validation of the new options ---------------------------------

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.ha = views.ha; p.oiii = views.oiii;
      p.createStars = false;

      p.palette = "SHO";
      check( p.validate().indexOf( "needs SII" ) >= 0, "validate: SHO needs three channels" );
      p.palette = "Foraxx";

      p.outputId = "1bad";
      check( p.validate().indexOf( "not a valid image identifier" ) >= 0, "validate: rejects a bad output identifier" );
      p.outputId = "ok_id";

      p.oiiiGain = 0;
      check( p.validate().indexOf( "OIII gain" ) >= 0, "validate: rejects a zero gain" );
      p.oiiiGain = 1;

      check( p.validate() == "", "validate: accepts the corrected selection" );
      check( palettesFor( false ).map( x => x.id ).join() == "Foraxx,HOO", "palettesFor: two-channel palettes are Foraxx and HOO" );
      check( palettesFor( true ).length == 5, "palettesFor: five palettes with three channels" );
   }

   // ---- Preview: the real build on hidden downsampled copies -------------

   {
      // Constant sources make the downsample exact, so the bitmap can be
      // checked against the formula.
      let cval = { sii: 0.30, ha: 0.60, oiii: 0.45, haStars: 0.20, oiiiStars: 0.70 };
      let cviews = {};
      for ( let k in cval )
         cviews[k] = makeImage( "T_const_" + k, () => cval[k] );

      let p = new ForaxxParameters;
      p.applyAdjustments = false;
      p.createStars = true;
      p.createCombined = false;
      p.sii = cviews.sii; p.ha = cviews.ha; p.oiii = cviews.oiii;
      p.siiStars = cviews.sii; p.haStars = cviews.haStars; p.oiiiStars = cviews.oiiiStars;

      let before = ImageWindow.windows.length;
      let r = renderPreview( p, 32 );
      check( ImageWindow.windows.length == before, "preview: no windows left behind (" + before + " before and after)" );
      check( r.bitmap != null && r.width == 32 && r.height == 24 && near( r.scale, 0.5, 1e-6 ), "preview: bitmap 32x24 at 50% from 64x48 sources" );
      let px = r.bitmap.pixel( 16, 12 );
      let R = (px >> 16) & 0xff, G = (px >> 8) & 0xff, B = px & 0xff;
      let o = F.o( cval.oiii ), ho = F.ho( cval.ha, cval.oiii );
      let want = [ F.blend( o, cval.sii, cval.ha ), F.blend( ho, cval.ha, cval.oiii ), cval.oiii ].map( v => Math.round( 255*v ) );
      check( Math.abs( R - want[0] ) <= 2 && Math.abs( G - want[1] ) <= 2 && Math.abs( B - want[2] ) <= 2,
             "preview: pixel matches the formula (" + [R, G, B].join() + " vs " + want.join() + ")" );

      p.applyAdjustments = true; p.createCombined = true; p.protectedSaturation = true; p.lightnessLift = 0.1;
      let before2 = ImageWindow.windows.length;
      let r2 = renderPreview( p, 32 );
      check( r2.bitmap != null && ImageWindow.windows.length == before2, "preview: adjustments, combined and protected saturation render and clean up" );

      p.threeChannels = false; p.createStars = false;
      let r3 = renderPreview( p, 16 );
      check( r3.width == 16 && r3.height == 12 && ImageWindow.windows.length == before2, "preview: two-channel, no stars, 16 px" );

      let q = new ForaxxParameters;
      let threw = false;
      try { renderPreview( q, 32 ); } catch ( e ) { threw = e.message.indexOf( "select an image" ) >= 0; }
      check( threw, "preview: refuses an incomplete selection" );

      for ( let k in cviews )
         cviews[k].window.forceClose();
   }

   // ---- Dialog: construct it and drive its event handlers ---------------

   {
      let p = new ForaxxParameters;
      let d = new ForaxxDialog( p );
      check( d.paletteIds.join() == "Foraxx,SHO,HOO,HSO,OHS" && d.palette_ComboBox.currentItem == 0, "dialog: three-channel palette list, Foraxx selected" );
      check( d.threeChannels_RadioButton.checked && d.sii_Row.viewList.enabled && d.factors_CheckBox.enabled, "dialog: default control state" );

      d.twoChannels_RadioButton.onCheck( true );
      check( p.threeChannels === false && d.paletteIds.join() == "Foraxx,HOO", "dialog: two channels trims the palette list" );
      check( !d.sii_Row.viewList.enabled && !d.sii_Row.starsViewList.enabled && !d.siiGain_Control.enabled, "dialog: two channels disables the SII controls" );

      d.palette_ComboBox.onItemSelected( 1 );
      check( p.palette == "HOO" && p.outputId == "HOO" && d.outputId_Edit.text == "HOO", "dialog: palette change follows into the output identifier" );
      check( !d.factors_CheckBox.enabled, "dialog: factor images disabled for a static palette" );

      d.outputId_Edit.onTextUpdated( " M16_test " );
      d.palette_ComboBox.onItemSelected( 0 );
      check( p.palette == "Foraxx" && p.outputId == "M16_test", "dialog: a custom output identifier is kept on palette change" );

      d.stars_CheckBox.onCheck( false );
      check( p.createStars === false && !d.combined_CheckBox.enabled && !d.ha_Row.starsViewList.enabled && !d.oiii_Row.starsLabel.enabled, "dialog: no stars disables the stars controls" );

      d.haGain_Control.onValueUpdated( 1.5 );
      d.adjustments_CheckBox.onCheck( false );
      d.combined_CheckBox.onCheck( true );
      check( near( p.haGain, 1.5 ) && p.applyAdjustments === false && p.createCombined === true, "dialog: gain and check boxes update the parameters" );

      d.ha_Row.viewList.onViewSelected( views.ha );
      check( p.ha != null && p.ha.id == "T_ha", "dialog: view list selection stores the view" );
      d.ha_Row.viewList.onViewSelected( null );
      check( p.ha === null, "dialog: clearing a view list stores null" );

      d.reset_ToolButton.onClick();
      check( p.threeChannels && p.palette == "Foraxx" && p.outputId == "Foraxx" && p.createStars && near( p.haGain, 1 ), "dialog: reset restores the defaults" );
      check( d.threeChannels_RadioButton.checked && d.outputId_Edit.text == "Foraxx" && d.stars_CheckBox.checked && d.sii_Row.viewList.enabled, "dialog: reset refreshes the controls" );
      check( p.validate().indexOf( "select an image" ) >= 0, "dialog: parameters still validate after reset" );

      d.oBias_Control.onValueUpdated( 0.3 );
      d.ratio_CheckBox.onCheck( true );
      d.protectedSaturation_CheckBox.onCheck( true );
      d.lightnessLift_Control.onValueUpdated( -0.1 );
      check( near( p.oBias, 0.3 ) && p.createRatioMasks === true && p.protectedSaturation === true && near( p.lightnessLift, -0.1 ),
             "dialog: new controls update the parameters" );
      check( d.ratioThreshold_Control.enabled && d.saturationAmount_Control.enabled, "dialog: dependent controls follow their check boxes" );
      d.twoChannels_RadioButton.onCheck( true );
      check( !d.oBias_Control.enabled && d.hoBias_Control.enabled && !d.siiMidtone_Control.enabled, "dialog: two channels disables the o mask and SII shaping" );
      d.palette_ComboBox.onItemSelected( 1 );
      check( !d.masks_GroupBox.enabled, "dialog: static palette disables mask shaping" );
      d.reset_ToolButton.onClick();
      check( near( p.oBias, 0.5 ) && p.createRatioMasks === false && near( d.oBias_Control.value, 0.5 ) && !d.ratio_CheckBox.checked, "dialog: reset clears the new options" );

      // Preview through the dialog: schedule does nothing without inputs;
      // renderPreviewNow reports a message, then a bitmap once images exist.
      check( d.renderPreviewNow() === false && d.preview_Control.bitmap == null && d.preview_Control.message.indexOf( "select an image" ) >= 0,
             "dialog: preview asks for images when the selection is incomplete" );
      d.twoChannels_RadioButton.onCheck( true );
      d.stars_CheckBox.onCheck( false );
      d.ha_Row.viewList.onViewSelected( views.ha );
      d.oiii_Row.viewList.onViewSelected( views.oiii );
      let wins = ImageWindow.windows.length;
      let okPreview = d.renderPreviewNow();
      check( okPreview === true && d.preview_Control.bitmap != null && d.previewStatus_Label.text.indexOf( " at " ) > 0
             && ImageWindow.windows.length == wins, "dialog: preview renders a bitmap and leaves no windows (status: " + d.previewStatus_Label.text
             + "; message: " + d.preview_Control.message + "; windows " + wins + " -> " + ImageWindow.windows.length + ")" );
      // Pop out: a child window that mirrors the preview at a larger size.
      d.popout_CheckBox.onCheck( true );
      check( d.previewWindow != null && d.isPoppedOut() && d.previewSize() == 1024, "dialog: pop out opens the preview window and raises the render size" );
      check( d.previewWindow.control.bitmap != null, "dialog: pop-out window receives the last preview at once" );
      d.previewTimer.stop();
      let wins2 = ImageWindow.windows.length;
      check( d.renderPreviewNow() === true && d.previewWindow.control.bitmap === d.lastPreview.bitmap && d.lastPreview.width <= 1024
             && ImageWindow.windows.length == wins2, "dialog: popped-out render goes to both views (" + d.previewStatus_Label.text + ")" );
      d.previewWindow.onClose();
      check( !d.popout_CheckBox.checked, "dialog: closing the window unchecks pop out" );
      d.popout_CheckBox.onCheck( false );
      check( !d.isPoppedOut() && d.previewSize() == 480, "dialog: pop out off hides the window and restores the size" );
      d.onReturn( 1 );
      check( !d.previewTimer.isRunning && !d.isPoppedOut(), "dialog: closing the dialog stops the timer and the window" );
      d.previewWindow = null;

      d.livePreview_CheckBox.onCheck( false );
      d.schedulePreview();
      check( !d.previewTimer.isRunning, "dialog: live preview off stops scheduling" );
      d.livePreview_CheckBox.onCheck( true );
      check( d.previewTimer.isRunning, "dialog: live preview on schedules a rebuild" );
      d.previewTimer.stop();
      d.reset_ToolButton.onClick();
      d.previewTimer.stop();

      // Loaded settings must show up in the controls.
      let q = new ForaxxParameters;
      q.threeChannels = false; q.palette = "HOO"; q.outputId = "Loaded"; q.oiiiGain = 2.25; q.createFactorImages = false;
      let e = new ForaxxDialog( q );
      check( e.twoChannels_RadioButton.checked && e.palette_ComboBox.currentItem == 1 && e.outputId_Edit.text == "Loaded"
             && near( e.oiiiGain_Control.value, 2.25 ) && !e.factors_CheckBox.checked, "dialog: constructed from loaded parameters" );
   }

   // ---- Mode K: mask bias/contrast and channel midtones -----------------

   const mtf = ( m, x ) => (x <= 0) ? 0 : (x >= 1) ? 1 : ((m - 1)*x)/((2*m - 1)*x - m);
   const shapeF = ( f, bias, c ) => F.clamp( (mtf( bias, f ) - 0.5)*c + 0.5 );

   {
      let p = new ForaxxParameters;
      p.applyAdjustments = false;
      p.createStars = false;
      p.outputId = "Shape";
      p.oBias = 0.3; p.oContrast = 2.0; p.hoBias = 0.6; p.hoContrast = 1.5;
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      let oS = ( x, y ) => shapeF( F.o( src.oiii( x, y ) ), 0.3, 2.0 );
      let hoS = ( x, y ) => shapeF( F.ho( src.ha( x, y ), src.oiii( x, y ) ), 0.6, 1.5 );
      checkGray( r.factors[0], "K: ho factor image after bias/contrast", hoS );
      checkGray( r.factors[1], "K: o factor image after bias/contrast", oS );
      checkRGB( r.foraxx, "K: Shape uses the reshaped factors", ( x, y ) =>
      {
         let Ha = src.ha( x, y ), O = src.oiii( x, y ), S = src.sii( x, y );
         return [ F.clamp( F.blend( oS( x, y ), S, Ha ) ), F.clamp( F.blend( hoS( x, y ), Ha, O ) ), O ];
      } );
   }

   {
      let p = new ForaxxParameters;
      p.threeChannels = false;
      p.applyAdjustments = false;
      p.createStars = false;
      p.createFactorImages = false;
      p.outputId = "Mid";
      p.haMidtone = 0.3; p.oiiiMidtone = 0.7; p.oiiiGain = 1.2;
      p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      checkRGB( r.foraxx, "K: Mid applies gain then midtones per channel", ( x, y ) =>
      {
         let Ha = mtf( 0.3, src.ha( x, y ) ), O = mtf( 0.7, Math.min( 1, 1.2*src.oiii( x, y ) ) );
         return [ Ha, F.clamp( F.blend( F.ho( Ha, O ), Ha, O ) ), O ];
      } );
   }

   // ---- Mode L: channel-ratio masks --------------------------------------

   {
      let p = new ForaxxParameters;
      p.applyAdjustments = false;
      p.createStars = false;
      p.createFactorImages = false;
      p.createRatioMasks = true;
      p.ratioThreshold = 0.2;
      p.outputId = "Ratio";
      p.sii = views.sii; p.ha = views.ha; p.oiii = views.oiii;

      let r = buildForaxx( p );
      check( r.masks.length == 2 && r.masks[0].id == "Ratio_ratio_OIII" && r.masks[1].id == "Ratio_ratio_SII", "L: ratio mask ids" );
      let fade = ( x, y ) => Math.min( 1, (src.ha( x, y ) + src.oiii( x, y ) + src.sii( x, y ))/3/0.2 );
      checkGray( r.masks[0], "L: OIII ratio mask", ( x, y ) => F.clamp( src.oiii( x, y )/(src.oiii( x, y ) + src.ha( x, y ) + 1e-6)*fade( x, y ) ) );
      checkGray( r.masks[1], "L: SII ratio mask", ( x, y ) => F.clamp( src.sii( x, y )/(src.sii( x, y ) + src.ha( x, y ) + 1e-6)*fade( x, y ) ) );

      p.threeChannels = false;
      p.outputId = "Ratio2";
      let r2 = buildForaxx( p );
      check( r2.masks.length == 1 && r2.masks[0].id == "Ratio2_ratio_OIII", "L: two channels give only the OIII ratio mask" );
   }

   // ---- Mode M: protected saturation and the L* lift ---------------------

   {
      let base = () =>
      {
         let p = new ForaxxParameters;
         p.threeChannels = false;
         p.applyAdjustments = false;
         p.createStars = false;
         p.createFactorImages = false;
         p.ha = views.ha; p.oiii = views.oiii;
         return p;
      };
      let raw = base(); raw.outputId = "SatRaw";
      let rawView = buildForaxx( raw ).foraxx;

      let p = base(); p.outputId = "Sat";
      p.protectedSaturation = true; p.saturationAmount = 0.3; p.saturationBackground = 0.2;
      let r = buildForaxx( p );
      check( r.masks.length == 1 && r.masks[0].id == "Sat_satmask", "M: saturation mask image is left open" );
      check( View.viewById( "Sat" ).window.mask.isNull, "M: image mask removed after the boost" );

      // L* as PixelMath computes it for this image's working space.
      let L = createImage( rawView, "SatRaw_L", PixelMath.Gray, "CIEL($T)" );
      let mask = r.masks[0].image, Li = L.image, rawI = rawView.image, satI = r.foraxx.image;
      let sat = ( img, x, y ) => { let a = [0, 1, 2].map( c => img.sample( x, y, c ) ); let mx = Math.max( ...a ), mn = Math.min( ...a ); return (mx - mn)/Math.max( 1e-6, mx ); };
      let okMask = true, okProtected = true, okBoost = true, boosted = 0;
      for ( let y = 0; y < H; y += 3 )
         for ( let x = 0; x < W; x += 4 )
         {
            let l = Li.sample( x, y, 0 ), m = mask.sample( x, y, 0 );
            let want = Math.max( 0, (l - 0.2)/(1 - 0.2) )*(1 - sat( rawI, x, y ));
            if ( Math.abs( m - want ) > 1e-4 ) okMask = false;
            if ( m < 1e-6 )
            {
               for ( let c = 0; c < 3; ++c )
                  if ( !near( rawI.sample( x, y, c ), satI.sample( x, y, c ) ) ) okProtected = false;
            }
            else if ( m > 0.3 )
            {
               ++boosted;
               if ( sat( satI, x, y ) < sat( rawI, x, y ) - 1e-5 ) okBoost = false;
            }
         }
      check( okMask, "M: saturation mask = (L* - bg)/(1 - bg) * (1 - saturation)" );
      check( okProtected, "M: pixels under a black mask are unchanged" );
      check( boosted > 0 && okBoost, "M: saturation does not drop where the mask is open (" + boosted + " samples)" );
      checkInRange( r.foraxx, "M: Sat" );

      let q = base(); q.outputId = "Lift"; q.lightnessLift = 0.15;
      let lifted = buildForaxx( q ).foraxx.image;
      let sumRaw = 0, sumLift = 0;
      for ( let [x, y] of samplePoints )
         for ( let c = 0; c < 3; ++c ) { sumRaw += rawI.sample( x, y, c ); sumLift += lifted.sample( x, y, c ); }
      check( sumLift > sumRaw, "M: L* lift brightens the image" );
      checkInRange( View.viewById( "Lift" ), "M: Lift" );
   }

   // ---- Settings and validation for the new options --------------------

   {
      let p = new ForaxxParameters;
      p.oBias = 0.3; p.hoContrast = 1.75; p.haMidtone = 0.4; p.createRatioMasks = true; p.ratioThreshold = 0.12;
      p.protectedSaturation = true; p.saturationAmount = 0.4; p.lightnessLift = 0.1;
      p.save();
      let q = new ForaxxParameters; q.load();
      check( near( q.oBias, 0.3 ) && near( q.hoContrast, 1.75 ) && near( q.haMidtone, 0.4 ) && q.createRatioMasks === true
             && near( q.ratioThreshold, 0.12 ) && q.protectedSaturation === true && near( q.saturationAmount, 0.4 ) && near( q.lightnessLift, 0.1 ),
             "settings: new options round trip" );
      for ( let [key] of ForaxxParameters.persisted )
         Settings.remove( SETTINGS_KEY + "/" + key );

      let v = new ForaxxParameters; v.threeChannels = false; v.createStars = false; v.ha = views.ha; v.oiii = views.oiii;
      v.oBias = 1.2; check( v.validate().indexOf( "bias" ) >= 0, "validate: rejects a bias outside (0,1)" ); v.oBias = 0.5;
      v.lightnessLift = 0.9; check( v.validate().indexOf( "lightness" ) >= 0, "validate: rejects a lift outside (-0.5,0.5)" ); v.lightnessLift = 0;
      v.hoContrast = 0; check( v.validate().indexOf( "contrast" ) >= 0, "validate: rejects a zero contrast" ); v.hoContrast = 1;
      check( v.validate() == "", "validate: accepts neutral shaping" );
   }

   // ---- Error path: buildForaxx refuses an incomplete selection --------

   {
      let p = new ForaxxParameters;
      p.ha = views.ha;
      let threw = false;
      try { buildForaxx( p ); } catch ( e ) { threw = e.message.indexOf( "select an image" ) >= 0; }
      check( threw, "buildForaxx throws on an incomplete selection" );
   }
}

function closeAllWindows()
{
   for ( let window of ImageWindow.windows )
      window.forceClose();
}

(() =>
{
   console.show();
   try
   {
      run();
   }
   catch ( e )
   {
      ++failures;
      log( "FAIL - uncaught error: " + e.message + "\n" + (e.stack || "") );
   }
   try { closeAllWindows(); } catch ( e ) { log( "warning: closing windows: " + e.message ); }

   log( failures == 0 ? "RESULT: PASS" : "RESULT: FAIL (" + failures + " failed)" );
   File.writeTextFile( RESULT_PATH, report.join( "\n" ) + "\n" );
})();

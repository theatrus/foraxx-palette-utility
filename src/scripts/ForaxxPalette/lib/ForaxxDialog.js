/*
 ****************************************************************************
 * Foraxx Palette Utility
 *
 * lib/ForaxxDialog.js
 *
 * The main dialog. Fills in a ForaxxParameters object (see ForaxxEngine.js).
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
 ****************************************************************************
 */

/*
 * Shows a bitmap scaled to fit, or a message when there is none.
 */
class PreviewControl extends Control
{
   constructor( parent, width, height, fixed = true )
   {
      super( parent );
      this.bitmap = null;
      this.message = "Select the images to see a preview.";
      if ( fixed )
         this.setScaledFixedSize( width, height );
      else
         this.setScaledMinSize( width, height );
      this.onPaint = ( x0, y0, x1, y1 ) =>
      {
         let g = new Graphics( this );
         g.fillRect( 0, 0, this.width, this.height, new Brush( 0xff181818 ) );
         if ( this.bitmap != null && this.bitmap.width > 0 && this.bitmap.height > 0 )
         {
            let s = Math.min( this.width/this.bitmap.width, this.height/this.bitmap.height );
            let w = Math.max( 1, Math.round( this.bitmap.width*s ) );
            let h = Math.max( 1, Math.round( this.bitmap.height*s ) );
            let x = Math.floor( (this.width - w)/2 ), y = Math.floor( (this.height - h)/2 );
            g.drawScaledBitmap( x, y, x + w, y + h, this.bitmap );
         }
         else
         {
            g.pen = new Pen( 0xff9a9a9a );
            g.drawTextRect( 8, 8, this.width - 8, this.height - 8, this.message, TextAlignment.Center | TextAlignment.VertCenter );
         }
         g.end();
      };
   }

   setBitmap( bitmap )
   {
      this.bitmap = bitmap;
      this.repaint();
   }

   showMessage( text )
   {
      this.bitmap = null;
      this.message = text;
      this.repaint();
   }
}

/*
 * A resizable window holding a large preview. It is a child of the main
 * dialog and is shown with show(), never open(): open() is window-modal and
 * would block the main dialog, while a shown child of a modal dialog stays
 * usable beside it. It reports back when the user closes it.
 */
class PreviewWindow extends Dialog
{
   constructor( parent, onClosed )
   {
      super( parent );
      this.windowTitle = TITLE + " preview";
      this.userResizable = true;
      this.control = new PreviewControl( this, 900, 640, false );
      this.status_Label = new Label( this );
      this.status_Label.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;
      this.sizer = new VerticalSizer;
      this.sizer.margin = 6;
      this.sizer.spacing = 4;
      this.sizer.add( this.control, 100 );
      this.sizer.add( this.status_Label );
      this.adjustToContents();
      this.onClose = () =>
      {
         onClosed();
         return true;
      };
   }
}

class ForaxxDialog extends Dialog
{
   constructor( params )
   {
      super();

      this.params = params;
      this.windowTitle = TITLE;
      this.numericControls = [];
      this.checkBoxes = [];
      this.livePreview = true;
      this.previewBusy = false;
      this.previewWindow = null;
      this.poppedOut = false;
      this.lastPreview = null;
      this.previewTimer = new Timer( 0.35, false/*periodic*/ );
      this.previewTimer.onTimeout = () => this.renderPreviewNow();

      // The dialog is closing (Run or Cancel): stop the timer and take the
      // preview window down with it. Event handlers are instance properties
      // in PJSR; a class method would be shadowed by the native accessor.
      this.onReturn = ( retVal ) =>
      {
         this.previewTimer.stop();
         this.poppedOut = false;
         if ( this.previewWindow != null )
            this.previewWindow.hide();
      };

      let labelWidth = this.font.width( "Output identifier:" + "M" );

      // ---- Description -----------------------------------------------------

      this.info_Label = new Label( this );
      this.info_Label.useRichText = true;
      this.info_Label.wordWrapping = true;
      this.info_Label.text =
           "<p><b>" + TITLE + " v" + VERSION + "</b> &mdash; builds a narrowband palette from stretched, "
         + "starless images, plus an optional stars image. The Foraxx palette is The Coldest Nights' dynamic "
         + "combination (thecoldestnights.com; the globe button opens the article); the other palettes are plain "
         + "channel mappings. Hover a control for details. The preview runs the full build on a small copy of "
         + "the images, so it shows exactly what Run will produce.</p>";

      // ---- Options group ---------------------------------------------------

      this.twoChannels_RadioButton = new RadioButton( this );
      this.twoChannels_RadioButton.text = "Two channels (Ha + OIII)";
      this.twoChannels_RadioButton.toolTip = "<p>Select this for dual narrowband OSC data, or if you only collected Ha and OIII.</p>";
      this.twoChannels_RadioButton.onCheck = ( checked ) =>
      {
         if ( checked )
         {
            this.params.threeChannels = false;
            this.updateControls();
         }
      };

      this.threeChannels_RadioButton = new RadioButton( this );
      this.threeChannels_RadioButton.text = "Three channels (SII + Ha + OIII)";
      this.threeChannels_RadioButton.toolTip = "<p>Select this if you collected SII, Ha and OIII data.</p>";
      this.threeChannels_RadioButton.onCheck = ( checked ) =>
      {
         if ( checked )
         {
            this.params.threeChannels = true;
            this.updateControls();
         }
      };

      this.channels_Sizer = new HorizontalSizer;
      this.channels_Sizer.spacing = 16;
      this.channels_Sizer.add( this.twoChannels_RadioButton );
      this.channels_Sizer.add( this.threeChannels_RadioButton );
      this.channels_Sizer.addStretch();

      this.palette_Label = new Label( this );
      this.palette_Label.text = "Palette:";
      this.palette_Label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      this.palette_Label.setFixedWidth( labelWidth );

      this.palette_ComboBox = new ComboBox( this );
      this.palette_ComboBox.toolTip = "<p><b>Foraxx (dynamic)</b>: The Coldest Nights dynamic combination. "
         + "R = o*SII + ~o*Ha, G = ho*Ha + ~ho*OIII, B = OIII, with o = OIII^~OIII and "
         + "ho = (Ha*OIII)^~(Ha*OIII). With two channels R = Ha.</p>"
         + "<p><b>SHO</b>, <b>HOO</b>, <b>HSO</b>, <b>OHS</b>: plain channel mappings in R, G, B order.</p>";
      this.paletteIds = [];
      this.palette_ComboBox.onItemSelected = ( index ) =>
      {
         if ( index < 0 || index >= this.paletteIds.length )
            return;
         let previous = this.params.palette;
         this.params.palette = this.paletteIds[index];
         // Follow the palette name unless the user typed their own identifier.
         if ( this.params.outputId == previous )
         {
            this.params.outputId = this.params.palette;
            this.outputId_Edit.text = this.params.outputId;
         }
         this.updateControls();
      };

      this.palette_Sizer = new HorizontalSizer;
      this.palette_Sizer.spacing = 4;
      this.palette_Sizer.add( this.palette_Label );
      this.palette_Sizer.add( this.palette_ComboBox, 100 );

      this.siiGain_Control = this.createGainControl( "SII gain:", "siiGain", labelWidth );
      this.haGain_Control = this.createGainControl( "Ha gain:", "haGain", labelWidth );
      this.oiiiGain_Control = this.createGainControl( "OIII gain:", "oiiiGain", labelWidth );
      this.siiMidtone_Control = this.createMidtoneControl( "SII midtone:", "siiMidtone", labelWidth );
      this.haMidtone_Control = this.createMidtoneControl( "Ha midtone:", "haMidtone", labelWidth );
      this.oiiiMidtone_Control = this.createMidtoneControl( "OIII midtone:", "oiiiMidtone", labelWidth );

      this.outputId_Label = new Label( this );
      this.outputId_Label.text = "Output identifier:";
      this.outputId_Label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      this.outputId_Label.setFixedWidth( labelWidth );

      this.outputId_Edit = new Edit( this );
      this.outputId_Edit.toolTip = "<p>Identifier of the result image. The stars image gets the suffix _stars and the "
         + "combined image _combined. If the identifier is taken, a numeric suffix is added.</p>";
      this.outputId_Edit.onTextUpdated = ( text ) =>
      {
         this.params.outputId = text.trim();
      };

      this.outputId_Sizer = new HorizontalSizer;
      this.outputId_Sizer.spacing = 4;
      this.outputId_Sizer.add( this.outputId_Label );
      this.outputId_Sizer.add( this.outputId_Edit, 100 );

      this.stars_CheckBox = this.createCheckBox( "Also create a stars image", "createStars",
         "<p>Uncheck this if your images still have their stars, or if you do not want a stars image.</p>",
         () => this.updateControls() );

      this.combined_CheckBox = this.createCheckBox( "Also create a combined image with the stars screened in", "createCombined",
         "<p>Creates a third image, ~(~result*~stars), after the adjustments. "
         + "Handy for a quick look; for the final image you will usually blend the stars yourself.</p>" );

      this.factors_CheckBox = this.createCheckBox( "Create the dynamic factor images (o, ho)", "createFactorImages",
         "<p>Shows the Foraxx factor images as separate grayscale images, after bias and contrast. They are informative only; "
         + "the palette image does not depend on them.</p>" );

      this.adjustments_CheckBox = this.createCheckBox( "Apply the standard curves and saturation adjustments", "applyAdjustments",
         "<p>Applies the Foraxx hue and saturation curves to the palette image, and a hue curve "
         + "to the stars image. Uncheck this to get the raw PixelMath output and do your own adjustments.</p>" );

      // ---- Preview -----------------------------------------------------------

      this.preview_Control = new PreviewControl( this, 400, 250 );
      this.preview_Control.toolTip = "<p>The result, built from copies of the selected images downsampled to 480 pixels, "
         + "with every option applied. Adjustments and the combined image are included; the factor and ratio masks are not.</p>";

      this.livePreview_CheckBox = new CheckBox( this );
      this.livePreview_CheckBox.text = "Live";
      this.livePreview_CheckBox.checked = true;
      this.livePreview_CheckBox.toolTip = "<p>Rebuild the preview a moment after any change. Uncheck on a slow machine and use Refresh.</p>";
      this.livePreview_CheckBox.onCheck = ( checked ) =>
      {
         this.livePreview = checked;
         if ( checked )
            this.schedulePreview();
      };

      this.refreshPreview_Button = new PushButton( this );
      this.refreshPreview_Button.text = "Refresh";
      this.refreshPreview_Button.icon = this.scaledResource( ":/icons/refresh.png" );
      this.refreshPreview_Button.onClick = () => this.renderPreviewNow();

      this.popout_CheckBox = new CheckBox( this );
      this.popout_CheckBox.text = "Pop out";
      this.popout_CheckBox.toolTip = "<p>Show the preview in a separate, resizable window that stays usable beside this dialog. "
         + "While it is open the preview is built at 1024 pixels instead of 480.</p>";
      this.popout_CheckBox.onCheck = ( checked ) => this.setPopout( checked );

      this.previewStatus_Label = new Label( this );
      this.previewStatus_Label.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;
      this.previewStatus_Label.text = "";

      this.previewButtons_Sizer = new HorizontalSizer;
      this.previewButtons_Sizer.spacing = 6;
      this.previewButtons_Sizer.add( this.livePreview_CheckBox );
      this.previewButtons_Sizer.add( this.refreshPreview_Button );
      this.previewButtons_Sizer.add( this.popout_CheckBox );
      this.previewButtons_Sizer.addSpacing( 6 );
      this.previewButtons_Sizer.add( this.previewStatus_Label, 100 );

      this.preview_Sizer = new VerticalSizer;
      this.preview_Sizer.margin = 6;
      this.preview_Sizer.spacing = 4;
      this.preview_Sizer.add( this.preview_Control );
      this.preview_Sizer.add( this.previewButtons_Sizer );

      this.preview_GroupBox = new GroupBox( this );
      this.preview_GroupBox.title = "Preview";
      this.preview_GroupBox.sizer = this.preview_Sizer;

      // ---- Mask shaping group ----------------------------------------------

      this.oBias_Control = this.createNumericControl( "o bias:", "oBias", labelWidth, 0.05, 0.95, 3,
         "<p>Midtones balance of the o = OIII^~OIII factor, which decides where SII replaces Ha in red. "
         + "0.5 is neutral. Lower values brighten the mask, so SII wins over more of the image; higher values favour Ha.</p>" );
      this.oContrast_Control = this.createNumericControl( "o contrast:", "oContrast", labelWidth, 0.25, 4.0, 2,
         "<p>Steepens the o factor around 0.5, sharpening the transition between SII and Ha in red. 1 is neutral.</p>" );
      this.hoBias_Control = this.createNumericControl( "ho bias:", "hoBias", labelWidth, 0.05, 0.95, 3,
         "<p>Midtones balance of the ho = (Ha*OIII)^~(Ha*OIII) factor, which decides where Ha replaces OIII in green. "
         + "0.5 is neutral. Lower values brighten the mask, so Ha wins over more of the image; higher values favour OIII.</p>" );
      this.hoContrast_Control = this.createNumericControl( "ho contrast:", "hoContrast", labelWidth, 0.25, 4.0, 2,
         "<p>Steepens the ho factor around 0.5, sharpening the transition between Ha and OIII in green. 1 is neutral.</p>" );

      this.masks_Sizer = new VerticalSizer;
      this.masks_Sizer.margin = 6;
      this.masks_Sizer.spacing = 4;
      this.masks_Sizer.add( this.oBias_Control );
      this.masks_Sizer.add( this.oContrast_Control );
      this.masks_Sizer.add( this.hoBias_Control );
      this.masks_Sizer.add( this.hoContrast_Control );

      this.masks_GroupBox = new GroupBox( this );
      this.masks_GroupBox.title = "Foraxx Mask Shaping";
      this.masks_GroupBox.sizer = this.masks_Sizer;

      // ---- Extras group ----------------------------------------------------

      this.ratio_CheckBox = this.createCheckBox( "Create channel-ratio masks (OIII and SII relative strength)", "createRatioMasks",
         "<p>Creates OIII/(Ha+OIII) and, with three channels, SII/(Ha+SII) as grayscale images named "
         + "&lt;result&gt;_ratio_OIII and _ratio_SII, for use as masks on your own adjustments. "
         + "They select oxygen- or sulfur-rich structure regardless of brightness, and fade out below the threshold.</p>",
         () => this.updateControls() );
      this.ratioThreshold_Control = this.createNumericControl( "Ratio threshold:", "ratioThreshold", labelWidth, 0.0, 0.5, 3,
         "<p>Mean signal below which the ratio masks fade to black, so faint, unstable ratios do not select the background.</p>" );

      this.protectedSaturation_CheckBox = this.createCheckBox( "Protected saturation boost", "protectedSaturation",
         "<p>Boosts colour saturation through a generated mask that excludes the dark background and pixels that "
         + "are already saturated. The mask is left open as &lt;result&gt;_satmask.</p>",
         () => this.updateControls() );
      this.saturationAmount_Control = this.createNumericControl( "Saturation:", "saturationAmount", labelWidth, 0.0, 1.0, 2,
         "<p>Saturation increase, as ColorSaturation understands it: 0.25 raises saturation by about a quarter where the mask is white.</p>" );
      this.saturationBackground_Control = this.createNumericControl( "Background L*:", "saturationBackground", labelWidth, 0.0, 0.5, 3,
         "<p>CIE L* lightness below which pixels are protected from the saturation boost.</p>" );

      this.lightnessLift_Control = this.createNumericControl( "L* lift:", "lightnessLift", labelWidth, -0.3, 0.3, 3,
         "<p>Colour-preserving brightness: a curve on the CIE L* channel only, through (0.5, 0.5 + lift). "
         + "0 is neutral. Chroma and hue are left alone, so colours keep their relationships as the image brightens.</p>" );

      this.extras_Sizer = new VerticalSizer;
      this.extras_Sizer.margin = 6;
      this.extras_Sizer.spacing = 4;
      this.extras_Sizer.add( this.ratio_CheckBox );
      this.extras_Sizer.add( this.ratioThreshold_Control );
      this.extras_Sizer.add( this.protectedSaturation_CheckBox );
      this.extras_Sizer.add( this.saturationAmount_Control );
      this.extras_Sizer.add( this.saturationBackground_Control );
      this.extras_Sizer.add( this.lightnessLift_Control );

      this.extras_GroupBox = new GroupBox( this );
      this.extras_GroupBox.title = "Masks and Colour";
      this.extras_GroupBox.sizer = this.extras_Sizer;

      this.options_Sizer = new VerticalSizer;
      this.options_Sizer.margin = 6;
      this.options_Sizer.spacing = 4;
      this.options_Sizer.add( this.channels_Sizer );
      this.options_Sizer.add( this.palette_Sizer );
      this.options_Sizer.add( this.siiGain_Control );
      this.options_Sizer.add( this.haGain_Control );
      this.options_Sizer.add( this.oiiiGain_Control );
      this.options_Sizer.add( this.siiMidtone_Control );
      this.options_Sizer.add( this.haMidtone_Control );
      this.options_Sizer.add( this.oiiiMidtone_Control );
      this.options_Sizer.add( this.outputId_Sizer );
      this.options_Sizer.add( this.stars_CheckBox );
      this.options_Sizer.add( this.combined_CheckBox );
      this.options_Sizer.add( this.factors_CheckBox );
      this.options_Sizer.add( this.adjustments_CheckBox );

      this.options_GroupBox = new GroupBox( this );
      this.options_GroupBox.title = "Options";
      this.options_GroupBox.sizer = this.options_Sizer;

      // ---- Channel selection group ----------------------------------------

      let viewLabelWidth = this.font.width( "OIII stars:" + "M" );
      this.sii_Row = this.createChannelRow( "SII", "sii", viewLabelWidth );
      this.ha_Row = this.createChannelRow( "Ha", "ha", viewLabelWidth );
      this.oiii_Row = this.createChannelRow( "OIII", "oiii", viewLabelWidth );

      this.views_Sizer = new VerticalSizer;
      this.views_Sizer.margin = 6;
      this.views_Sizer.spacing = 4;
      this.views_Sizer.add( this.sii_Row.sizer );
      this.views_Sizer.add( this.ha_Row.sizer );
      this.views_Sizer.add( this.oiii_Row.sizer );

      this.views_GroupBox = new GroupBox( this );
      this.views_GroupBox.title = "Channel Selection (starless image, stars image)";
      this.views_GroupBox.sizer = this.views_Sizer;

      // ---- Buttons ---------------------------------------------------------

      this.website_ToolButton = new ToolButton( this );
      this.website_ToolButton.icon = this.scaledResource( ":/icons/internet.png" );
      this.website_ToolButton.setScaledFixedSize( 24, 24 );
      this.website_ToolButton.toolTip = "<p>Open the Coldest Nights article on dynamic narrowband combinations with PixelMath.</p>";
      this.website_ToolButton.onClick = () =>
      {
         Dialog.openBrowser( WEBSITE );
      };

      this.reset_ToolButton = new ToolButton( this );
      this.reset_ToolButton.icon = this.scaledResource( ":/process-interface/reset.png" );
      this.reset_ToolButton.setScaledFixedSize( 24, 24 );
      this.reset_ToolButton.toolTip = "<p>Reset all options to their defaults. Selected images are kept.</p>";
      this.reset_ToolButton.onClick = () =>
      {
         this.params.reset();
         this.loadFromParameters();
      };

      this.version_Label = new Label( this );
      this.version_Label.text = "Version " + VERSION;
      this.version_Label.textAlignment = TextAlignment.Left | TextAlignment.VertCenter;

      this.run_Button = new PushButton( this );
      this.run_Button.text = "Run";
      this.run_Button.icon = this.scaledResource( ":/icons/ok.png" );
      this.run_Button.defaultButton = true;
      this.run_Button.onClick = () =>
      {
         this.tryAccept();
      };

      this.cancel_Button = new PushButton( this );
      this.cancel_Button.text = "Cancel";
      this.cancel_Button.icon = this.scaledResource( ":/icons/cancel.png" );
      this.cancel_Button.onClick = () =>
      {
         this.cancel();
      };

      this.buttons_Sizer = new HorizontalSizer;
      this.buttons_Sizer.spacing = 6;
      this.buttons_Sizer.add( this.website_ToolButton );
      this.buttons_Sizer.add( this.reset_ToolButton );
      this.buttons_Sizer.addSpacing( 4 );
      this.buttons_Sizer.add( this.version_Label );
      this.buttons_Sizer.addStretch();
      this.buttons_Sizer.add( this.run_Button );
      this.buttons_Sizer.add( this.cancel_Button );

      // ---- Layout ----------------------------------------------------------

      this.left_Sizer = new VerticalSizer;
      this.left_Sizer.spacing = 8;
      this.left_Sizer.add( this.options_GroupBox );
      this.left_Sizer.addStretch();

      this.right_Sizer = new VerticalSizer;
      this.right_Sizer.spacing = 8;
      this.right_Sizer.add( this.preview_GroupBox );
      this.right_Sizer.add( this.masks_GroupBox );
      this.right_Sizer.add( this.extras_GroupBox );
      this.right_Sizer.addStretch();

      this.columns_Sizer = new HorizontalSizer;
      this.columns_Sizer.spacing = 8;
      this.columns_Sizer.add( this.left_Sizer, 50 );
      this.columns_Sizer.add( this.right_Sizer, 50 );

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 8;
      this.sizer.add( this.info_Label );
      this.sizer.add( this.views_GroupBox );
      this.sizer.add( this.columns_Sizer );
      this.sizer.add( this.buttons_Sizer );

      this.userResizable = true;
      this.setScaledMinWidth( 980 );

      this.loadFromParameters();

      this.adjustToContents();
      this.setFixedHeight();
   }

   /*
    * A numeric control bound to a ForaxxParameters property.
    */
   createNumericControl( text, key, labelWidth, lower, upper, precision, toolTip )
   {
      let control = new NumericControl( this );
      control.label.text = text;
      control.label.setFixedWidth( labelWidth );
      control.setRange( lower, upper );
      control.slider.setRange( 0, Math.round( (upper - lower)*Math.pow( 10, precision ) ) );
      control.slider.setScaledMinWidth( 160 );
      control.setPrecision( precision );
      control.toolTip = toolTip;
      control.onValueUpdated = ( value ) =>
      {
         this.params[key] = value;
         this.schedulePreview();
      };
      this.numericControls.push( [ control, key ] );
      return control;
   }

   /*
    * A check box bound to a boolean ForaxxParameters property.
    */
   createCheckBox( text, key, toolTip, onChange = null )
   {
      let box = new CheckBox( this );
      box.text = text;
      box.toolTip = toolTip;
      box.onCheck = ( checked ) =>
      {
         this.params[key] = checked;
         if ( onChange )
            onChange();
         this.schedulePreview();
      };
      this.checkBoxes.push( [ box, key ] );
      return box;
   }

   /*
    * A gain control for one channel. key is the ForaxxParameters property.
    */
   createGainControl( text, key, labelWidth )
   {
      return this.createNumericControl( text, key, labelWidth, 0.1, 3.0, 2,
         "<p>Multiplies the starless " + text.replace( " gain:", "" )
         + " image before combination (clipped at 1). Values above 1 push that channel forward in the palette; "
         + "with the Foraxx palette this also shifts the dynamic factors. Star images are not scaled.</p>" );
   }

   /*
    * A midtone control for one channel: a midtones transfer after the gain.
    */
   createMidtoneControl( text, key, labelWidth )
   {
      return this.createNumericControl( text, key, labelWidth, 0.05, 0.95, 3,
         "<p>Midtones balance applied to the starless " + text.replace( " midtone:", "" )
         + " image after the gain. 0.5 is neutral; lower values lift faint signal without pushing "
         + "highlights into clipping, higher values darken it.</p>" );
   }

   /*
    * Builds one row: a starless view list and a stars view list for a
    * channel. key is the ForaxxParameters property for the starless view;
    * key + "Stars" holds the stars view.
    */
   createChannelRow( name, key, labelWidth )
   {
      let row = {};

      row.label = new Label( this );
      row.label.text = name + ":";
      row.label.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      row.label.setFixedWidth( labelWidth );

      row.viewList = new ViewList( this );
      row.viewList.getMainViews();
      row.viewList.toolTip = "<p>Stretched, starless " + name + " image.</p>";
      row.viewList.onViewSelected = ( view ) =>
      {
         this.params[key] = isValidView( view ) ? view : null;
         this.schedulePreview();
      };

      row.starsLabel = new Label( this );
      row.starsLabel.text = name + " stars:";
      row.starsLabel.textAlignment = TextAlignment.Right | TextAlignment.VertCenter;
      row.starsLabel.setFixedWidth( labelWidth );

      row.starsViewList = new ViewList( this );
      row.starsViewList.getMainViews();
      row.starsViewList.toolTip = "<p>Stretched " + name + " stars image.</p>";
      row.starsViewList.onViewSelected = ( view ) =>
      {
         this.params[key + "Stars"] = isValidView( view ) ? view : null;
         this.schedulePreview();
      };

      row.sizer = new HorizontalSizer;
      row.sizer.spacing = 4;
      row.sizer.add( row.label );
      row.sizer.add( row.viewList, 100 );
      row.sizer.addSpacing( 12 );
      row.sizer.add( row.starsLabel );
      row.sizer.add( row.starsViewList, 100 );

      return row;
   }

   /*
    * Fills the palette list with the palettes available for the current
    * number of channels and selects the current one.
    */
   updatePaletteList()
   {
      let palettes = palettesFor( this.params.threeChannels );
      if ( paletteById( this.params.palette ) == null || !palettes.some( p => p.id == this.params.palette ) )
         this.params.palette = "Foraxx";
      this.paletteIds = palettes.map( p => p.id );
      this.palette_ComboBox.clear();
      for ( let p of palettes )
         this.palette_ComboBox.addItem( p.name );
      this.palette_ComboBox.currentItem = this.paletteIds.indexOf( this.params.palette );
   }

   /*
    * Copies every option from the parameters into the controls.
    */
   loadFromParameters()
   {
      let p = this.params;
      this.twoChannels_RadioButton.checked = !p.threeChannels;
      this.threeChannels_RadioButton.checked = p.threeChannels;
      this.outputId_Edit.text = p.outputId;
      for ( let [control, key] of this.numericControls )
         control.setValue( p[key] );
      for ( let [box, key] of this.checkBoxes )
         box.checked = p[key];
      this.updateControls();
   }

   /*
    * Enables the controls the current options need.
    */
   updateControls()
   {
      this.updatePaletteList();
      this.schedulePreview();

      let three = this.params.threeChannels;
      let stars = this.params.createStars;
      let dynamic = paletteById( this.params.palette ).dynamic == true;

      this.siiGain_Control.enabled = three;
      this.siiMidtone_Control.enabled = three;
      this.combined_CheckBox.enabled = stars;
      this.factors_CheckBox.enabled = dynamic;
      this.masks_GroupBox.enabled = dynamic;
      this.oBias_Control.enabled = dynamic && three;
      this.oContrast_Control.enabled = dynamic && three;
      this.ratioThreshold_Control.enabled = this.params.createRatioMasks;
      this.saturationAmount_Control.enabled = this.params.protectedSaturation;
      this.saturationBackground_Control.enabled = this.params.protectedSaturation;

      this.sii_Row.label.enabled = three;
      this.sii_Row.viewList.enabled = three;
      this.sii_Row.starsLabel.enabled = three && stars;
      this.sii_Row.starsViewList.enabled = three && stars;

      this.ha_Row.starsLabel.enabled = stars;
      this.ha_Row.starsViewList.enabled = stars;
      this.oiii_Row.starsLabel.enabled = stars;
      this.oiii_Row.starsViewList.enabled = stars;
   }

   /*
    * Opens or hides the separate preview window.
    */
   setPopout( on )
   {
      if ( on )
      {
         if ( this.previewWindow == null )
            this.previewWindow = new PreviewWindow( this, () =>
            {
               // Closed by the user: reflect it without re-entering here.
               this.poppedOut = false;
               this.popout_CheckBox.checked = false;
            } );
         this.poppedOut = true;
         this.previewWindow.show();
         this.previewWindow.bringToFront();
         if ( this.lastPreview != null )
         {
            this.previewWindow.control.setBitmap( this.lastPreview.bitmap );
            this.previewWindow.status_Label.text = this.previewStatus_Label.text;
         }
         this.schedulePreview();
      }
      else
      {
         this.poppedOut = false;
         if ( this.previewWindow != null )
            this.previewWindow.hide();
      }
   }

   /*
    * True while the separate preview window is showing.
    */
   isPoppedOut()
   {
      return this.poppedOut && this.previewWindow != null;
   }

   /*
    * Longest side of the preview render: larger when popped out.
    */
   previewSize()
   {
      return this.isPoppedOut() ? 1024 : 480;
   }

   /*
    * Rebuilds the preview shortly, coalescing bursts of slider updates.
    */
   schedulePreview()
   {
      if ( !this.livePreview || this.preview_Control === undefined )
         return;
      this.previewTimer.stop();
      this.previewTimer.start();
   }

   /*
    * Rebuilds the preview now. Returns true if a bitmap was produced.
    */
   renderPreviewNow()
   {
      this.previewTimer.stop();
      if ( this.previewBusy )
         return false;
      let error = this.params.validate();
      if ( error )
      {
         this.preview_Control.showMessage( error );
         this.previewStatus_Label.text = "";
         return false;
      }
      this.previewBusy = true;
      try
      {
         let t = new ElapsedTime;
         let r = renderPreview( this.params, this.previewSize() );
         this.lastPreview = r;
         this.preview_Control.setBitmap( r.bitmap );
         this.previewStatus_Label.text = format( "%dx%d at %.0f%%, %.2f s", r.width, r.height, 100*r.scale, t.value );
         if ( this.isPoppedOut() )
         {
            this.previewWindow.control.setBitmap( r.bitmap );
            this.previewWindow.status_Label.text = this.previewStatus_Label.text;
         }
         return true;
      }
      catch ( e )
      {
         this.preview_Control.showMessage( "Preview failed: " + e.message );
         this.previewStatus_Label.text = "";
         return false;
      }
      finally
      {
         this.previewBusy = false;
      }
   }

   /*
    * Closes the dialog with an OK result if the selection is complete,
    * otherwise tells the user what is missing.
    */
   tryAccept()
   {
      let error = this.params.validate();
      if ( error )
      {
         (new MessageBox( error, TITLE, StdIcon.Warning, StdButton.Ok )).execute();
         return;
      }
      this.ok();
   }
}

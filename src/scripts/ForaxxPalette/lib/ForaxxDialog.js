/*
 ****************************************************************************
 * Foraxx Palette Utility
 *
 * lib/ForaxxDialog.js
 *
 * The main dialog. Fills in a ForaxxParameters object (see ForaxxEngine.js).
 *
 * Copyright (C) 2023-2024 Paul Hancock, Paulyman Astro (original script,
 * published at https://foraxxpaletteutility.com/)
 * Ported to the PixInsight 1.9.4 V8 JavaScript runtime, 2026.
 ****************************************************************************
 */

class ForaxxDialog extends Dialog
{
   constructor( params )
   {
      super();

      this.params = params;
      this.windowTitle = TITLE;

      let labelWidth = this.font.width( "Output identifier:" + "M" );

      // ---- Description -----------------------------------------------------

      this.info_Label = new Label( this );
      this.info_Label.useRichText = true;
      this.info_Label.wordWrapping = true;
      this.info_Label.text =
           "<p><b>" + TITLE + " v" + VERSION + "</b></p>"
         + "<p>Builds a narrowband palette image from stretched, starless images, "
         + "plus an optional colour stars image from the matching stretched star "
         + "images. The Foraxx palette blends SII, Ha and OIII with dynamic PixelMath "
         + "factors; the other palettes are plain channel mappings.</p>"
         + "<p>Choose two channels for Ha + OIII data (mono, or OSC with a dual "
         + "narrowband filter) or three channels for SII + Ha + OIII, pick a palette, "
         + "then select the starless image for each channel and, if you want a stars "
         + "image, the matching stars image. Channel gains scale the starless images "
         + "before combination.</p>"
         + "<p>Original script by Paul Hancock, Paulyman Astro. Copyright &copy; 2023-2024 Paul Hancock. All Rights Reserved.</p>";

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

      this.stars_CheckBox = new CheckBox( this );
      this.stars_CheckBox.text = "Also create a stars image";
      this.stars_CheckBox.toolTip = "<p>Uncheck this if your images still have their stars, or if you do not want a stars image.</p>";
      this.stars_CheckBox.onCheck = ( checked ) =>
      {
         this.params.createStars = checked;
         this.updateControls();
      };

      this.combined_CheckBox = new CheckBox( this );
      this.combined_CheckBox.text = "Also create a combined image with the stars screened in";
      this.combined_CheckBox.toolTip = "<p>Creates a third image, ~(~result*~stars), after the adjustments. "
         + "Handy for a quick look; for the final image you will usually blend the stars yourself.</p>";
      this.combined_CheckBox.onCheck = ( checked ) =>
      {
         this.params.createCombined = checked;
      };

      this.factors_CheckBox = new CheckBox( this );
      this.factors_CheckBox.text = "Create the dynamic factor images (o, ho)";
      this.factors_CheckBox.toolTip = "<p>Shows the Foraxx factor images as separate grayscale images. They are informative only; "
         + "the palette image does not depend on them.</p>";
      this.factors_CheckBox.onCheck = ( checked ) =>
      {
         this.params.createFactorImages = checked;
      };

      this.adjustments_CheckBox = new CheckBox( this );
      this.adjustments_CheckBox.text = "Apply the standard curves and saturation adjustments";
      this.adjustments_CheckBox.toolTip = "<p>Applies the Foraxx curves and selective saturation boost to the palette image, and a curve "
         + "to the stars image. Uncheck this to get the raw PixelMath output and do your own adjustments.</p>";
      this.adjustments_CheckBox.onCheck = ( checked ) =>
      {
         this.params.applyAdjustments = checked;
      };

      this.options_Sizer = new VerticalSizer;
      this.options_Sizer.margin = 6;
      this.options_Sizer.spacing = 4;
      this.options_Sizer.add( this.channels_Sizer );
      this.options_Sizer.add( this.palette_Sizer );
      this.options_Sizer.add( this.siiGain_Control );
      this.options_Sizer.add( this.haGain_Control );
      this.options_Sizer.add( this.oiiiGain_Control );
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

      this.sizer = new VerticalSizer;
      this.sizer.margin = 8;
      this.sizer.spacing = 8;
      this.sizer.add( this.info_Label );
      this.sizer.add( this.options_GroupBox );
      this.sizer.add( this.views_GroupBox );
      this.sizer.add( this.buttons_Sizer );

      this.userResizable = true;
      this.setScaledMinWidth( 760 );

      this.loadFromParameters();

      this.adjustToContents();
      this.setFixedHeight();
   }

   /*
    * A gain control for one channel. key is the ForaxxParameters property.
    */
   createGainControl( text, key, labelWidth )
   {
      let control = new NumericControl( this );
      control.label.text = text;
      control.label.setFixedWidth( labelWidth );
      control.setRange( 0.1, 3.0 );
      control.slider.setRange( 0, 290 );
      control.slider.setScaledMinWidth( 200 );
      control.setPrecision( 2 );
      control.toolTip = "<p>Multiplies the starless " + text.replace( " gain:", "" )
         + " image before combination (clipped at 1). Values above 1 push that channel forward in the palette; "
         + "with the Foraxx palette this also shifts the dynamic factors. Star images are not scaled.</p>";
      control.onValueUpdated = ( value ) =>
      {
         this.params[key] = value;
      };
      return control;
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
      this.siiGain_Control.setValue( p.siiGain );
      this.haGain_Control.setValue( p.haGain );
      this.oiiiGain_Control.setValue( p.oiiiGain );
      this.outputId_Edit.text = p.outputId;
      this.stars_CheckBox.checked = p.createStars;
      this.combined_CheckBox.checked = p.createCombined;
      this.factors_CheckBox.checked = p.createFactorImages;
      this.adjustments_CheckBox.checked = p.applyAdjustments;
      this.updateControls();
   }

   /*
    * Enables the controls the current options need.
    */
   updateControls()
   {
      this.updatePaletteList();

      let three = this.params.threeChannels;
      let stars = this.params.createStars;
      let dynamic = paletteById( this.params.palette ).dynamic == true;

      this.siiGain_Control.enabled = three;
      this.combined_CheckBox.enabled = stars;
      this.factors_CheckBox.enabled = dynamic;

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

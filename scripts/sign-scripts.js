#engine v8

/*
 * Signs PixInsight script files with a secure keys file (.xssk), writing a
 * .xsgn signature next to each. Run headlessly by build.sh, which fills in
 * the placeholders below; do not run this file as is.
 *
 * Copyright 2026 Yann Ramin. Apache License 2.0.
 */

CoreApplication.ensureMinimumVersion( 1, 9, 4 );

(() =>
{
   const keysFile = "@XSSK_PATH@";
   const passwordFile = "@XSSK_PASSWORD_FILE@";
   const files = @FILES_JSON@;
   const resultPath = "@RESULT_PATH@";
   let report = [];
   try
   {
      let password = File.readTextFile( passwordFile ).trim();
      let keys = Security.loadSigningKeysFile( keysFile, password );
      if ( !keys.valid )
         throw new Error( "invalid signing keys file: " + keysFile );
      for ( let path of files )
      {
         let ext = File.extractExtension( path );
         let signaturePath = File.changeExtension( path, ".xsgn" );
         if ( ext == ".js" || ext == ".scp" )
            Security.generateScriptSignatureFile( signaturePath, path, [], keys.developerId, keys.publicKey, keys.privateKey );
         else if ( ext == ".jsh" )
            Security.generateCodeSignatureFile( signaturePath, path, keys.developerId, keys.publicKey, keys.privateKey );
         else
            throw new Error( "not a script file: " + path );
         report.push( "signed " + path + " as " + keys.developerId );
      }
      keys.privateKey.secureFill();
      report.push( "RESULT: OK " + files.length );
   }
   catch ( e )
   {
      report.push( "RESULT: ERROR " + ((e && e.message) ? e.message : String( e )) );
   }
   File.writeTextFile( resultPath, report.join( "\n" ) + "\n" );
})();

"use strict"; function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _chunkXLQZPV67js = require('./chunk-XLQZPV67.js');
require('./chunk-WAK5WW37.js');

// src/cli.ts
var _fs = require('fs'); var _fs2 = _interopRequireDefault(_fs);
(async () => {
  const argv = process.argv.slice(2);
  const args = Object.assign(
    {},
    ...process.argv.slice(2).map((e, index) => {
      if (argv[index + 1]) {
        return { [e]: argv[index + 1] };
      }
      return void 0;
    }).filter((arg) => arg)
  );
  if (process.argv.slice(2).some((arg) => arg.includes("help")) || process.argv.slice(2).some((arg) => arg.includes("-h")) || process.argv.slice(2).length === 0) {
    return console.log(
      "USE: npx compress-pdf\n--file [PDF_FILE]\n--output [COMPRESSED_PDF_FILE]\n--resolution [ebook/printer/screen/prepress]\n--compatibilityLevel [NUMBER] The compatibility pdf level\n--gsModule [FILE PATH] The ghostscript binary path\n--pdfPassword The pdf password\n--removePasswordAfterCompression [BOOLEAN] Remove pdf password after compression\nEx: /usr/local/bin/gs"
    );
  }
  if (!args["--file"] || !args["--output"]) {
    return console.log(
      "USE: npx compress-pdf --file [PDF_FILE] --output [COMPRESSED_PDF_FILE]"
    );
  }
  const buffer = await _chunkXLQZPV67js.compress_default.call(void 0, args["--file"], {
    resolution: args["--resolution"] ? args["--resolution"] : void 0,
    compatibilityLevel: args["--compatibilityLevel"] ? Number(args["--compatibilityLevel"]) : void 0,
    gsModule: args["--gsModule"],
    pdfPassword: args["--pdfPassword"],
    removePasswordAfterCompression: args["--removePasswordAfterCompression"]
  });
  return _fs2.default.writeFileSync(args["--output"], buffer);
})();

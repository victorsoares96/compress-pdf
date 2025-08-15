"use strict";Object.defineProperty(exports, "__esModule", {value: true}); function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var _chunkWAK5WW37js = require('./chunk-WAK5WW37.js');

// src/compress.ts
var _path = require('path'); var _path2 = _interopRequireDefault(_path);
var _util = require('util'); var _util2 = _interopRequireDefault(_util);
var _fs = require('fs'); var _fs2 = _interopRequireDefault(_fs);
var _os = require('os'); var _os2 = _interopRequireDefault(_os);
var _child_process = require('child_process'); var _child_process2 = _interopRequireDefault(_child_process);
var _defaults = require('lodash/defaults'); var _defaults2 = _interopRequireDefault(_defaults);
var _crypto = require('crypto');
var exec = _util2.default.promisify(_child_process2.default.exec);
var defaultOptions = {
  compatibilityLevel: 1.4,
  resolution: "ebook",
  imageQuality: 100,
  gsModule: _chunkWAK5WW37js.get_bin_path_default.call(void 0, _os2.default.platform()),
  pdfPassword: "",
  removePasswordAfterCompression: false
};
async function compress(file, options) {
  const {
    resolution,
    imageQuality,
    compatibilityLevel,
    gsModule,
    pdfPassword,
    removePasswordAfterCompression
  } = _defaults2.default.call(void 0, options, defaultOptions);
  const output = _path2.default.resolve(_os2.default.tmpdir(), _crypto.randomUUID.call(void 0, ));
  let command;
  let tempFile;
  if (typeof file === "string") {
    command = `${gsModule} -q -dNOPAUSE -dBATCH -dSAFER -dSimulateOverprint=true -sDEVICE=pdfwrite -dCompatibilityLevel=${compatibilityLevel} -dPDFSETTINGS=/${resolution} -dEmbedAllFonts=true -dSubsetFonts=true -dAutoRotatePages=/None -dColorImageDownsampleType=/Bicubic -dColorImageResolution=${imageQuality} -dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=${imageQuality} -dMonoImageDownsampleType=/Bicubic -dMonoImageResolution=${imageQuality} -sOutputFile=${output}`;
    if (pdfPassword) {
      command = command.concat(` -sPDFPassword=${pdfPassword}`);
    }
    if (!removePasswordAfterCompression) {
      command = command.concat(
        ` -sOwnerPassword=${pdfPassword} -sUserPassword=${pdfPassword}`
      );
    }
    command = command.concat(` '${file.replace(/'/g, "'\\''")}'`);
  } else {
    tempFile = _path2.default.resolve(_os2.default.tmpdir(), _crypto.randomUUID.call(void 0, ));
    await _fs2.default.promises.writeFile(tempFile, file);
    command = `${gsModule} -q -dNOPAUSE -dBATCH -dSAFER -dSimulateOverprint=true -sDEVICE=pdfwrite -dCompatibilityLevel=${compatibilityLevel} -dPDFSETTINGS=/${resolution} -dEmbedAllFonts=true -dSubsetFonts=true -dAutoRotatePages=/None -dColorImageDownsampleType=/Bicubic -dColorImageResolution=${imageQuality} -dGrayImageDownsampleType=/Bicubic -dGrayImageResolution=${imageQuality} -dMonoImageDownsampleType=/Bicubic -dMonoImageResolution=${imageQuality} -sOutputFile=${output}`;
    if (pdfPassword) {
      command = command.concat(` -sPDFPassword=${pdfPassword}`);
    }
    if (!removePasswordAfterCompression) {
      command = command.concat(
        ` -sOwnerPassword=${pdfPassword} -sUserPassword=${pdfPassword}`
      );
    }
    command = command.concat(` ${tempFile}`);
  }
  await exec(command);
  if (tempFile) await _fs2.default.unlinkSync(tempFile);
  const readFile = await _fs2.default.promises.readFile(output);
  await _fs2.default.unlinkSync(output);
  return readFile;
}
var compress_default = compress;



exports.compress_default = compress_default;

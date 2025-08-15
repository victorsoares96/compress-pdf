import {
  get_bin_path_default
} from "./chunk-E5ODYKYQ.mjs";

// src/compress.ts
import path from "path";
import util from "util";
import fs from "fs";
import os from "os";
import childProcess from "child_process";
import defaults from "lodash/defaults";
import { randomUUID } from "crypto";
var exec = util.promisify(childProcess.exec);
var defaultOptions = {
  compatibilityLevel: 1.4,
  resolution: "ebook",
  imageQuality: 100,
  gsModule: get_bin_path_default(os.platform()),
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
  } = defaults(options, defaultOptions);
  const output = path.resolve(os.tmpdir(), randomUUID());
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
    command = command.concat(`'${file.replace(/'/g, "'\\''")}'`);
  } else {
    tempFile = path.resolve(os.tmpdir(), randomUUID());
    await fs.promises.writeFile(tempFile, file);
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
  if (tempFile) await fs.unlinkSync(tempFile);
  const readFile = await fs.promises.readFile(output);
  await fs.unlinkSync(output);
  return readFile;
}
var compress_default = compress;

export {
  compress_default
};

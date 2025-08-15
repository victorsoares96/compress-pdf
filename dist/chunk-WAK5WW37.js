"use strict";Object.defineProperty(exports, "__esModule", {value: true});// src/get-bin-path.ts
var _fs = require('fs');
function getBinPath(platform) {
  if (platform === "linux") {
    return "/usr/bin/gs";
  }
  if (platform === "win32") {
    return "gswin64c";
  }
  if (platform === "darwin") {
    const brewPath = "/opt/homebrew/bin/gs";
    const defaultPath = "/usr/local/bin/gs";
    return _fs.existsSync.call(void 0, brewPath) ? brewPath : defaultPath;
  }
  throw new Error(
    "not possible to get binaries path, unsupported platform was provided"
  );
}
var get_bin_path_default = getBinPath;



exports.get_bin_path_default = get_bin_path_default;

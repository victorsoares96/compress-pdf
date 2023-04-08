import fs from 'fs';
import path from 'path';
import os from 'os';

function getGSModulePath(binPath: string, platform: NodeJS.Platform) {
  const arch = os.arch();

  let gsModule = '';

  if (arch !== 'x64') {
    throw new Error('unsupported architecture, this module only supports x64');
  }

  if (platform !== 'linux' && platform !== 'win32') {
    throw new Error(
      'not possible to get module path, unsupported platform was provided'
    );
  }

  if (platform === 'linux') {
    gsModule = path.resolve(binPath, 'usr/local/bin/gs');
  }

  if (platform === 'win32') {
    gsModule = path.resolve(binPath, 'bin/gswin64c.exe');
  }

  if (!fs.existsSync(gsModule)) {
    throw new Error('The gs module could not be found inside binaries path.');
  }

  return gsModule;
}

export default getGSModulePath;

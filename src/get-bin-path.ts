import { existsSync } from 'fs';

function getBinPath(platform: NodeJS.Platform) {
  if (platform === 'linux') {
    return '/usr/bin/gs';
  }

  if (platform === 'win32') {
    return 'gswin64c';
  }

  if (platform === 'darwin') {
    const brewPath = '/opt/homebrew/bin/gs';
    const defaultPath = '/usr/local/bin/gs';
    return existsSync(brewPath) ? brewPath : defaultPath;
  }

  throw new Error(
    'not possible to get binaries path, unsupported platform was provided'
  );
}

export default getBinPath;

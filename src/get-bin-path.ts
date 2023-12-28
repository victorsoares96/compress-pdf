import path from 'path';

function getBinPath(platform: NodeJS.Platform) {
  if (platform === 'linux') {
    return '/usr/bin/gs';
  }

  if (platform === 'win32') {
    return path.resolve(__dirname, '../bin/gs/10.01.1_windows');
  }

  if (platform === 'darwin') {
    return '/usr/local/bin/gs';
  }

  throw new Error(
    'not possible to get binaries path, unsupported platform was provided'
  );
}

export default getBinPath;

function getBinPath(platform: NodeJS.Platform) {
  if (platform === 'linux') {
    return '/usr/bin/gs';
  }

  if (platform === 'win32') {
    return 'gswin64c';
  }

  if (platform === 'darwin') {
    return '/usr/local/bin/gs';
  }

  throw new Error(
    'not possible to get binaries path, unsupported platform was provided'
  );
}

export default getBinPath;

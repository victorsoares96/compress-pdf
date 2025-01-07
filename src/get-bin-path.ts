import { exec } from 'node:child_process';
import utils from 'node:util';

const execAsync = utils.promisify(exec);

async function getDarwinBinPath(): Promise<string> {
  let gsBinPath: string;
  try {
    const { stdout } = await execAsync('which gs');
    if (stdout.startsWith('/opt/homebrew/bin')) {
      gsBinPath = '/opt/homebrew/bin/gs';
    } else if (stdout.startsWith('/usr/local/bin')) {
      gsBinPath = '/usr/local/bin/gs';
    } else {
      gsBinPath = stdout.trim();
    }
  } catch (e) {
    return 'fail to get gs bin path';
  }

  return gsBinPath;
}

async function getBinPath(platform: NodeJS.Platform) {
  if (platform === 'linux') {
    return Promise.resolve('/usr/bin/gs');
  }

  if (platform === 'win32') {
    return Promise.resolve('/usr/bin/gs');
  }

  if (platform === 'darwin') {
    const path = await getDarwinBinPath();
    return path;
  }

  return Promise.reject(
    new Error(
      'not possible to get binaries path, unsupported platform was provided'
    )
  );
}

export default getBinPath;

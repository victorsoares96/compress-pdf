import { existsSync } from 'fs';
import path from 'path';

/**
 * Get the path to the Ghostscript binary.
 * Priority:
 * 1. Custom path from COMPRESS_PDF_BIN_PATH environment variable
 * 2. Downloaded binaries in bin/gs folder
 * 3. System-installed Ghostscript
 */
function getBinPath(platform: NodeJS.Platform) {
  // Check for custom binary path from environment variable
  const customPath = process.env.COMPRESS_PDF_BIN_PATH;
  if (customPath && existsSync(customPath)) {
    return customPath;
  }

  // Try to use downloaded binaries first
  const rootDir = path.resolve(__dirname, '..');
  const binDir = path.join(rootDir, 'bin', 'gs');

  if (platform === 'linux') {
    // Check in bin subdirectory first (extracted structure)
    let downloadedPath = path.join(binDir, 'bin', 'gs');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    // Check in root of gs directory
    downloadedPath = path.join(binDir, 'gs');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    return '/usr/bin/gs';
  }

  if (platform === 'win32') {
    // Check in bin subdirectory first (extracted structure)
    let downloadedPath = path.join(binDir, 'bin', 'gswin64c.exe');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    // Check in root of gs directory
    downloadedPath = path.join(binDir, 'gswin64c.exe');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    return 'gswin64c';
  }

  if (platform === 'darwin') {
    // Check in bin subdirectory first (extracted structure)
    let downloadedPath = path.join(binDir, 'bin', 'gs');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    // Check in root of gs directory
    downloadedPath = path.join(binDir, 'gs');
    if (existsSync(downloadedPath)) {
      return downloadedPath;
    }
    const brewPath = '/opt/homebrew/bin/gs';
    const defaultPath = '/usr/local/bin/gs';
    return existsSync(brewPath) ? brewPath : defaultPath;
  }

  throw new Error(
    'not possible to get binaries path, unsupported platform was provided'
  );
}

export default getBinPath;

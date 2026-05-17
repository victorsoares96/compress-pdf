#!/usr/bin/env node

/**
 * This script downloads and installs the Ghostscript binaries
 * for the current platform during npm install.
 * Similar to how Puppeteer handles browser downloads.
 */

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { execSync } = require('child_process');

const BASE_URL =
  'https://github.com/victorsoares96/compress-pdf/releases/download';

// Environment variables to control installation
const SKIP_DOWNLOAD = process.env.COMPRESS_PDF_SKIP_DOWNLOAD === 'true';
const CUSTOM_BIN_PATH = process.env.COMPRESS_PDF_BIN_PATH;

/**
 * Get the download URL for the current platform
 */
function getDownloadUrl() {
  const platform = process.platform;

  let filename;
  switch (platform) {
    case 'darwin':
      filename = 'ghostscript_darwin.tar.xz';
      break;
    case 'linux':
      filename = 'ghostscript_linux.tar.xz';
      break;
    case 'win32':
      filename = 'ghostscript_windows.tar.xz';
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }

  return `${BASE_URL}/binaries/${filename}`;
}

/**
 * Download a file from URL to destination
 */
async function downloadFile(url, destination) {
  console.log(`📦 Downloading Ghostscript binaries from ${url}...`);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to download: HTTP ${response.status} ${response.statusText}`
    );
  }

  // Convert Web Stream to Node Stream
  const nodeStream = Readable.fromWeb(response.body);
  const fileStream = fs.createWriteStream(destination);

  await pipeline(nodeStream, fileStream);

  console.log(`✅ Download completed: ${destination}`);
}

/**
 * Extract a .tar.xz archive using the system tar command with a Python fallback.
 */
async function extractArchive(archivePath, outputDir) {
  console.log(`📂 Extracting archive to ${outputDir}...`);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // tar -xJf works on Linux, macOS, and Windows 10+ (build 17063+)
  try {
    execSync(`tar -xJf "${archivePath}" -C "${outputDir}"`, { stdio: 'pipe' });
    console.log('✅ Extraction completed');
    return;
  } catch (_) {
    // fall through to Python fallback
  }

  // Python fallback (lzma + tarfile are in stdlib since Python 3.3)
  try {
    const py = `
import tarfile, os
with tarfile.open(r'${archivePath.replace(/\\/g, '\\\\')}', 'r:xz') as t:
    t.extractall(r'${outputDir.replace(/\\/g, '\\\\')}')
`.trim();
    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    execSync(
      `${pythonBin} -c "${py
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, ' ')}"`,
      { stdio: 'pipe' }
    );
    console.log('✅ Extraction completed (Python fallback)');
    return;
  } catch (err) {
    throw new Error(
      'Failed to extract .tar.xz archive. ' +
        'Ensure tar (with xz support) or Python 3 is available.\n' +
        err.message
    );
  }
}

/**
 * Smoke-test the gs binary on Linux to catch missing shared library errors
 * early and surface a clear message to the user.
 */
function checkLinuxDependencies(binDir) {
  if (process.platform !== 'linux') return;

  const gsBin = path.join(binDir, 'bin', 'gs');
  if (!fs.existsSync(gsBin)) return;

  try {
    execSync(`"${gsBin}" --version`, { stdio: 'pipe', timeout: 5000 });
    console.log('✅ Ghostscript dependency check passed');
  } catch (testError) {
    const stderr = testError.stderr ? testError.stderr.toString() : '';
    const missingLib = stderr.match(
      /error while loading shared libraries: ([^\s:]+)/
    );

    if (missingLib) {
      const libName = missingLib[1];
      console.warn(`⚠️  Missing shared library: ${libName}`);
      console.warn(`   Please install it and re-run npm install.`);
      console.warn(
        `   Example: sudo apt-get install -y ${libName.split('.so')[0]}`
      );
      console.warn(
        `   Or set COMPRESS_PDF_SKIP_DOWNLOAD=true to use a system Ghostscript instead.`
      );
    } else if (stderr) {
      console.warn('⚠️  Ghostscript binary test failed:', stderr.trim());
    }
  }
}

/**
 * Set executable permissions on Unix-like systems
 */
function setExecutablePermissions(binDir) {
  const platform = process.platform;

  if (platform !== 'win32') {
    try {
      // Find all files in the bin directory and make them executable
      const files = fs.readdirSync(binDir, { recursive: true });
      files.forEach((file) => {
        const filePath = path.join(binDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.chmodSync(filePath, 0o755);
        }
      });
      console.log('✅ Set executable permissions');
    } catch (error) {
      console.warn('⚠️  Failed to set executable permissions:', error.message);
    }
  }
}

/**
 * Clean up temporary files
 */
function cleanup(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`🧹 Cleaned up temporary file: ${filePath}`);
  }
}

/**
 * Main installation function
 */
async function install() {
  // Check if download should be skipped
  if (SKIP_DOWNLOAD) {
    console.log(
      '⏭️  Skipping Ghostscript download (COMPRESS_PDF_SKIP_DOWNLOAD=true)'
    );
    return;
  }

  if (CUSTOM_BIN_PATH) {
    console.log(`⏭️  Using custom binary path: ${CUSTOM_BIN_PATH}`);
    return;
  }

  try {
    // Determine paths
    const rootDir = path.resolve(__dirname, '..');
    const binDir = path.join(rootDir, 'bin', 'gs');
    const tempZipPath = path.join(rootDir, 'ghostscript_temp.tar.xz');

    // Check if binaries already exist
    const platform = process.platform;
    let binaryName;
    if (platform === 'win32') {
      binaryName = 'gswin64c.exe';
    } else {
      binaryName = 'gs';
    }

    // Check in bin subdirectory (extracted structure)
    let expectedBinaryPath = path.join(binDir, 'bin', binaryName);
    if (!fs.existsSync(expectedBinaryPath)) {
      // Also check in root of gs directory
      expectedBinaryPath = path.join(binDir, binaryName);
    }

    if (fs.existsSync(expectedBinaryPath)) {
      console.log('✅ Ghostscript binaries already installed');
      console.log(`📍 Location: ${binDir}`);
      return;
    }

    // Get download URL
    const downloadUrl = getDownloadUrl();

    // Download the archive
    await downloadFile(downloadUrl, tempZipPath);

    // Extract the archive
    await extractArchive(tempZipPath, binDir);

    // Set executable permissions on Unix-like systems
    setExecutablePermissions(binDir);

    // Fix missing shared library dependencies on Linux (e.g. libidn.so.11)
    checkLinuxDependencies(binDir);

    // Clean up
    cleanup(tempZipPath);

    console.log('🎉 Ghostscript binaries installed successfully!');
    console.log(`📍 Location: ${binDir}`);
  } catch (error) {
    console.error('❌ Failed to install Ghostscript binaries:', error.message);
    console.error(
      '\n⚠️  You can skip this step by setting COMPRESS_PDF_SKIP_DOWNLOAD=true'
    );
    console.error(
      '⚠️  Or provide a custom binary path with COMPRESS_PDF_BIN_PATH'
    );
    console.error('\n📖 For manual installation instructions, see:');
    console.error(
      '   https://github.com/victorsoares96/compress-pdf/blob/master/README.md'
    );

    // Don't fail the installation, just warn
    process.exit(0);
  }
}

// Run the installation
install().catch((error) => {
  console.error('Unexpected error during installation:', error);
  process.exit(0);
});

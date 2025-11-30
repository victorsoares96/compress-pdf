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

const GHOSTSCRIPT_VERSION = 'v0.5.6';
const BASE_URL = 'https://github.com/victorsoares96/compress-pdf/releases/download';

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
      filename = 'ghostscript_darwin.zip';
      break;
    case 'linux':
      filename = 'ghostscript_linux.zip';
      break;
    case 'win32':
      filename = 'ghostscript_windows.zip';
      break;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
  
  return `${BASE_URL}/${GHOSTSCRIPT_VERSION}/${filename}`;
}

/**
 * Download a file from URL to destination
 */
async function downloadFile(url, destination) {
  console.log(`📦 Downloading Ghostscript binaries from ${url}...`);
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download: HTTP ${response.status} ${response.statusText}`);
  }
  
  // Convert Web Stream to Node Stream
  const nodeStream = Readable.fromWeb(response.body);
  const fileStream = fs.createWriteStream(destination);
  
  await pipeline(nodeStream, fileStream);
  
  console.log(`✅ Download completed: ${destination}`);
}

/**
 * Extract ZIP file using platform-specific commands
 */
async function extractZip(zipPath, outputDir) {
  console.log(`📂 Extracting archive to ${outputDir}...`);
  
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const platform = process.platform;
  
  try {
    if (platform === 'win32') {
      // Windows: Use PowerShell's Expand-Archive
      const command = `powershell -NoProfile -Command "& { Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/\\/g, '\\\\')}', '${outputDir.replace(/\\/g, '\\\\')}') }"`;
      execSync(command, { stdio: 'pipe' });
    } else {
      // Unix-like: Use unzip command if available, otherwise try tar
      try {
        execSync(`unzip -o "${zipPath}" -d "${outputDir}"`, { stdio: 'pipe' });
      } catch (unzipError) {
        // If unzip is not available, try using Python as a fallback
        const pythonCommand = `python3 -c "import zipfile; zipfile.ZipFile('${zipPath}').extractall('${outputDir}')"`;
        execSync(pythonCommand, { stdio: 'pipe' });
      }
    }
    console.log(`✅ Extraction completed`);
  } catch (error) {
    console.error('❌ Failed to extract archive:', error.message);
    console.error('\n💡 Trying alternative extraction method...');
    
    // Fallback: Try using Node.js built-in modules (requires yauzl or similar)
    // For now, we'll just throw the error
    throw new Error('Failed to extract ZIP archive. Please ensure you have unzip (Linux/Mac) or PowerShell (Windows) available.');
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
      files.forEach(file => {
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
    console.log('⏭️  Skipping Ghostscript download (COMPRESS_PDF_SKIP_DOWNLOAD=true)');
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
    const tempZipPath = path.join(rootDir, 'ghostscript_temp.zip');
    
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
    await extractZip(tempZipPath, binDir);
    
    // Set executable permissions on Unix-like systems
    setExecutablePermissions(binDir);
    
    // Clean up
    cleanup(tempZipPath);
    
    console.log('🎉 Ghostscript binaries installed successfully!');
    console.log(`📍 Location: ${binDir}`);
    
  } catch (error) {
    console.error('❌ Failed to install Ghostscript binaries:', error.message);
    console.error('\n⚠️  You can skip this step by setting COMPRESS_PDF_SKIP_DOWNLOAD=true');
    console.error('⚠️  Or provide a custom binary path with COMPRESS_PDF_BIN_PATH');
    console.error('\n📖 For manual installation instructions, see:');
    console.error('   https://github.com/victorsoares96/compress-pdf/blob/master/README.md');
    
    // Don't fail the installation, just warn
    process.exit(0);
  }
}

// Run the installation
install().catch((error) => {
  console.error('Unexpected error during installation:', error);
  process.exit(0);
});

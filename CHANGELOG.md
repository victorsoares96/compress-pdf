# Changelog

## [0.6.0] - Automatic Binary Download

### ✨ New Features

- **Automatic Ghostscript Binary Download**: Binaries are now automatically downloaded during `npm install`, similar to how Puppeteer handles browser downloads
- **Zero-Configuration Setup**: The library works out of the box without requiring manual Ghostscript installation
- **Cross-Platform Support**: Automatically detects and downloads the correct binaries for Windows, macOS, and Linux
- **Smart Binary Resolution**: Prioritizes downloaded binaries over system-installed ones with fallback support

### 🔧 Environment Variables

- `COMPRESS_PDF_SKIP_DOWNLOAD=true`: Skip automatic binary download during installation
- `COMPRESS_PDF_BIN_PATH=/path/to/gs`: Use a custom Ghostscript binary path

### 📝 Changes

- Created `scripts/install.js` for automatic binary download and extraction
- Updated `src/get-bin-path.ts` to check for downloaded binaries first
- Updated `package.json` postinstall script to run the installation script
- Rewrote README.md to highlight the new automatic installation feature
- Added Docker examples for both automatic and manual installation approaches

### 🔄 Migration

- **No breaking changes**: Existing installations with system Ghostscript continue to work
- **Automatic upgrade**: Next `npm install` will download binaries automatically
- **Opt-out available**: Set `COMPRESS_PDF_SKIP_DOWNLOAD=true` to maintain current behavior

### 📦 Binary Sources

Binaries are downloaded from GitHub releases:

- Windows: `ghostscript_windows.zip`
- macOS: `ghostscript_darwin.zip`
- Linux: `ghostscript_linux.zip`

### 🎯 Benefits

1. Simplified installation process
2. Consistent behavior across all environments
3. Smaller Docker images when using downloaded binaries
4. No dependency on system package managers
5. Works in restricted environments where system packages can't be installed

---

## [0.5.5] - Previous Release

### 🚨 Breaking Changes

- Removed `--fetchBinaries` flag
- Binaries must be obtained through manual installation

### 📝 Changes

- Updated installation instructions
- Improved documentation

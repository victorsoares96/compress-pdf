# Changelog

## [Unreleased]

### ✨ New Features

- `pages` keeps the pages you list, numbered from 1, such as `1-3,5`. A backwards range such as `5-1` stays in that order. `compress([a, b])` joins files in that order. `split` writes one file per page when the output path contains `%d`. The CLI flags are `--pages`, repeated `-f`, and an `-o` path with `%d`.
- `pdfa` writes a PDF/A-1b, PDF/A-2b, or PDF/A-3b file in the same Ghostscript pass. Omitted by default. `1b` uses PDF 1.4 and `2b` / `3b` use PDF 1.7. Color is converted to RGB. The CLI flag is `--pdfa <1b|2b|3b>`.
- `stripMetadata` clears title, author, subject, keywords, and creator on the compressed PDF. `setMetadata` writes the fields you pass. `sanitize` clears that info, and Ghostscript rebuilds the extra metadata block from the cleared values. All three default to off. Ghostscript still writes its own producer and dates.
- `analyze(file)` reports pages, images, the highest image DPI, fonts, and whether the PDF looks scanned, vector, or mixed. `resolution: 'auto'` picks `screen`, `ebook`, or `printer` from that. The CLI accepts `-r auto`.
- `output` writes the compressed PDF straight to a file path. Ghostscript writes to that path, sizes come from `stat`, and the return value is metadata plus the absolute path instead of a Buffer. The CLI passes `--output` into this option.
- `targetSize` tries up to 6 milder preset/DPI combinations until the compressed file fits under the given byte size, or returns the smallest attempt if none fit. The CLI flag is `--targetSize <bytes>`.
- `returnOriginalIfLarger` keeps the original PDF when Ghostscript output is larger than or equal to the input. Default is `false`. The CLI flag is `--returnOriginalIfLarger`.

### 🐛 Bug Fixes

- A page list such as `1-500000000` is rejected from the range ends, without building every page number. A backwards list is copied without recompressing images, then compressed once. `split` rejects a repeated page and removes files already written if a later page fails.
- Archive extraction no longer builds a shell command. `tar` receives the archive and destination as arguments. The Python fallback receives those paths as arguments and refuses members that would be written outside the destination.
- Ghostscript calls now use a 120 second timeout, a 16 MB stderr buffer, and an optional `signal`. A missing binary explains `COMPRESS_PDF_BIN_PATH` and manual installation. Input paths are resolved to absolute paths before Ghostscript sees them.
- `imageQuality` and `compatibilityLevel` now reject `NaN` and other non-finite numbers before Ghostscript runs.
- Unknown CLI flags exit 1 and print the error plus `--help`. A resolution outside `screen`, `ebook`, `printer`, `prepress`, and `default` is rejected before compression starts.
- Compression results no longer replace `Buffer#buffer` with the Buffer itself. The property stays the native `ArrayBuffer`. `originalSize`, `compressedSize`, `compressionRatio`, and `duration` are unchanged.
- Ghostscript failures no longer include the PDF password. The message is built from stderr, and the password is redacted from the error message and cause.
- The CLI reads `COMPRESS_PDF_PASSWORD` when `--pdfPassword` is omitted. `--pdfPassword` is still accepted and is stored in shell history.

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

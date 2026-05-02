# PDF Compression v1.0.0 — WASM Architecture Design

**Date:** 2026-05-02
**Status:** Approved
**Version bump:** 0.6.x → 1.0.0 (breaking)

## Problem

Current implementation requires Ghostscript binary installed on the host machine. The `postinstall` script downloads a ~50MB GS binary from GitHub releases — fragile in serverless, Alpine Linux, Docker slim, and ARM environments. GS binary is AGPL-licensed, creating legal risk for corporate users.

## Goal

Replace Ghostscript dependency with a fully bundled WASM-based solution. Zero external binary installation. Same public API shape with minimal breaking changes.

## Chosen Approach

**pdf-lib + mozjpeg WASM pipeline**

- `pdf-lib` (MIT) — PDF parser and writer in pure JS
- `@jsquash/jpeg` (MIT) — mozjpeg compiled to WASM, JPEG encode/decode
- `@jsquash/resize` (MIT) — stb_image_resize compiled to WASM, Lanczos3 downsampling
- Node.js built-in `zlib` — Flate stream recompression

## Architecture

### File structure

```
src/
  compress.ts              # public API orchestrator
  types.ts                 # updated options type
  cli.ts                   # CLI (minor option updates)
  pdf/
    parser.ts              # pdf-lib load/save wrapper
    image-optimizer.ts     # JPEG extract → downsample → reencode
    stream-optimizer.ts    # FlateDecode recompression
    presets.ts             # resolution → { dpi, jpegQuality } mapping
  wasm/
    loader.ts              # lazy singleton WASM initializer

DELETED:
  src/get-bin-path.ts
  scripts/install.js
```

### Data flow

```
Input: string (filepath) | Buffer
        ↓
pdf-lib PDFDocument.load(bytes, { password? })
        ↓
Enumerate all PDFRawStream objects
        ↓
  For each stream individually:
  ┌── DCTDecode filter? ──────────────────────────────────┐
  │   1. Extract raw JPEG bytes                           │
  │   2. @jsquash/jpeg decode → ImageData                 │
  │   3. Calculate scale factor (currentDpi vs targetDpi) │
  │   4. @jsquash/resize → resized ImageData              │
  │   5. @jsquash/jpeg encode at jpegQuality              │
  │   6. Replace stream + update /Width /Height in dict   │
  │   On decode/encode failure → console.warn, keep orig  │
  └───────────────────────────────────────────────────────┘
  ┌── FlateDecode filter (non-image)? ────────────────────┐
  │   1. zlib.inflateSync                                 │
  │   2. zlib.deflateSync level 9                         │
  │   3. Replace only if result is smaller                │
  └───────────────────────────────────────────────────────┘
        ↓
pdf-lib PDFDocument.save()
        ↓
Output: Buffer & CompressResult
```

## API Changes (Breaking — v1.0.0)

### Options type

```typescript
type Options = {
  // Convenience preset. Maps to { dpi, jpegQuality } defaults.
  // Individual imageDpi / jpegQuality override the preset.
  resolution?: 'screen' | 'ebook' | 'printer' | 'prepress' | 'default';

  // Target DPI for image downsampling. Range 1–600.
  // Replaces old imageQuality (which was incorrectly named but stored DPI).
  imageDpi?: number;

  // JPEG encoder quality. Range 0–100.
  jpegQuality?: number;

  pdfPassword?: string;
  removePasswordAfterCompression?: boolean;

  // REMOVED: gsModule (no binary), compatibilityLevel (pdf-lib always PDF 1.7)
};
```

### Resolution presets

```typescript
const PRESETS = {
  screen:   { dpi: 72,  jpegQuality: 35 },
  ebook:    { dpi: 150, jpegQuality: 65 },  // default
  printer:  { dpi: 300, jpegQuality: 85 },
  prepress: { dpi: 300, jpegQuality: 95 },
  default:  { dpi: 150, jpegQuality: 75 },
};
```

`imageDpi` and `jpegQuality` in options override the preset values individually.

## Compression Rate Comparison

### Image-heavy PDF (~5MB typical)

| Method                          | Size reduction |
|---------------------------------|----------------|
| Ghostscript /screen             | 85–95%         |
| Ghostscript /ebook              | 60–80%         |
| Ghostscript /printer            | 20–40%         |
| New approach (zlib only)        | 5–15%          |
| New approach (+ mozjpeg WASM)   | 40–70%         |

### Text-only PDF (~500KB)

| Method              | Size reduction |
|---------------------|----------------|
| Ghostscript /ebook  | 10–30%         |
| New approach        | 8–25%          |

### Mixed PDF — text + images (~3MB)

| Method              | Size reduction |
|---------------------|----------------|
| Ghostscript /ebook  | 40–70%         |
| New approach        | 35–60%         |

**Largest remaining gap:** font subsetting. GS aggressively subsets fonts (keeps only used glyphs). pdf-lib does not support font subsetting — significant gap for PDFs with large CJK or decorative fonts.

## Error Handling

Strategy: if a single image stream fails decode/encode → log warning, keep original stream, continue. A partially compressed PDF is better than a failed compression.

Errors thrown as `CompressPdfError`:

| Condition | Message |
|---|---|
| File not found | `"File not found: <path>"` |
| pdf-lib parse failure | `"Failed to parse PDF: <reason>"` |
| Encrypted PDF, no password | `"PDF is encrypted, provide pdfPassword"` |
| Wrong password | `"Wrong password for encrypted PDF"` |
| AES-256 encryption (unsupported) | `"PDF uses AES-256 encryption, not supported"` |
| Invalid imageDpi | `"Invalid imageDpi: must be between 1 and 600"` |
| Invalid jpegQuality | `"Invalid jpegQuality: must be between 0 and 100"` |

## Password Support

pdf-lib supports RC4-40, RC4-128, AES-128 encrypted PDFs. AES-256 (PDF 2.0) is not supported — throws with clear message.

Flow:
- `pdfPassword` provided → `PDFDocument.load(bytes, { password })`
- `removePasswordAfterCompression: true` → `save()` without password options
- `removePasswordAfterCompression: false` → `save({ userPassword, ownerPassword })`
- PDF encrypted, no password → throw `CompressPdfError`

## WASM Loading

WASM modules load lazily on first call, cached as singletons per process. No cost at `require()` time.

```typescript
// src/wasm/loader.ts — singleton pattern
let jpegModule = null;
let resizeModule = null;

export async function getJpegCodec() {
  if (!jpegModule) jpegModule = await initJpeg();
  return jpegModule;
}
```

## Image Processing Limitations

- Only JPEG images (DCTDecode filter) are quality-reduced and downsampled
- PNG / raw pixel data (FlateDecode with ColorSpace): Flate recompressed only, no quality reduction
- CCITTFaxDecode (fax/mono): untouched
- JBIG2Decode: untouched
- DPI detection: calculated from XObject `/Width` + `/Height` relative to page dimensions. If undetectable, applies quality reduction only without downsampling.

## Dependencies

### Added to `dependencies`

```json
{
  "pdf-lib": "^1.17.1",
  "@jsquash/jpeg": "^1.3.0",
  "@jsquash/resize": "^1.0.0"
}
```

> **Note:** Verify exact `@jsquash/jpeg` and `@jsquash/resize` versions on npmjs.com before implementation — these are small packages with infrequent releases.

### Removed

- `postinstall` script
- `scripts/install.js`
- `bin/gs/.gitkeep`
- `src/get-bin-path.ts`

## Test Plan

### Fixtures needed

| File | Status |
|---|---|
| `text-only.pdf` | Exists |
| `image-heavy.pdf` | Add |
| `protected.pdf` | Exists |
| `encrypted-aes256.pdf` | Add (tests unsupported error) |

### Coverage

- Output is valid PDF (parseable by pdf-lib)
- Output smaller than input for image-heavy PDF
- `CompressResult` metadata fields present and correct
- Protected PDF: compresses with correct password, throws on wrong password
- `removePasswordAfterCompression`: output loads without password
- AES-256 PDF: throws `CompressPdfError` with clear message
- `screen` preset produces smaller output than `printer` for same image PDF
- `imageDpi` overrides preset DPI
- `jpegQuality` overrides preset quality
- Partial failure (corrupt image stream): continues, returns compressed result

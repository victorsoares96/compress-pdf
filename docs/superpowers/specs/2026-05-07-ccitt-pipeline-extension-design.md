# CCITT Pipeline Extension — Design Spec

**Date:** 2026-05-07  
**Branch:** `feat/compress-with-wasm-v1`  
**Status:** Approved

## Problem

The current WASM pipeline handles `DCTDecode` (JPEG) and `FlateDecode` (zlib) streams but skips `CCITTFaxDecode` entirely. B&W scanned documents (flight plans, invoices, legal filings) use CCITT Group 3/4 fax encoding. On a real 20 MB scanned PDF, this results in ~1.3% compression vs ~40–60% with Ghostscript.

## Goals

- Decode `CCITTFaxDecode` image streams in pure JS (no new runtime dependencies)
- Downsample high-DPI B&W bitmaps to reduce size
- Re-encode as `FlateDecode` (zlib, lossless) to preserve text legibility
- License: Apache 2.0 throughout (port from pdf.js)

## Non-Goals

- JBIG2 encoding (no pure-JS encoder with compatible license)
- Lossy conversion to JPEG grayscale (degrades text quality)
- MuPDF/PDFium integration (AGPL)

## Decisions

| Question | Choice | Reason |
|---|---|---|
| Re-encoding target | FlateDecode (lossless) | B&W text must not degrade |
| CCITT decoder source | Port from pdf.js (~300 lines) | No new dep; Apache 2.0; self-contained |
| DPI floor for CCITT | 150 DPI minimum | Below 150 DPI B&W text becomes illegible |

## Architecture

### Files Changed

```
src/pdf/
  ccitt-decoder.ts     ← NEW: CCITTFaxDecoder ported from pdf.js (Apache 2.0)
  ccitt-optimizer.ts   ← NEW: decode → downsample → FlateDecode
  image-optimizer.ts   (unchanged)
  stream-optimizer.ts  (unchanged)

src/
  compress.ts          ← MODIFIED: CCITTFaxDecode branch in stream loop
  pdf/presets.ts       ← MODIFIED: export CCITT_MIN_DPI = 150
```

### Data Flow

```
CCITTFaxDecode stream bytes + DecodeParms dict
  │
  ▼ ccitt-decoder.ts
  raw 1-bit bitmap (Uint8Array)
  rows × ceil(columns/8) bytes, MSB-first
  │
  ▼ ccitt-optimizer.ts — downsample if currentDpi > max(targetDpi, 150)
  1-bit bitmap (possibly smaller dimensions)
  │
  ▼ zlib deflateSync level 9
  FlateDecode bytes
  │
  ▼ compress.ts — update PDF dict
  Filter=FlateDecode, remove DecodeParms, update Width/Height/Length
```

## Component Specifications

### `src/pdf/ccitt-decoder.ts`

Ports `CCITTFaxDecoder` from `pdf.js/src/core/ccitt.js`. File must include Apache 2.0 attribution header.

```typescript
// Portions adapted from pdf.js (https://github.com/mozilla/pdf.js)
// Copyright 2012 Mozilla Foundation — Apache License 2.0

export interface CCITTParams {
  K: number;               // 0=Group3-1D, >0=Group3-2D, <0=Group4
  columns: number;         // image width in pixels
  rows: number;            // image height (0=unknown, use until EOD)
  blackIs1: boolean;       // inverted color mapping
  encodedByteAlign: boolean;
}

export function decodeCCITT(data: Uint8Array, params: CCITTParams): Uint8Array;
// Returns: 1-bit packed bitmap, rows × ceil(columns/8) bytes, MSB-first
// Throws on malformed data (caller catches and skips stream)
```

**Param defaults** (from PDF spec §7.4.6):

| Param | Default |
|---|---|
| K | 0 |
| Columns | 1728 |
| Rows | 0 |
| BlackIs1 | false |
| EncodedByteAlign | false |

### `src/pdf/ccitt-optimizer.ts`

```typescript
export interface OptimizeCCITTOptions {
  targetDpi: number;       // from preset (e.g. 72, 150, 300)
  currentWidthPx: number;  // from PDF dict /Width
  currentHeightPx: number; // from PDF dict /Height
  pageWidthPt?: number;    // page width in points (1pt = 1/72 inch)
}

export interface CCITTOptimizeResult {
  data: Uint8Array;  // FlateDecode bytes
  width: number;     // output width (may differ from input after downsampling)
  height: number;    // output height
}

export function optimizeCCITTStream(
  data: Uint8Array,
  params: CCITTParams,
  options: OptimizeCCITTOptions
): CCITTOptimizeResult | null;
// Returns null if: decode fails, or result >= original size
```

**Internal algorithm:**

1. `decodeCCITT(data, params)` → 1-bit raw bitmap
2. Compute `currentDpi = currentWidthPx / (pageWidthPt / 72)` (fallback: skip downsampling if no pageWidthPt)
3. `effectiveDpi = Math.max(targetDpi, CCITT_MIN_DPI)`  ← 150 DPI floor
4. If `currentDpi > effectiveDpi`:
   - `scale = effectiveDpi / currentDpi`
   - `newWidth = Math.max(1, Math.round(width * scale))`
   - `newHeight = Math.max(1, Math.round(height * scale))`
   - Expand packed 1-bit → flat 8-bit array (0x00=white, 0xFF=black)
   - Box-filter downsample: each output pixel = majority vote of `ceil(1/scale)²` input pixels
   - Threshold back → packed 1-bit
5. `deflateSync(bitmap, { level: 9 })`
6. Return `null` if `result.length >= data.length`

### `src/compress.ts` (changes)

Add `CCITTFaxDecode` branch after the `FlateDecode` branch. Extract params via private helper:

```typescript
function extractCCITTParams(decodeParms: PDFObject | undefined): CCITTParams {
  // reads K, Columns, Rows, BlackIs1, EncodedByteAlign from PDFDict
  // returns defaults for any missing keys
}
```

In the stream loop:

```typescript
} else if (filterName === 'CCITTFaxDecode') {
  const isImage = subtype instanceof PDFName && subtype.asString() === 'Image';
  if (!isImage) continue;

  const params = extractCCITTParams(dict.get(PDFName.of('DecodeParms')));
  const widthObj = dict.get(PDFName.of('Width'));
  const heightObj = dict.get(PDFName.of('Height'));
  const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
  const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;
  if (width === 0 || height === 0) continue;

  const result = optimizeCCITTStream(streamBytes, params, {
    targetDpi: preset.dpi,
    currentWidthPx: width,
    currentHeightPx: height,
    pageWidthPt: 612,
  });

  if (result !== null) {
    obj.contents = result.data;
    dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
    dict.delete(PDFName.of('DecodeParms'));
    dict.set(PDFName.of('Width'), PDFNumber.of(result.width));
    dict.set(PDFName.of('Height'), PDFNumber.of(result.height));
    dict.set(PDFName.of('Length'), PDFNumber.of(result.data.length));
  }
}
```

### `src/pdf/presets.ts` (changes)

```typescript
export const CCITT_MIN_DPI = 150;
```

## Testing

### Unit Tests (new)

**`__tests__/ccitt-decoder.test.ts`**
- Decode synthetic G3 1D fixture → verify dimensions and known pixel values
- Decode synthetic G4 fixture → same
- Malformed input → throws (caller handles)

**`__tests__/ccitt-optimizer.test.ts`**
- Mock `decodeCCITT`: verify downsampling math at various scale factors
- Verify 150 DPI floor: `targetDpi=72` still downsamples only to 150 DPI
- Verify `null` return when result ≥ original (no regression)
- Verify dict mutation in `compress.ts`: `Filter`, `DecodeParms`, `Width`, `Height`, `Length` all correct after optimization

### Integration Test (existing `compress.spec.ts`)

- Add fixture `scanned-bw.pdf` — synthetic PDF with CCITT G4 stream (small, committed to repo; generated via `generate-scanned-bw.ts` if recreation needed)
- Assert `compressionRatio < 0.70` (>30% reduction) when downsampling applies
- Assert output PDF is valid (pdf-lib can re-parse it)
- Assert `CCITTFaxDecode` streams absent in output (all converted to FlateDecode)

### Fixture Generation

Add `__tests__/fixtures/generate-scanned-bw.ts` — script that programmatically creates a minimal PDF with a CCITT G4 image (200×200 px, 300 DPI). Run once, output checked into repo. This avoids shipping multi-MB real-world PDFs in the test suite.

## Error Handling

- `decodeCCITT` throws on corrupt data → `optimizeCCITTStream` catches, returns `null` → stream left unchanged (safe fallback)
- If `Width` or `Height` missing from dict → skip stream (cannot compute DPI, cannot pack bitmap)
- If `pageWidthPt` unavailable → skip downsampling, still attempt zlib recompression

## Risks

| Risk | Mitigation |
|---|---|
| pdf.js decoder has edge-case bugs | We inherit them; fallback (return null) prevents corruption |
| Some viewers reject FlateDecode for images that were CCITT | Tested against pdf-lib re-parse; all major viewers support FlateDecode |
| Majority-vote downsampling blurs fine lines | 150 DPI floor keeps text legible; acceptable trade-off |

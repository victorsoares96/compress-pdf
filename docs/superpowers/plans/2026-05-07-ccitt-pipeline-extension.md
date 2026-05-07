# CCITT Pipeline Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the PDF compression pipeline to decode `CCITTFaxDecode` (fax-encoded B&W) image streams, downsample them to the target DPI (min 150 DPI floor), and re-encode as `FlateDecode` (zlib lossless).

**Architecture:** Port the `CCITTFaxDecoder` from pdf.js (~300 lines, Apache 2.0) as a standalone TypeScript module with zero new runtime dependencies. An optimizer function wraps decode → downsample → zlib. `compress.ts` gains a new `CCITTFaxDecode` branch in its existing stream loop.

**Tech Stack:** TypeScript, Node.js `zlib` (built-in), `pdf-lib` (existing), Vitest (existing)

**Spec:** `docs/superpowers/specs/2026-05-07-ccitt-pipeline-extension-design.md`

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/pdf/ccitt-decoder.ts` | CCITTFaxDecoder port from pdf.js + `decodeCCITT` wrapper |
| Create | `src/pdf/ccitt-optimizer.ts` | decode → downsample → FlateDecode |
| Create | `__tests__/ccitt-decoder.test.ts` | Decoder unit tests |
| Create | `__tests__/ccitt-optimizer.test.ts` | Optimizer unit tests |
| Create | `__tests__/fixtures/generate-scanned-bw.ts` | One-time fixture generator |
| Create | `__tests__/fixtures/scanned-bw.pdf` | Generated CCITT fixture (committed) |
| Modify | `src/pdf/presets.ts` | Add `export const CCITT_MIN_DPI = 150` |
| Modify | `src/compress.ts` | Add `CCITTFaxDecode` branch + `extractCCITTParams` helper |
| Modify | `__tests__/compress.spec.ts` | Add CCITT integration test |

---

## Task 1: Port CCITTFaxDecoder from pdf.js

**Files:**
- Create: `src/pdf/ccitt-decoder.ts`

- [ ] **Step 1.1: Fetch the pdf.js CCITT source**

```bash
curl -o /tmp/ccitt.js "https://raw.githubusercontent.com/mozilla/pdf.js/refs/heads/master/src/core/ccitt.js"
```

Open `/tmp/ccitt.js`. Locate the `CCITTFaxDecoder` class. It reads from a `source` object that must implement `{ next(): number }` — `next()` returns the next input byte or `-1` for EOF. The class exposes a `readNextChar()` method that returns one decoded output byte (8 pixels packed, MSB-first) or `-1` at end of image data.

- [ ] **Step 1.2: Create `src/pdf/ccitt-decoder.ts`**

```typescript
// src/pdf/ccitt-decoder.ts
// Portions adapted from pdf.js (https://github.com/mozilla/pdf.js/blob/master/src/core/ccitt.js)
// Copyright 2012 Mozilla Foundation and contributors
// Licensed under the Apache License, Version 2.0
// See: http://www.apache.org/licenses/LICENSE-2.0

export interface CCITTParams {
  K: number;               // 0=Group3-1D, >0=Group3-2D, <0=Group4
  columns: number;         // image width in pixels (PDF /Columns)
  rows: number;            // image height (PDF /Rows, 0=unknown)
  blackIs1: boolean;       // PDF /BlackIs1
  encodedByteAlign: boolean; // PDF /EncodedByteAlign
}

// ─── Paste CCITTFaxDecoder class from pdf.js here ──────────────────────────
// Adaptation notes:
//   1. Remove all `import` statements (the class is self-contained)
//   2. Change `export class CCITTFaxDecoder` or wrap in a module pattern
//   3. Replace any `/** @type {...} */` JSDoc with TypeScript types
//   4. Keep logic byte-for-byte identical — do not simplify
// ───────────────────────────────────────────────────────────────────────────

export function decodeCCITT(data: Uint8Array, params: CCITTParams): Uint8Array {
  if (data.length === 0) return new Uint8Array(0);

  let pos = 0;
  const source = { next: (): number => (pos < data.length ? data[pos++] : -1) };

  const decoder = new CCITTFaxDecoder(source, {
    K: params.K,
    Columns: params.columns,
    Rows: params.rows,
    BlackIs1: params.blackIs1,
    EncodedByteAlign: params.encodedByteAlign,
  });

  const rowBytes = Math.ceil(params.columns / 8);
  const maxRows = params.rows > 0 ? params.rows : 65536;
  const output = new Uint8Array(rowBytes * maxRows);
  let outPos = 0;

  let byte: number;
  while (outPos < output.length) {
    byte = decoder.readNextChar();
    if (byte === -1) break;
    output[outPos++] = byte;
  }

  return output.slice(0, outPos);
}
```

- [ ] **Step 1.3: Run TypeScript check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors. If `CCITTFaxDecoder` is not seen, you may need `declare class CCITTFaxDecoder { ... }` or convert the pasted class to TypeScript more carefully.

- [ ] **Step 1.4: Commit**

```bash
CI=1 git add src/pdf/ccitt-decoder.ts && CI=1 git commit -m "feat: port CCITTFaxDecoder from pdf.js (Apache 2.0)"
```

---

## Task 2: Unit tests for ccitt-decoder

**Files:**
- Create: `__tests__/ccitt-decoder.test.ts`

**Test fixture bytes (computed from CCITT G4 spec):**

For an **8 columns × 4 rows all-white image** (K=-1, BlackIs1=false):
- Each row vs all-white reference → V(0) code = 1 bit
- 4 rows = 4 bits; EOFB = two 12-bit EOLs = 24 bits; total 28 bits padded to 4 bytes
- Bytes: `[0xF0, 0x01, 0x00, 0x10]`
- Expected decoded output: `[0x00, 0x00, 0x00, 0x00]` (4 rows × 1 byte, all white pixels = 0)

- [ ] **Step 2.1: Write the tests**

```typescript
// __tests__/ccitt-decoder.test.ts
import { describe, it, expect } from 'vitest';
import { decodeCCITT } from '../src/pdf/ccitt-decoder';

// CCITT G4: 8 columns × 4 rows, all-white
// 4 × V(0) codes (1 bit each) + EOFB (24 bits) = 28 bits = 4 bytes with 4-bit padding
// Bit layout: 1111 000000000001 000000000001 0000
// Bytes:       0xF0 0x01         0x00 0x10
const ALL_WHITE_8x4_G4 = new Uint8Array([0xF0, 0x01, 0x00, 0x10]);

describe('decodeCCITT', () => {
  it('decodes all-white 8×4 Group4 image to 4 zero bytes', () => {
    const result = decodeCCITT(ALL_WHITE_8x4_G4, {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: false,
      encodedByteAlign: false,
    });
    expect(result).toEqual(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
  });

  it('inverts output when blackIs1=true (white pixels become 0xFF)', () => {
    const result = decodeCCITT(ALL_WHITE_8x4_G4, {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: true,
      encodedByteAlign: false,
    });
    expect(result).toEqual(new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]));
  });

  it('returns empty Uint8Array for empty input', () => {
    const result = decodeCCITT(new Uint8Array([]), {
      K: -1,
      columns: 8,
      rows: 4,
      blackIs1: false,
      encodedByteAlign: false,
    });
    expect(result.length).toBe(0);
  });
});
```

- [ ] **Step 2.2: Run tests**

```bash
npx vitest run __tests__/ccitt-decoder.test.ts
```

Expected: 3 tests pass. If the `blackIs1` test fails, check that the pdf.js decoder properly handles `BlackIs1` inversion — it should XOR the output byte with `0xFF` when `BlackIs1=true`. If not, add that inversion in `decodeCCITT`:

```typescript
// inside the while loop, after reading byte:
output[outPos++] = params.blackIs1 ? byte ^ 0xFF : byte;
```

- [ ] **Step 2.3: Commit**

```bash
CI=1 git add __tests__/ccitt-decoder.test.ts && CI=1 git commit -m "test: add ccitt-decoder unit tests"
```

---

## Task 3: Add CCITT_MIN_DPI to presets

**Files:**
- Modify: `src/pdf/presets.ts`

- [ ] **Step 3.1: Add the constant**

Add this line after the `PRESETS` map (before `getPreset`):

```typescript
export const CCITT_MIN_DPI = 150;
```

- [ ] **Step 3.2: Run existing preset tests**

```bash
npx vitest run __tests__/presets.spec.ts
```

Expected: all pass (no changes to existing exports).

- [ ] **Step 3.3: Commit**

```bash
CI=1 git add src/pdf/presets.ts && CI=1 git commit -m "feat: add CCITT_MIN_DPI = 150 to presets"
```

---

## Task 4: TDD — ccitt-optimizer

**Files:**
- Create: `src/pdf/ccitt-optimizer.ts`
- Create: `__tests__/ccitt-optimizer.test.ts`

- [ ] **Step 4.1: Write the failing tests**

```typescript
// __tests__/ccitt-optimizer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/pdf/ccitt-decoder', () => ({
  decodeCCITT: vi.fn(),
}));

import { optimizeCCITTStream } from '../src/pdf/ccitt-optimizer';
import { decodeCCITT } from '../src/pdf/ccitt-decoder';

const mockDecode = vi.mocked(decodeCCITT);
const BASE_PARAMS = { K: -1, columns: 100, rows: 100, blackIs1: false, encodedByteAlign: false };

function makeBitmap(rows: number, cols: number): Uint8Array {
  return new Uint8Array(rows * Math.ceil(cols / 8)); // all zeros = all white
}

describe('optimizeCCITTStream', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when decoder throws (corrupt stream falls through safely)', () => {
    mockDecode.mockImplementation(() => { throw new Error('corrupt data'); });

    const result = optimizeCCITTStream(new Uint8Array(10), BASE_PARAMS, {
      targetDpi: 150,
      currentWidthPx: 100,
      currentHeightPx: 100,
      pageWidthPt: 612,
    });

    expect(result).toBeNull();
  });

  it('downsamples 300 DPI image to 150 DPI (scale 0.5) when targetDpi=150', () => {
    // currentDpi = 2550px / (612pt / 72) = 2550 / 8.5 = 300 DPI → scale 0.5
    const bitmap = makeBitmap(3300, 2550);
    mockDecode.mockReturnValue(bitmap);

    const params = { K: -1, columns: 2550, rows: 3300, blackIs1: false, encodedByteAlign: false };
    // largeInput ensures deflated bitmap (small) wins the size comparison
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 150,
      currentWidthPx: 2550,
      currentHeightPx: 3300,
      pageWidthPt: 612,
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275);   // 2550 × 0.5
    expect(result!.height).toBe(1650);  // 3300 × 0.5
  });

  it('enforces 150 DPI floor: targetDpi=72 still only downsamples to 150', () => {
    const bitmap = makeBitmap(3300, 2550);
    mockDecode.mockReturnValue(bitmap);

    const params = { K: -1, columns: 2550, rows: 3300, blackIs1: false, encodedByteAlign: false };
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 72, // screen preset — floor must apply
      currentWidthPx: 2550,
      currentHeightPx: 3300,
      pageWidthPt: 612,
    });

    // effectiveDpi = max(72, 150) = 150 → scale = 150/300 = 0.5 (same as targetDpi=150)
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275);
    expect(result!.height).toBe(1650);
  });

  it('does not downsample when currentDpi is already at or below effectiveDpi', () => {
    // currentDpi = 1275 / 8.5 = 150 DPI → effectiveDpi=150 → no downsampling
    const bitmap = makeBitmap(1650, 1275);
    mockDecode.mockReturnValue(bitmap);

    const params = { K: -1, columns: 1275, rows: 1650, blackIs1: false, encodedByteAlign: false };
    const result = optimizeCCITTStream(new Uint8Array(1_000_000), params, {
      targetDpi: 150,
      currentWidthPx: 1275,
      currentHeightPx: 1650,
      pageWidthPt: 612,
    });

    expect(result).not.toBeNull();
    expect(result!.width).toBe(1275);  // unchanged
    expect(result!.height).toBe(1650); // unchanged
  });

  it('returns null when FlateDecode result is not smaller than original stream', () => {
    // Tiny bitmap; deflated output will be larger than 1-byte "original"
    const bitmap = makeBitmap(4, 8);
    mockDecode.mockReturnValue(bitmap);

    const result = optimizeCCITTStream(new Uint8Array(1), BASE_PARAMS, {
      targetDpi: 150,
      currentWidthPx: 100,
      currentHeightPx: 100,
      pageWidthPt: 612,
    });

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 4.2: Run tests — confirm FAIL**

```bash
npx vitest run __tests__/ccitt-optimizer.test.ts
```

Expected: fails with "Cannot find module '../src/pdf/ccitt-optimizer'".

- [ ] **Step 4.3: Implement `ccitt-optimizer.ts`**

```typescript
// src/pdf/ccitt-optimizer.ts
import { deflateSync } from 'zlib';
import { decodeCCITT, type CCITTParams } from './ccitt-decoder';
import { CCITT_MIN_DPI } from './presets';

export interface OptimizeCCITTOptions {
  targetDpi: number;
  currentWidthPx: number;
  currentHeightPx: number;
  pageWidthPt?: number;
}

export interface CCITTOptimizeResult {
  data: Uint8Array;
  width: number;
  height: number;
}

export function optimizeCCITTStream(
  data: Uint8Array,
  params: CCITTParams,
  options: OptimizeCCITTOptions
): CCITTOptimizeResult | null {
  let bitmap: Uint8Array;
  try {
    bitmap = decodeCCITT(data, params);
  } catch {
    return null;
  }

  let width = params.columns;
  let height = params.rows;

  if (options.pageWidthPt && options.pageWidthPt > 0 && options.currentWidthPx > 0) {
    const pageWidthInches = options.pageWidthPt / 72;
    const currentDpi = options.currentWidthPx / pageWidthInches;
    const effectiveDpi = Math.max(options.targetDpi, CCITT_MIN_DPI);

    if (currentDpi > effectiveDpi) {
      const scale = effectiveDpi / currentDpi;
      const newWidth = Math.max(1, Math.round(width * scale));
      const newHeight = Math.max(1, Math.round(height * scale));
      bitmap = downsample1Bit(bitmap, width, height, newWidth, newHeight);
      width = newWidth;
      height = newHeight;
    }
  }

  const compressed = deflateSync(bitmap, { level: 9 });
  if (compressed.length >= data.length) return null;

  return { data: compressed, width, height };
}

function downsample1Bit(
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Uint8Array {
  const srcRowBytes = Math.ceil(srcWidth / 8);
  const dstRowBytes = Math.ceil(dstWidth / 8);
  const dst = new Uint8Array(dstRowBytes * dstHeight);

  for (let dy = 0; dy < dstHeight; dy++) {
    const srcY0 = Math.floor((dy * srcHeight) / dstHeight);
    const srcY1 = Math.floor(((dy + 1) * srcHeight) / dstHeight);

    for (let dx = 0; dx < dstWidth; dx++) {
      const srcX0 = Math.floor((dx * srcWidth) / dstWidth);
      const srcX1 = Math.floor(((dx + 1) * srcWidth) / dstWidth);

      let black = 0;
      let total = 0;
      for (let sy = srcY0; sy < srcY1; sy++) {
        const srcRow = sy * srcRowBytes;
        for (let sx = srcX0; sx < srcX1; sx++) {
          const bit = (src[srcRow + Math.floor(sx / 8)] >> (7 - (sx % 8))) & 1;
          if (bit) black++;
          total++;
        }
      }

      if (total > 0 && black * 2 > total) {
        const dstRow = dy * dstRowBytes;
        dst[dstRow + Math.floor(dx / 8)] |= 1 << (7 - (dx % 8));
      }
    }
  }

  return dst;
}
```

- [ ] **Step 4.4: Run tests — confirm PASS**

```bash
npx vitest run __tests__/ccitt-optimizer.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 4.5: Commit**

```bash
CI=1 git add src/pdf/ccitt-optimizer.ts __tests__/ccitt-optimizer.test.ts \
  && CI=1 git commit -m "feat: add ccitt-optimizer (decode → downsample → FlateDecode)"
```

---

## Task 5: Generate test fixture PDF

**Files:**
- Create: `__tests__/fixtures/generate-scanned-bw.ts`
- Create: `__tests__/fixtures/scanned-bw.pdf` (generated, then committed)

The fixture is a 2550×3300 px all-white image (equivalent to 300 DPI on a US Letter page).

CCITT G4 for all-white 2550×3300:
- Each row vs all-white reference → V(0) = 1 bit → 3300 bits total
- Plus EOFB (two 12-bit EOLs) = 24 bits → total 3324 bits = 416 bytes (4-bit padding)
- First 412 bytes: `0xFF` (3296 V(0) codes)
- Bytes 412–415: `0xF0, 0x01, 0x00, 0x10` (4 remaining V(0) + EOFB + padding)

- [ ] **Step 5.1: Write the generator**

```typescript
// __tests__/fixtures/generate-scanned-bw.ts
import { writeFileSync } from 'fs';
import { join } from 'path';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFDict } from 'pdf-lib';

const COLUMNS = 2550; // 300 DPI × 8.5"
const ROWS = 3300;    // 300 DPI × 11"

function buildCCITTG4Stream(): Uint8Array {
  // 3300 all-white rows in CCITT G4 vs all-white reference:
  //   each row = V(0) code = 1 bit → 3300 bits total
  // EOFB = two 12-bit EOLs (000000000001 × 2) = 24 bits
  // Total: 3324 bits → 416 bytes (4 padding bits)
  const stream = new Uint8Array(416);
  stream.fill(0xFF, 0, 412); // 3296 V(0) bits = 412 bytes
  stream[412] = 0xF0; // 4 more V(0): 1111, then EOFB starts: 0000
  stream[413] = 0x01; // EOFB EOL-1 bits 4–11: 0000 0001
  stream[414] = 0x00; // EOFB EOL-2 bits 0–7:  0000 0000
  stream[415] = 0x10; // EOFB EOL-2 bits 8–11: 0001, padding: 0000
  return stream;
}

async function main(): Promise<void> {
  const ccittData = buildCCITTG4Stream();
  const doc = await PDFDocument.create();
  const { context } = doc;

  const decodeParms = context.obj({
    K: PDFNumber.of(-1),
    Columns: PDFNumber.of(COLUMNS),
    Rows: PDFNumber.of(ROWS),
  }) as PDFDict;

  const imageDict = context.obj({
    Type: PDFName.of('XObject'),
    Subtype: PDFName.of('Image'),
    Width: PDFNumber.of(COLUMNS),
    Height: PDFNumber.of(ROWS),
    ColorSpace: PDFName.of('DeviceGray'),
    BitsPerComponent: PDFNumber.of(1),
    Filter: PDFName.of('CCITTFaxDecode'),
    DecodeParms: decodeParms,
    Length: PDFNumber.of(ccittData.length),
  }) as PDFDict;

  const imageRef = context.register(PDFRawStream.of(imageDict, ccittData));

  const page = doc.addPage([612, 792]);
  const { node } = page;

  // Wire XObject resource
  let resources = node.Resources();
  if (!resources) {
    resources = context.obj({}) as PDFDict;
    node.set(PDFName.of('Resources'), resources);
  }
  const xObjects = context.obj({ Img: imageRef }) as PDFDict;
  (resources as PDFDict).set(PDFName.of('XObject'), xObjects);

  // Content stream: scale to fill page and draw image
  const ops = Buffer.from('q 612 0 0 792 0 0 cm /Img Do Q');
  const contentDict = context.obj({ Length: PDFNumber.of(ops.length) }) as PDFDict;
  const contentRef = context.register(PDFRawStream.of(contentDict, new Uint8Array(ops)));
  node.set(PDFName.of('Contents'), contentRef);

  const pdfBytes = await doc.save();
  const outPath = join(__dirname, 'scanned-bw.pdf');
  writeFileSync(outPath, pdfBytes);
  console.log(`Written: ${outPath} (${pdfBytes.length} bytes)`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 5.2: Run the generator**

```bash
npx tsx __tests__/fixtures/generate-scanned-bw.ts
```

Expected output:
```
Written: ...\__tests__\fixtures\scanned-bw.pdf (NNN bytes)
```

- [ ] **Step 5.3: Verify fixture has CCITTFaxDecode stream**

```bash
node -e "
const {PDFDocument, PDFRawStream, PDFName} = require('pdf-lib');
const fs = require('fs');
PDFDocument.load(fs.readFileSync('./__tests__/fixtures/scanned-bw.pdf')).then(doc => {
  let found = false;
  for (const [,obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const f = obj.dict.get(PDFName.of('Filter'));
      if (f) { console.log('Filter:', f.toString()); found = true; }
    }
  }
  if (!found) console.log('No streams found — check fixture generator');
});
"
```

Expected: prints `Filter: /CCITTFaxDecode`.

- [ ] **Step 5.4: Commit**

```bash
CI=1 git add __tests__/fixtures/ && CI=1 git commit -m "test: add scanned-bw.pdf CCITT fixture and generator script"
```

---

## Task 6: Wire compress.ts — CCITTFaxDecode branch

**Files:**
- Modify: `src/compress.ts`
- Modify: `__tests__/compress.spec.ts`

- [ ] **Step 6.1: Add integration test (it will FAIL first)**

In `__tests__/compress.spec.ts`, add the following import at the top alongside existing imports:

```typescript
import { PDFRawStream } from 'pdf-lib';
```

Then add this test case inside the existing `describe('compress')` block:

```typescript
it('converts CCITTFaxDecode image streams to FlateDecode and reduces file size', async () => {
  const SCANNED_BW = path.resolve(__dirname, 'fixtures/scanned-bw.pdf');
  const input = await fs.promises.readFile(SCANNED_BW);

  const result = await compress(input, { resolution: 'ebook' });

  expect(result).toBeInstanceOf(Buffer);

  // All CCITTFaxDecode streams must be converted to FlateDecode in output
  const outDoc = await PDFDocument.load(result);
  for (const [, obj] of outDoc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const filter = obj.dict.get(PDFName.of('Filter'));
    if (filter) expect(filter.toString()).not.toBe('/CCITTFaxDecode');
  }

  // Overall file must be smaller than input
  expect(result.compressionRatio).toBeLessThan(1.0);
}, 30000);
```

- [ ] **Step 6.2: Run test — confirm it FAILS**

```bash
npx vitest run __tests__/compress.spec.ts
```

Expected: new test fails — `/CCITTFaxDecode` stream still present in output.

- [ ] **Step 6.3: Update imports in `src/compress.ts`**

Change the existing `pdf-lib` import line to add `PDFDict` and `PDFBool`:

```typescript
import { PDFDocument, PDFRawStream, PDFName, PDFNumber, PDFDict, PDFBool } from 'pdf-lib';
```

Add these two imports below the existing imports:

```typescript
import { optimizeCCITTStream } from './pdf/ccitt-optimizer';
import type { CCITTParams } from './pdf/ccitt-decoder';
```

- [ ] **Step 6.4: Add `extractCCITTParams` helper to `src/compress.ts`**

Add this function immediately before the `validateOptions` function:

```typescript
function extractCCITTParams(decodeParms: unknown): CCITTParams {
  const defaults: CCITTParams = {
    K: 0,
    columns: 1728,
    rows: 0,
    blackIs1: false,
    encodedByteAlign: false,
  };

  if (!(decodeParms instanceof PDFDict)) return defaults;

  const K = decodeParms.get(PDFName.of('K'));
  const columns = decodeParms.get(PDFName.of('Columns'));
  const rows = decodeParms.get(PDFName.of('Rows'));
  const blackIs1 = decodeParms.get(PDFName.of('BlackIs1'));
  const encodedByteAlign = decodeParms.get(PDFName.of('EncodedByteAlign'));

  return {
    K: K instanceof PDFNumber ? K.asNumber() : defaults.K,
    columns: columns instanceof PDFNumber ? columns.asNumber() : defaults.columns,
    rows: rows instanceof PDFNumber ? rows.asNumber() : defaults.rows,
    blackIs1: blackIs1 instanceof PDFBool ? blackIs1.asBoolean() : defaults.blackIs1,
    encodedByteAlign: encodedByteAlign instanceof PDFBool
      ? encodedByteAlign.asBoolean()
      : defaults.encodedByteAlign,
  };
}
```

- [ ] **Step 6.5: Add CCITTFaxDecode branch in `src/compress.ts`**

In the stream loop (after line 112, the closing `}` of the `FlateDecode` branch), add:

```typescript
    } else if (filterName === 'CCITTFaxDecode') {
      const isImage = subtype instanceof PDFName && subtype.asString() === 'Image';
      if (!isImage) continue;

      const widthObj = dict.get(PDFName.of('Width'));
      const heightObj = dict.get(PDFName.of('Height'));
      const width = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
      const height = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;
      if (width === 0 || height === 0) continue;

      const params = extractCCITTParams(dict.get(PDFName.of('DecodeParms')));

      const ccittResult = optimizeCCITTStream(streamBytes, params, {
        targetDpi: preset.dpi,
        currentWidthPx: width,
        currentHeightPx: height,
        pageWidthPt: 612,
      });

      if (ccittResult !== null) {
        (obj as unknown as { contents: Uint8Array }).contents = ccittResult.data;
        dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        dict.delete(PDFName.of('DecodeParms'));
        dict.set(PDFName.of('Width'), PDFNumber.of(ccittResult.width));
        dict.set(PDFName.of('Height'), PDFNumber.of(ccittResult.height));
        dict.set(PDFName.of('Length'), PDFNumber.of(ccittResult.data.length));
      }
    }
```

- [ ] **Step 6.6: Run all tests**

```bash
npx vitest run
```

Expected: all tests pass (existing 35 + 3 decoder + 5 optimizer + 1 integration = 44 tests).

- [ ] **Step 6.7: Type check**

```bash
npx tsc --noEmit --skipLibCheck
```

Expected: no errors.

- [ ] **Step 6.8: Commit**

```bash
CI=1 git add src/compress.ts __tests__/compress.spec.ts \
  && CI=1 git commit -m "feat: add CCITTFaxDecode branch to compress pipeline"
```

---

## Self-Review Checklist

| Spec requirement | Covered in task |
|---|---|
| Port CCITTFaxDecoder from pdf.js (Apache 2.0) | Task 1 |
| `CCITTParams` interface with all 5 PDF fields + defaults | Task 1 |
| 150 DPI floor for CCITT images | Task 3 + Task 4 (optimizer test) |
| Box-filter downsampling of 1-bit bitmap | Task 4 (downsample1Bit) |
| Re-encode as FlateDecode (not JPEG) | Task 4 |
| Return null when no size gain | Task 4 |
| `extractCCITTParams` reads from PDFDict | Task 6 |
| Dict mutation: Filter, DecodeParms, Width, Height, Length | Task 6 |
| Unit tests: decoder | Task 2 |
| Unit tests: optimizer (floor, downsampling, null return) | Task 4 |
| Integration test: no CCITTFaxDecode in output | Task 6 |
| Integration test: compressionRatio < 1.0 | Task 6 |
